'use strict';

/**
 * Citation Quality Node (Citation_Application.md §13)
 *
 * Runs after `citationApply`. Scores the cited answer with ALCE-style
 * citation recall + precision via a single LLM pass that judges each
 * sentence (claim-bearing? cited? does the citation actually support it?).
 * The deterministic metric math lives in core/citations/quality-metrics.js;
 * this node only sources the per-sentence judgments and records the result.
 *
 * Inert (no LLM call) when the response carries no citations — recall /
 * precision are reported as null so a response with nothing to cite doesn't
 * distort aggregate accuracy numbers.
 */

const { buildPrompt, recordNode, safeParseJson, extractTokens } = require('./node-utils');
const { computeCitationQuality } = require('../citations/quality-metrics');

const CITATION_MARKER_RE = /<citation\b/i;

function renderReferences(references) {
  return JSON.stringify(
    references.map((r) => ({
      seq: r.seq,
      claim_text: r.claim_text,
      verdict: r.verdict,
      supporting_span: r.sources?.find((s) => s?.supporting_span)?.supporting_span
        || r.sources?.[0]?.excerpt
        || null,
    })),
    null,
    2
  );
}

function emptyResult(reason) {
  return {
    citation_recall: null,
    citation_precision: null,
    citation_f1: null,
    counts: {
      sentences: 0, claim_bearing: 0, claim_bearing_supported: 0,
      cited_sentences: 0, cited_supported: 0, uncited_claims: 0, misattributed_citations: 0,
    },
    evaluated: false,
    reason,
  };
}

const citationQualityNode = {
  id: 'citationQuality',
  type: 'citation_quality',

  prepare(state, prompts) {
    const references = Array.isArray(state.references)
      ? state.references
      : (state.citationApplyResult?.references || []);
    const response = state.citationApplyResult?.response
      || state.draftResult?.response
      || state.currentDraft
      || '';

    const hasCitations = references.length > 0 && CITATION_MARKER_RE.test(response);

    return {
      ...state,
      citationQualityInput: {
        response,
        references,
        hasCitations,
        prompt: hasCitations
          ? buildPrompt(prompts.citationQuality, { response, references: renderReferences(references) })
          : null,
      },
      currentPhase: 'citationQuality',
    };
  },

  async llmCall(state, llmClient) {
    const input = state.citationQualityInput || {};
    if (!input.hasCitations || !input.prompt) {
      return { skipped: true };
    }
    return llmClient.call(input.prompt, { node: 'citationQuality' });
  },

  process(state, llmResponse) {
    const input = state.citationQualityInput || {};

    if (!input.hasCitations) {
      const result = emptyResult(
        (input.references?.length ? 'no citation markers in response' : 'no verified citations available')
      );
      return record(state, result, { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    }

    if (llmResponse && llmResponse.skipped) {
      return record(state, emptyResult('citationQuality prompt unavailable'), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    }

    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);
    const parsed = safeParseJson(typeof content === 'string' ? content : '') || {};
    const judgments = Array.isArray(parsed.sentences) ? parsed.sentences : [];

    const metrics = computeCitationQuality(judgments);
    const result = {
      ...metrics,
      evaluated: true,
      sentences: judgments.map((s) => ({
        text: typeof s.text === 'string' ? s.text.slice(0, 240) : '',
        claim_bearing: !!s.claim_bearing,
        has_citation: !!s.has_citation,
        citation_supports: !!s.citation_supports,
        cited_seqs: Array.isArray(s.cited_seqs) ? s.cited_seqs : [],
      })),
    };

    return record(state, result, tokens);
  },
};

function record(state, result, tokens) {
  const node = {
    id: `node_citation_quality_${state.iteration || 0}`,
    type: 'citation_quality',
    goal: 'Score citation recall + precision over the cited answer (ALCE-style)',
    content: result,
    raw_output: JSON.stringify(result),
    status: 'completed',
    // Confidence mirrors the F1 when available, else neutral.
    confidence: typeof result.citation_f1 === 'number' ? result.citation_f1 : 0.5,
    tokens,
    timestamp: new Date().toISOString(),
  };

  const current = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const newTokens = {
    input_tokens: (current.input_tokens || 0) + (tokens.input_tokens || 0),
    output_tokens: (current.output_tokens || 0) + (tokens.output_tokens || 0),
    total_tokens: (current.total_tokens || 0) + (tokens.total_tokens || 0),
  };

  return recordNode(
    { ...state, citationQualityResult: result, total_tokens_used: newTokens },
    node,
    'citationQuality'
  );
}

module.exports = citationQualityNode;
