'use strict';

/**
 * Citation Fetch Node
 *
 * Runs after `citationWrite`. Reads the freshly-written citation
 * artifacts off disk, HTTP-fetches each candidate URL, saves the raw
 * HTML and a Readability-extracted markdown copy under
 * `_fact-store/sources/{html,markdown}/`, and writes per-source
 * metadata back into the citation JSON.
 *
 * This node does NOT verify that a fetched source actually supports
 * the claim — that's the verifier node (item #9). All it changes
 * about the citation is `retrieval_deferred` and per-source retrieval
 * metadata.
 *
 * Prepare: identify which citation files to process
 * LLM Call: none (network I/O instead, executed in `llmCall` slot)
 * Process: collate per-citation results into a trace summary
 */

const { recordNode } = require('./node-utils');
const { fetchManyCitations } = require('../external-fact-check/fetcher');

const citationFetchNode = {
  id: 'citationFetch',
  type: 'citation_fetch',

  prepare(state) {
    // Citation paths come from the previous node's `claims[].citation_file`.
    // citationWrite already populated `state.factCheckPipelineResult.claims`.
    const claims = state.factCheckPipelineResult?.claims
                || state.citationWriteResult?.claims
                || [];
    const citationPaths = claims
      .map((c) => c?.citation_file)
      .filter((p) => typeof p === 'string' && p.length > 0);

    return {
      ...state,
      citationFetchInput: { citationPaths },
      currentPhase: 'citationFetch',
    };
  },

  // No LLM call. We reuse the llmCall slot for the async fetch so it's
  // awaited by the interpreter exactly like an LLM call would be.
  async llmCall(state) {
    const paths = state.citationFetchInput?.citationPaths || [];
    if (paths.length === 0) {
      return {
        citations_processed: 0,
        fetched: 0,
        failed: 0,
        skipped: 0,
        errors: 0,
        duration_ms: 0,
        results: [],
      };
    }
    // Per-URL and per-citation errors are already collected inside
    // `fetchManyCitations`. This outer guard catches unexpected
    // explosions (programming bugs, OOM, etc.) so a bad fetch never
    // takes down the whole IRG run.
    try {
      return await fetchManyCitations(paths);
    } catch (err) {
      console.warn('[citation-fetch-node] fetchManyCitations crashed:', err.message);
      return {
        citations_processed: paths.length,
        fetched: 0,
        failed: 0,
        skipped: 0,
        errors: paths.length,
        duration_ms: 0,
        results: [],
        node_error: err.message,
      };
    }
  },

  async process(state, fetchResult) {
    const result = fetchResult && typeof fetchResult === 'object'
      ? fetchResult
      : { citations_processed: 0, fetched: 0, failed: 0, skipped: 0, errors: 0, duration_ms: 0, results: [] };

    // Trace-friendly summary content. Don't include full source HTML
    // bodies — keep the trace shape small.
    const summary = {
      citations_processed: result.citations_processed,
      sources_fetched: result.fetched,
      sources_failed: result.failed,
      sources_skipped: result.skipped,
      citation_errors: result.errors,
      duration_ms: result.duration_ms,
      results: (result.results || []).map((r) => ({
        citation_path: r.citation_path,
        claim_key: r.claim_key,
        fetched: r.fetched,
        failed: r.failed,
        skipped: r.skipped,
        error: r.error,
        sources: (r.sources || []).map((s) => ({
          url: s.url,
          status_code: s.status_code,
          retrieved_at: s.retrieved_at,
          source_file: s.source_file,
          markdown_file: s.markdown_file,
          extracted_title: s.extracted_title,
          error: s.error,
        })),
      })),
    };

    const node = {
      id: `node_citation_fetch_${state.iteration || 0}`,
      type: 'citation_fetch',
      goal: 'Fetch candidate URLs and extract readable content',
      content: summary,
      raw_output: JSON.stringify(summary),
      status: 'completed',
      confidence: result.fetched > 0 ? 0.7 : 0.3,
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, citationFetchResult: summary },
      node,
      'citationFetch'
    );
  },
};

module.exports = citationFetchNode;
