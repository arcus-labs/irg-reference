'use strict';

/**
 * Case Recall Node
 *
 * The recall step for a Reg E adjudication graph. Replaces `memoryRecall` in
 * the adjudication topology and produces a `memoryRecallResult` that the
 * downstream `draft → build-citable-set` chain consumes unchanged.
 *
 * It assembles a UNIFIED citable set from two independently-managed sources:
 *
 *   1. Per-case EVIDENCE items (`state.caseEvidence`) — transient, supplied by
 *      the runner from the case file (consumer dispute form, internal records,
 *      timeline, etc.). Each item becomes a verified recall hit citing the
 *      institution's own records as the source.
 *
 *   2. Recalled REGULATORY rules — the IRG reasoning selects which precomputed
 *      Reg E rule citations apply to this case. The rule citations live as
 *      first-class verified-citation artifacts in the fact-store (seeded once
 *      by demos/reg-e/scripts/seed-reg-e-rule-citations.js); this node reads
 *      each selected citation from the substrate so its full provenance flows
 *      into the trace.
 *
 * The LLM selection (in `llmCall`) is the reasoning step that chooses which
 * rules apply — analogous to a Reg E adjuster opening only the relevant CFR
 * sections rather than re-reading the whole regulation. The candidate set is
 * small enough (one regulation pack) to present in full, so we do not need a
 * semantic pre-filter; the model picks rule IDs directly.
 *
 * Inputs (from state, set by the runner):
 *   - caseEvidence : Array<{ id, type, fact, source }>
 *   - regEKnowledgePack : { pack, claims: [{ id, claim, section, url, supporting_span, ... }] }
 *
 * Output:
 *   - state.memoryRecallResult — recall-hit-shaped, evidence first then regulations
 *   - state.caseRecallResult   — node-card summary
 */

const fs = require('fs');
const path = require('path');

const { buildPrompt, recordNode, safeParseJson, extractTokens } = require('./node-utils');
const { canonicalizeClaim } = require('../external-fact-check/claim-parser');
const { getFactStorePaths } = require('../external-fact-check/config');

const DEFAULT_PACK_SUBDIR = 'reg-e-pack';

// Build a recall-hit entry shaped exactly as memoryRecall produces — so the
// existing build-citable-set (and any other downstream reader of
// memoryRecallResult.results) consumes it without changes.
function recallHit({ claim_text, claim_key, verdict, verification_level, verification_confidence, sources, citation_path }) {
  return {
    claim_text,
    claim_key,
    previously_seen: false,
    recall: {
      hit: true,
      verdict,
      verification_level,
      verification_status: `${verification_level}_${verdict}`,
      source_count: sources.length,
      verification_confidence: verification_confidence ?? 0.95,
      citation_path: citation_path || null,
      sources,
    },
  };
}

function evidenceToHit(item) {
  const text = item.fact || '';
  return recallHit({
    claim_text: text,
    claim_key: canonicalizeClaim(text).claim_key,
    verdict: 'supported',
    verification_level: 'verified',
    verification_confidence: 0.95,
    sources: [
      {
        url: null,
        title: `Evidence ${item.id} — ${item.type || 'record'}`,
        supporting_span: text,
        span_offset: null,
        excerpt: item.source || null,
      },
    ],
  });
}

// Read a precomputed rule citation off the substrate and translate it into a
// recall-hit. We deliberately read the artifact rather than reconstruct from
// the in-memory pack, so trace provenance reflects what is actually on disk.
function readRuleCitationAsHit(rule, citationDir, packSubdir = DEFAULT_PACK_SUBDIR) {
  const filepath = path.join(citationDir, packSubdir, `${rule.id}.json`);
  let citation = null;
  try {
    citation = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    // Fall back to the in-memory pack entry if the citation file isn't seeded
    // yet — keeps the demo runnable before/without seeding. The trace will
    // still show the rule; it just won't carry the on-disk verified_at.
  }

  if (citation) {
    const root = getFactStorePaths().factStoreRoot;
    const relPath = path.relative(root, filepath);
    return recallHit({
      claim_text: citation.claim?.raw_text || rule.claim,
      claim_key: citation.claim_key,
      verdict: citation.verdict,
      verification_level: citation.verification_level,
      verification_confidence: citation.confidence ?? 0.95,
      citation_path: relPath,
      sources: (citation.sources || []).map((s) => ({
        url: s.url,
        title: s.title,
        supporting_span: s.supporting_span,
        span_offset: null,
        excerpt: null,
      })),
    });
  }

  // Fallback: synthesize from the pack entry.
  return recallHit({
    claim_text: rule.claim,
    claim_key: canonicalizeClaim(rule.claim).claim_key,
    verdict: 'supported',
    verification_level: 'verified',
    verification_confidence: 0.95,
    citation_path: null,
    sources: [
      {
        url: rule.url,
        title: rule.section,
        supporting_span: rule.supporting_span,
        span_offset: null,
        excerpt: null,
      },
    ],
  });
}

