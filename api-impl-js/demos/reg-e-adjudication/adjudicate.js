#!/usr/bin/env node
'use strict';

/**
 * IRG Reg E Adjudication Runner.
 *
 * Composition (Cognitive Engineering Thesis §10.3):
 *   IRAC ⊕ Differential Diagnosis ⊕ Steelman/Red-Team ⊕ Toulmin
 *
 * Pipeline:
 *   1. auto-seed the Reg E rule citations into the fact-store (if missing)
 *   2. parse the case packet (markdown) → structured evidence index
 *   3. run the full `irg-reg-e-adjudication` graph live (real LLM) with the
 *      adjudication prompt pack overlaid onto a CLONE of the YAML prompts
 *   4. project the trace into two artifacts: a structured decision JSON and a
 *      Toulmin-shaped consumer notice letter
 *   5. write trace / decision / notice to demos/reg-e-adjudication/output/
 *
 * The graph TOPOLOGY and the COMMITTED PROMPTS are untouched. The only
 * adjudication-specific code is overlay + post-graph projection.
 *
 * Usage:
 *   node demos/reg-e-adjudication/adjudicate.js [--case case-001-bright-stream]
 *                                               [--provider groq] [--model <m>]
 *                                               [--no-seed]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Use a fresh demo fact-store per run so the rule-citation seed is deterministic.
const DEMO_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-e-adj-'));
process.env.FACT_STORE_ROOT = DEMO_STORE;

const yaml = require('js-yaml');
const { runLinearGraph } = require('../../core/execution/irg-interpreter-linear');
const { irgGraphRegEAdjudication } = require('../../graphs/irg-graph-reg-e-adjudication');
const nodeRegistry = require('../../core/execution/irg-node-registry');
const { createLLMClient } = require('../../core/llm');
const { formatTrace } = require('../../core/tracing/trace-formatter');
const { safeParseJson } = require('../../core/nodes/node-utils');
const { buildProvenance } = require('./lib/provenance');
const { withIoSeal, finalizeSeal } = require('../_adjudication-kit/io-seal');

// ---------------------------------------------------------------------------
// Determinism wrapper
// ---------------------------------------------------------------------------
//
// Every LLM call in an adjudication run goes through this wrapped client.
// Each node (clarify, strategy, adversary, arbiter, draft, caseRecall,
// assessor, …) and each post-graph projection call inherits the same
// temperature/seed, so the run is reproducible across invocations against a
// fixed model snapshot. The provider default of 0.7 was the source of the
// run-to-run determination flips you saw on borderline cases.
//
// What this DOES fix: identical inputs + identical model snapshot → identical
// outputs (modulo provider-side non-determinism, which Groq's `seed` mostly
// closes).
// What this does NOT fix: a case that genuinely sits on the decision
// boundary. For those, the right answer is N-of-K ensembling + abstention
// when agreement is below threshold (next iteration of the runner).
function withDeterminism(llm, { temperature = 0, seed = 1, topP } = {}) {
  return {
    async call(prompt, opts = {}) {
      return llm.call(prompt, {
        ...opts,
        temperature: opts.temperature ?? temperature,
        seed: opts.seed ?? seed,
        ...(topP !== undefined ? { topP: opts.topP ?? topP } : {}),
      });
    },
  };
}

const KNOWLEDGE_PATH = path.resolve(__dirname, '..', 'reg-e', 'knowledge', 'reg-e-claims.json');
const SEEDER_PATH = path.resolve(__dirname, '..', 'reg-e', 'scripts', 'seed-reg-e-rule-citations.js');
const PROMPTS_PATH = path.resolve(__dirname, '..', '..', 'core', 'prompts', 'irg-prompts.yaml');
const CASES_DIR = path.resolve(__dirname, 'cases');
const OUT_DIR = path.resolve(__dirname, 'output');

const { PACK: ADJUDICATION_PROMPT_PACK } = require('./lib/prompt-pack');

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    case: 'case-001-bright-stream',
    provider: 'groq',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    seed: true,
    artifacts: null, // when set, bypass the canned case markdown
    caseId: null,    // override the auto-derived case id (used by the upload path)
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') o.case = argv[++i];
    else if (a === '--provider') o.provider = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--no-seed') o.seed = false;
    else if (a === '--artifacts') o.artifacts = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--case-id') o.caseId = argv[++i];
  }
  return o;
}

// Auto-generated case id when none is supplied via the upload path.
function generateCaseId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `reg-e-${ts}-${rnd}`;
}

// Load a case from one or more uploaded artifact files (the dynamic / UI path).
// Mirrors the shape `loadCase` returns, so the rest of the runner is identical.
function loadFromArtifacts(paths, providedCaseId) {
  const artifacts = paths.map((p) => {
    const content = fs.readFileSync(p, 'utf8');
    const name = path.basename(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const type = ({ md: 'markdown', markdown: 'markdown', txt: 'text', csv: 'csv', json: 'json' }[ext]) || 'text';
    return {
      id: path.basename(p, path.extname(p)),
      name,
      type,
      role: 'evidence',
      size_bytes: Buffer.byteLength(content, 'utf8'),
      content,
    };
  });

  // What the IRG sees as `context`: the single file for one upload, or a
  // separator-joined packet for multi-file submissions.
  const packet = artifacts.length === 1
    ? artifacts[0].content
    : artifacts.map((a) => `# Artifact: ${a.name} (${a.type})\n\n${a.content}`).join('\n\n---\n\n');

  // Aggregate any `## Evidence Index` blocks across uploaded markdown files
  // — those become the structured citable evidence items.
  const evidence = [];
  for (const a of artifacts) {
    if (a.type === 'markdown') evidence.push(...parseEvidenceIndex(a.content));
  }

  return {
    caseId: providedCaseId || generateCaseId(),
    filepath: paths[0],
    packet,
    evidence,
    artifacts,
  };
}

// ---------------------------------------------------------------------------
// case packet parsing
// ---------------------------------------------------------------------------

/**
 * Extract the [E*] structured evidence index from the case markdown. The
 * remainder of the document is passed to the graph as `context` (the LLM
 * reads it whole) — only the evidence index becomes structured citable items.
 */
