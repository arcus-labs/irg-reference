'use strict';

/**
 * Citation Verify Node
 *
 * Runs after `citationFetch`. For each citation, reads each fetched
 * source's markdown content from disk and asks the LLM whether the
 * source supports, refutes, or is inconclusive on the claim. Updates
 * the citation in place with per-source verdicts and an aggregated
 * citation-level verdict.
 *
 * Marks `verification_level: 'verified'` once at least one source has
 * been LLM-checked. Idempotent: sources already verified are skipped
 * on subsequent runs (unless their prior verdict was 'unreachable').
 */

const { recordNode } = require('./node-utils');
const { verifyManyCitations } = require('../external-fact-check/verifier');

const citationVerifyNode = {
  id: 'citationVerify',
  type: 'citation_verify',

  prepare(state, prompts) {
    const claims = state.factCheckPipelineResult?.claims
                || state.citationWriteResult?.claims
                || [];
    const citationPaths = claims
      .map((c) => c?.citation_file)
      .filter((p) => typeof p === 'string' && p.length > 0);

    return {
      ...state,
      citationVerifyInput: {
        citationPaths,
        // Save just the prompt template we need — verifier renders it
        // per-source at call time.
        promptTemplate: prompts?.citationVerify || null,
      },
      currentPhase: 'citationVerify',
    };
  },

  // Reuses the llmCall slot to host the verifier (it makes LLM calls
  // internally, just many of them). The interpreter awaits this.
  async llmCall(state, llmClient) {
    const { citationPaths, promptTemplate } = state.citationVerifyInput || {};
    if (!citationPaths || citationPaths.length === 0) {
      return {
        citations_processed: 0, verified: 0, skipped: 0, llm_calls: 0, errors: 0,
        supported: 0, refuted: 0, inconclusive: 0, off_topic: 0, unreachable: 0,
        duration_ms: 0, results: [],
      };
    }
    if (!promptTemplate) {
      // Without the prompt we can't verify; produce a trace-friendly
      // skip record rather than throwing.
      return {
        citations_processed: 0, verified: 0,
        skipped: citationPaths.length, llm_calls: 0, errors: 1,
        error: 'citationVerify prompt not found in prompts.yaml',
        supported: 0, refuted: 0, inconclusive: 0, off_topic: 0, unreachable: 0,
        duration_ms: 0, results: [],
      };
    }
    return verifyManyCitations({
      citationPaths,
      llmClient,
      promptTemplate,
    });
  },

  async process(state, verifyResult) {
    const result = verifyResult && typeof verifyResult === 'object'
      ? verifyResult
      : { citations_processed: 0, verified: 0, skipped: 0, llm_calls: 0, errors: 0, duration_ms: 0, results: [] };

    // Trace-friendly summary — strip per-source markdown (already on disk).
    const summary = {
      citations_processed: result.citations_processed,
      verified_sources: result.verified,
      skipped_sources: result.skipped,
      llm_calls: result.llm_calls,
      errors: result.errors,
      supported: result.supported,
      refuted: result.refuted,
      inconclusive: result.inconclusive,
      off_topic: result.off_topic,
      unreachable: result.unreachable,
      duration_ms: result.duration_ms,
      results: (result.results || []).map((r) => ({
        citation_path: r.citation_path,
        claim_key: r.claim_key,
        // claim_text + verification_level let the citable-set builder
        // (core/citations/build-citable-set.js) construct citations
        // without re-reading the citation file from disk.
        claim_text: r.claim_text,
        verification_level: r.verification_level,
        verdict: r.verdict,
        verification_status: r.verification_status,
        verified: r.verified,
        skipped: r.skipped,
        llm_calls: r.llm_calls,
        breakdown: r.breakdown,
        error: r.error,
        sources: (r.sources || []).map((s) => ({
          url: s.url,
          title: s.extracted_title,
          extracted_title: s.extracted_title,
          source_file: s.source_file,
          // Surface the supporting passage at the top level (§4.1).
          supporting_span: s.verification?.quoted_excerpt ?? null,
          verification: s.verification,
        })),
      })),
    };

    // Accumulate tokens across all sub-LLM calls so total_tokens_used
    // stays accurate.
    let totalInput = 0, totalOutput = 0, totalReasoning = 0;
    for (const r of result.results || []) {
      for (const s of r.sources || []) {
        const t = s?.verification?.tokens;
        if (t) {
          totalInput     += t.input_tokens     || t.prompt_tokens     || 0;
          totalOutput    += t.output_tokens    || t.completion_tokens || 0;
          totalReasoning += t.reasoning_tokens || 0;
        }
      }
    }
    const nodeTokens = {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      total_tokens: totalInput + totalOutput,
      reasoning_tokens: totalReasoning,
    };

    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + nodeTokens.input_tokens,
      output_tokens: (currentTokens.output_tokens || 0) + nodeTokens.output_tokens,
      total_tokens: (currentTokens.total_tokens || 0) + nodeTokens.total_tokens,
    };

    const supported = result.supported || 0;
    const refuted = result.refuted || 0;
    const confidence = (supported + refuted) > 0
      ? Math.min(0.95, 0.5 + 0.05 * (supported + refuted))
      : 0.4;

    const node = {
      id: `node_citation_verify_${state.iteration || 0}`,
      type: 'citation_verify',
      goal: 'Verify whether fetched sources support, refute, or are inconclusive on each claim',
      content: summary,
      raw_output: JSON.stringify(summary),
      status: 'completed',
      confidence,
      tokens: nodeTokens,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        citationVerifyResult: summary,
        total_tokens_used: newTokens,
      },
      node,
      'citationVerify'
    );
  },
};

module.exports = citationVerifyNode;