const caseRecallNode = {
  id: 'caseRecall',
  type: 'case_recall',

  prepare(state) {
    const evidence = Array.isArray(state.caseEvidence) ? state.caseEvidence : [];
    // `knowledgePack` is the generic, multi-domain key; `regEKnowledgePack`
    // is kept for backward compatibility with the original Reg E runner.
    const pack = state.knowledgePack || state.regEKnowledgePack || { claims: [] };

    // Build the rule-selection prompt. We list every rule in the pack with id
    // + section + claim; the model returns the relevant ids. The case context
    // (state.context) is already the full case packet — no need to repeat it.
    const ruleList = (pack.claims || [])
      .map((c) => `- ${c.id} — ${c.section}: ${c.claim}`)
      .join('\n');

    const selectionPrompt = [
      'You are reviewing a Regulation E dispute case. From the available Reg E rules below,',
      'select the rules that directly bear on adjudicating THIS case (definition of unauthorized',
      'transfer, applicable liability tier, error-resolution timing, etc.). Include only rules',
      'whose substance is needed to reach or justify a decision. Most relevant first.',
      '',
      'Case packet:',
      typeof state.context === 'string' ? state.context : JSON.stringify(state.context || {}, null, 2),
      '',
      'Available Reg E rules (id — section: text):',
      ruleList || '(no rules available)',
      '',
      'CRITICAL: Return ONLY valid JSON with NO markdown formatting or extra text.',
      '',
      '{ "relevant_ids": ["id1", "..."] }',
    ].join('\n');

    return {
      ...state,
      caseRecallInput: { evidence, pack, selectionPrompt },
      currentPhase: 'caseRecall',
    };
  },

  async llmCall(state, llmClient) {
    const input = state.caseRecallInput || {};
    const pack = input.pack || { claims: [] };
    // If there are no rules to choose from, skip the model call.
    if (!input.selectionPrompt || !pack.claims?.length) {
      return { skipped: true };
    }
    return llmClient.call(input.selectionPrompt, { node: 'caseRecall' });
  },

  process(state, llmResponse) {
    const input = state.caseRecallInput || {};
    const evidence = input.evidence || [];
    const pack = input.pack || { claims: [] };
    const byId = new Map((pack.claims || []).map((c) => [c.id, c]));
    const { citationDir } = getFactStorePaths();
    const packSubdir = state.citationPackSubdir || DEFAULT_PACK_SUBDIR;

    // ---- Resolve which rules the reasoning selected --------------------
    let selectedIds = [];
    let tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    if (llmResponse && !llmResponse.skipped) {
      const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
      tokens = extractTokens(llmResponse);
      const parsed = safeParseJson(typeof content === 'string' ? content : '') || {};
      selectedIds = Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids : [];
    }
    let selectedRules = selectedIds.map((id) => byId.get(id)).filter(Boolean);
    if (selectedRules.length === 0) {
      // Conservative fallback — if selection failed, surface every rule so
      // the draft has something to cite. Better to over-supply than to leave
      // the model without grounded evidence.
      selectedRules = pack.claims || [];
    }

    // ---- Assemble unified citable set ----------------------------------
    const results = [];
    for (const e of evidence) results.push(evidenceToHit(e));
    for (const rule of selectedRules) results.push(readRuleCitationAsHit(rule, citationDir, packSubdir));

    // Dedupe by claim_key (an evidence item and a rule won't collide in
    // practice, but be safe — first occurrence wins).
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (seen.has(r.claim_key)) continue;
      seen.add(r.claim_key);
      deduped.push(r);
    }

    const summary = {
      claims_checked: deduped.length,
      recalled: deduped.length,
      recalled_verified: deduped.length,
      previously_seen: 0,
      recall_rate: deduped.length > 0 ? 1 : 0,
      semantic_neighbors_found: 0,
      embedding_provider: null,
      evidence_items: evidence.length,
      regulation_rules_selected: selectedRules.length,
      regulation_rule_ids: selectedRules.map((r) => r.id),
      results: deduped,
    };

    const node = {
      id: `node_case_recall_${state.iteration || 0}`,
      type: 'case_recall',
      goal: 'Load case evidence and select applicable verified regulations into the citable set',
      content: {
        evidence_items: summary.evidence_items,
        regulation_rules_selected: summary.regulation_rules_selected,
        regulation_rule_ids: summary.regulation_rule_ids,
        total_recall_items: deduped.length,
      },
      raw_output: JSON.stringify({ regulation_rule_ids: summary.regulation_rule_ids }),
      status: 'completed',
      confidence: 0.95,
      tokens,
      timestamp: new Date().toISOString(),
    };

    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    return recordNode(
      {
        ...state,
        memoryRecallResult: summary,
        caseRecallResult: summary,
        total_tokens_used: newTokens,
      },
      node,
      'caseRecall'
    );
  },
};

module.exports = caseRecallNode;