function parseEvidenceIndex(md) {
  const idxStart = md.indexOf('## Evidence Index');
  if (idxStart === -1) return [];
  const block = md.slice(idxStart);
  const items = [];
  const lineRe = /^- \[([Ee]\d+)\]\s+(.+)$/gm;
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    items.push({ id: m[1].toUpperCase(), type: 'fact-of-record', fact: m[2].trim() });
  }
  return items;
}

function loadCase(caseId) {
  const filepath = path.join(CASES_DIR, `${caseId}.md`);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Case file not found: ${filepath}`);
  }
  const md = fs.readFileSync(filepath, 'utf8');
  const evidence = parseEvidenceIndex(md);
  return { caseId, filepath, packet: md, evidence };
}

// ---------------------------------------------------------------------------
// prompt overlay
// ---------------------------------------------------------------------------

function overlayAdjudicationPrompts(prompts) {
  const cloned = JSON.parse(JSON.stringify(prompts));
  for (const [node, addendum] of Object.entries(ADJUDICATION_PROMPT_PACK)) {
    if (cloned[node] && typeof cloned[node].system === 'string') {
      cloned[node].system += addendum;
    }
  }
  return cloned;
}

// ---------------------------------------------------------------------------
// auto-seed
// ---------------------------------------------------------------------------

function autoSeed(verbose = true) {
  // Run the seeder synchronously as a child process so it picks up
  // FACT_STORE_ROOT cleanly. (Calling its main() directly works but
  // re-requires modules into the same process; spawn is simpler here.)
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [SEEDER_PATH], {
    env: { ...process.env, FACT_STORE_ROOT: DEMO_STORE },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error('Rule-citation seeder failed:\n' + r.stderr);
  }
  if (verbose) {
    const lastLines = r.stdout.trim().split('\n').slice(-3).join('\n');
    console.log(lastLines);
  }
}

// ---------------------------------------------------------------------------
// post-graph projections
// ---------------------------------------------------------------------------

function buildDecisionPrompt({ caseInfo, draftResponse, references, recallSummary, regEErrorCategory }) {
  const categoryBlock = regEErrorCategory
    ? [
        '',
        'LOCKED REG E CATEGORY (do not re-classify; project it):',
        `  category: §1005.11(a)(${regEErrorCategory.category === 'out_of_scope' ? 'n/a — out of scope' : regEErrorCategory.category}) — ${regEErrorCategory.label}`,
        `  primary section anchor: ${regEErrorCategory.section_anchor}`,
        `  rationale: ${regEErrorCategory.reason}`,
        regEErrorCategory.category === 'i'
          ? '  → §1005.6 liability tiers DO apply. Use $50 / $500 / unlimited.'
          : [
              '  → §1005.6 liability tiers DO NOT apply. The `liability_tier` field MUST be "n/a — not unauthorized" (or "n/a" for out-of-scope).',
              '  → BANNED VOCABULARY for this case: do NOT use the word "unauthorized" anywhere in `issue`, `conclusion`, or `application_findings`. Do NOT use the phrase "unauthorized electronic fund transfer". Do NOT include §1005.2(m) in the `rule` array.',
              '  → REQUIRED VOCABULARY: describe the dispute using the category\'s own language, e.g. "' + regEErrorCategory.label + '". The `rule` array MUST list only sections that govern this category (e.g. ' + regEErrorCategory.section_anchor + ', §1005.11), NOT §1005.2(m) and NOT §1005.6.',
            ].join('\n'),
        '',
      ].join('\n')
    : '';
  return [
    'You project an IRG Reg E adjudication trace into a structured decision artifact.',
    'You do not re-reason. You extract.',
    categoryBlock,
    '',
    'DETERMINATION LANGUAGE (strict): the `conclusion` field must state the determination as a positive finding based on records. DO NOT use hedge words: no "may", "might", "could", "possibly", "perhaps", "likely", "probably", "presumably", "arguably", "apparently", "seemingly", "it seems", "it appears", "appears to". The institution either FINDS the transaction was authorized or FINDS it is unauthorized under §1005.2(m). Uncertainty belongs in consumer_recourse, never in conclusion.',
    'WRITING DISCIPLINE: state each fact once; do not restate the same clause in adjacent sentences.',
    '',
    'Consumer dispute case packet:',
    caseInfo.packet,
    '',
    'IRG decision rationale (Toulmin shape, with resolved citations):',
    draftResponse,
    '',
    'Resolved references (the cited evidence + regulations):',
    JSON.stringify(references.map((r) => ({
      seq: r.seq,
      claim_text: r.claim_text,
      title: r.sources?.[0]?.title || null,
      url: r.sources?.[0]?.url || null,
    })), null, 2),
    '',
    `Regulation rules used: ${(recallSummary?.regulation_rule_ids || []).join(', ')}`,
    '',
    'Return ONLY valid JSON, no prose, no code fences:',
    '{',
    '  "decision": "accept" | "deny" | "partial",',
    '  "refund_amount_usd": <number or 0>,',
    '  "liability_tier": "$50" | "$500" | "unlimited" | "n/a — not unauthorized" | "n/a",',
    '  "issue": "<one-sentence IRAC issue framing>",',
    '  "rule": ["<CFR section>", "..."],',
    '  "application_findings": [',
    '    { "finding": "<short, evidence-grounded fact>", "supports": "accept" | "deny" | "context", "evidence": ["E#", "..."] }',
    '  ],',
    '  "conclusion": "<one or two sentence statement of the determination>",',
    '  "consumer_recourse": ["<actionable next step the consumer can take>", "..."],',
    '  "regulatory_next_steps": ["<what the institution will do next per Reg E (e.g. §1005.11 investigation completion / written notice)>", "..."]',
    '}',
  ].join('\n');
}

function buildNoticeLetterPrompt({ caseInfo, decisionArtifact, references, regEErrorCategory }) {
  const categoryBlock = regEErrorCategory
    ? [
        '',
        'LOCKED REG E CATEGORY (the letter must be consistent with this):',
        `  §1005.11(a)(${regEErrorCategory.category === 'out_of_scope' ? 'n/a — out of scope' : regEErrorCategory.category}) — ${regEErrorCategory.label}`,
        `  primary section anchor: ${regEErrorCategory.section_anchor}`,
        regEErrorCategory.category === 'i'
          ? '  → describe the dispute as an "unauthorized electronic fund transfer" and reference §1005.6 liability tiers.'
          : '  → DO NOT describe the dispute as an "unauthorized electronic fund transfer" and DO NOT reference §1005.6 liability tiers. Use the correct category vocabulary (e.g. "duplicate posting", "preauthorized transfer notice", "remittance error", "fee dispute outside Reg E").',
        '',
      ].join('\n')
    : '';
  return [
    'You draft a Regulation E §1005.11(d)/(e) consumer notice letter as concise, plain-language markdown.',
    categoryBlock,
    'You are NOT reasoning; you are translating an adjudicated decision into a customer-readable letter.',
    'Reg E requires that a notice of resolution explain the determination, document the investigation,',
    'and (when denying) state the reasons and the consumer\'s rights.',
    '',
    'DETERMINATION LANGUAGE (strict): the determination sentence must state the finding positively. DO NOT use hedge words anywhere in the determination or grounds: no "may", "might", "could", "possibly", "perhaps", "likely", "probably", "presumably", "arguably", "apparently", "seemingly", "it seems", "it appears", "appears to". The institution found the transaction was authorized OR found it was unauthorized — say so. Uncertainty belongs in the recourse paragraph only.',
    'WRITING DISCIPLINE: state each fact once; do not restate the same clause in adjacent sentences.',
    '',
    'STRUCTURE the letter as Toulmin Argumentation, but in customer-readable form:',
    '  - Opening: acknowledge the dispute (refer to the case and the disputed transaction).',
    '  - CLAIM (the determination): state plainly what was decided, the refund amount (if any), and the liability tier.',
    '  - GROUNDS: explain the key facts from the institution\'s records that support the determination, in plain language.',
    '  - WARRANT: cite the specific Regulation E rule(s) that govern this determination (12 CFR §...).',
    '  - REBUTTAL acknowledgement: acknowledge the consumer\'s statement and engage with it directly.',
    '  - QUALIFIER + RECOURSE: state what the consumer can do next (e.g., dispute with merchant, billing dispute via card network, request a copy of the investigation, contact the CFPB, etc.).',
    '  - Closing: signature placeholder for the institution.',
    '',
    'Write in plain, respectful, second-person language. Do not use legal jargon without translation. Do not use headings like "CLAIM/GROUNDS/WARRANT" verbatim — fold them into natural paragraphs. Do not invent facts not in the decision.',
    '',
    'Case (for context):',
    caseInfo.packet,
    '',
    'Adjudicated decision artifact (use this; do not deviate):',
    JSON.stringify(decisionArtifact, null, 2),
    '',
    'Cited references (the regulations and records that ground the letter):',
    JSON.stringify(references.map((r) => ({ seq: r.seq, title: r.sources?.[0]?.title, url: r.sources?.[0]?.url, claim_text: r.claim_text })), null, 2),
    '',
    'Return ONLY the markdown letter. No preamble, no JSON, no code fences.',
  ].join('\n');
}

async function llmJson(llm, prompt, opts) {
  const resp = await llm.call(prompt, opts || {});
  const content = typeof resp === 'object' ? resp.content : resp;
  let text = typeof content === 'string' ? content.trim() : '';
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return safeParseJson(text) || {};
}

async function llmText(llm, prompt, opts) {
  const resp = await llm.call(prompt, opts || {});
  const content = typeof resp === 'object' ? resp.content : resp;
  let text = typeof content === 'string' ? content.trim() : '';
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return text;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const caseInfo = opts.artifacts
    ? loadFromArtifacts(opts.artifacts, opts.caseId)
    : loadCase(opts.case);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('========================================================');
  console.log('IRG · Reg E Adjudication —', caseInfo.caseId);
  console.log('========================================================');
  console.log('Demo fact-store:', DEMO_STORE);
  console.log(`Evidence items: ${caseInfo.evidence.length}`);
  console.log();

  // 1) Seed Reg E rule citations into the substrate
  if (opts.seed) {
    console.log('[1/5] seeding Reg E rule citations …');
    autoSeed();
    console.log();
  }

  // 2) Build prompts (overlay adjudication pack) + LLM client
  console.log('[2/5] overlaying adjudication prompt pack …');
  const basePrompts = yaml.load(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  const prompts = overlayAdjudicationPrompts(basePrompts);
  // Wrap the raw provider client so every LLM call (graph nodes + post-graph
  // projections) runs at temperature 0 with a fixed seed. This is what makes
  // an adjudication on the same evidence reproducible across runs.
  const { client: llm, seal } = withIoSeal(
    withDeterminism(createLLMClient({ provider: opts.provider, model: opts.model }), {
      temperature: 0,
      seed: 1,
    }),
  );

  // 3) Run the adjudication graph
  console.log('[3/5] running irg-reg-e-adjudication graph (real LLM) …');
  const knowledgePack = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
  const adjudicationFraming =
    `Adjudicate this Reg E dispute (${caseInfo.caseId}). The case has been classified under 12 CFR §1005.11(a) by an upstream node (see the LOCKED category banner in the case packet) — do NOT re-categorize. Apply the rules for the locked category to the evidence and produce a defensible accept / deny / partial determination. §1005.6 liability tiers apply ONLY when the locked category is (i) unauthorized EFT; for all other categories, apply §1005.11 error resolution under the category's own rules (and §1005.10, §1005.17, §1005.33/.34, or related subparts as the category dictates). Ground every finding in the evidence on file.`;

  const initialState = {
    originalQuery: adjudicationFraming,
    context: caseInfo.packet,
    iteration: 0,
    config: { maxIterations: 2, confidenceThreshold: 0.8 },
    caseEvidence: caseInfo.evidence,
    regEKnowledgePack: knowledgePack,
  };

  const registryWrapper = { get: (id) => nodeRegistry.getNode(id) };
  const state = await runLinearGraph(irgGraphRegEAdjudication, initialState, llm, prompts, registryWrapper);

  const draftResponse = state.draftResult?.response || state.currentDraft || '';
  const references = Array.isArray(state.references) ? state.references : [];
  const recall = state.caseRecallResult || {};
  console.log(`        nodes: ${state.nodes?.length || 0}  ·  references: ${references.length}  ·  rules selected: ${(recall.regulation_rule_ids || []).length}`);

  // 4) Project: decision artifact + Toulmin notice letter
  console.log('[4/5] projecting decision artifact + notice letter …');
  const regEErrorCategory = state.regEErrorCategory || null;
  const decision = await llmJson(llm, buildDecisionPrompt({
    caseInfo, draftResponse, references, recallSummary: recall, regEErrorCategory,
  }), { node: 'regEDecisionProjection' });

  const notice = await llmText(llm, buildNoticeLetterPrompt({
    caseInfo, decisionArtifact: decision, references, regEErrorCategory,
  }), { node: 'regENoticeLetter' });

  // 5) Save artifacts
  console.log('[5/5] writing artifacts …');
  const traceDoc = formatTrace(state, {
    sessionId: `reg-e-adj-${caseInfo.caseId}-${Date.now()}`,
    query: adjudicationFraming,
    context: caseInfo.packet,
    model: `${opts.provider}/${opts.model}`,
    graph: 'irg-reg-e-adjudication',
  });
  // Capture immutable provenance of WHAT ran (model + code + prompts + graph
  // SHAs + determinism config). This is the foundation of the regulator
  // dossier; without it the trace is not independently verifiable.
  const PROMPT_PACK_PATH = path.resolve(__dirname, 'lib', 'prompt-pack.js');
  const GRAPH_PATH = path.resolve(__dirname, '..', '..', 'graphs', 'irg-graph-reg-e-adjudication.js');
  const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  const provenance = buildProvenance({
    runId: traceDoc.session_id || `reg-e-adj-${caseInfo.caseId}-${Date.now()}`,
    provider: opts.provider,
    model: opts.model,
    determinism: { temperature: 0, seed: 1 },
    runnerPath: __filename,
    promptsPath: PROMPTS_PATH,
    promptPackPath: PROMPT_PACK_PATH,
    graphPath: GRAPH_PATH,
    extraNodePaths: [
      path.resolve(__dirname, '..', '..', 'core', 'nodes', 'classify-case-node.js'),
      path.resolve(__dirname, '..', '..', 'core', 'nodes', 'case-recall-node.js'),
    ],
    knowledgePath: KNOWLEDGE_PATH,
    repoRoot: REPO_ROOT,
  });

  // Decorate the trace doc with the adjudication-specific payload so it's
  // self-describing when dropped into the trace navigator.
  provenance.io_seal = finalizeSeal(seal);

  traceDoc.references = references;
  traceDoc.citation_quality = state.citationQualityResult || null;
  traceDoc.provenance = provenance;
  traceDoc.adjudication = {
    case_id: caseInfo.caseId,
    decision: decision,
    notice_letter: notice,
    reg_e_category: regEErrorCategory,
    // Inputs the IRG actually received, as inspectable artifacts. When the
    // case came in via uploaded files, caseInfo.artifacts is already built;
    // otherwise we synthesize a single-artifact view from the canned packet.
    artifacts: Array.isArray(caseInfo.artifacts) && caseInfo.artifacts.length
      ? caseInfo.artifacts
      : [
        {
          id: 'case-packet',
          name: path.basename(caseInfo.filepath),
          type: 'markdown',
          role: 'evidence-packet',
          size_bytes: Buffer.byteLength(caseInfo.packet, 'utf8'),
          content: caseInfo.packet,
        },
      ],
  };

  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.trace.json`), JSON.stringify(traceDoc, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.decision.json`), JSON.stringify(decision, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.notice.md`), notice);

  // ---- console summary ----
  console.log();
  console.log('--------------------------------------------------------');
  console.log('DECISION ARTIFACT');
  console.log('--------------------------------------------------------');
  console.log(`  decision:        ${decision.decision || '(unparsed)'}`);
  console.log(`  refund:          $${decision.refund_amount_usd ?? '?'}`);
  console.log(`  liability tier:  ${decision.liability_tier || '?'}`);
  console.log(`  issue:           ${decision.issue || ''}`);
  if (Array.isArray(decision.rule)) console.log(`  rule:            ${decision.rule.join('; ')}`);
  console.log(`  conclusion:      ${decision.conclusion || ''}`);
  if (Array.isArray(decision.consumer_recourse) && decision.consumer_recourse.length) {
    console.log('  recourse:');
    for (const r of decision.consumer_recourse) console.log('    · ' + r);
  }

  console.log();
  console.log('--------------------------------------------------------');
  console.log('CITED REFERENCES');
  console.log('--------------------------------------------------------');
  for (const r of references) {
    const src = r.sources?.[0] || {};
    console.log(`  [${r.seq}] ${src.title || '(no title)'} — ${r.verdict}`);
    if (src.url) console.log(`        ${src.url}`);
  }

  console.log();
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.trace.json')));
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.decision.json')));
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.notice.md')));

  fs.rmSync(DEMO_STORE, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('Adjudication failed:', err.stack || err.message);
  try { fs.rmSync(DEMO_STORE, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
