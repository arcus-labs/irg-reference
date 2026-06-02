/**
 * Fact Check Node
 *
 * Extracts critical factual claims from the proposed strategy.
 * Does NOT verify claims—that will be done by an external service in a future release.
 * All sources are marked as unverified.
 *
 * Prepare: Renders fact-check prompt with query and adversary results
 * LLM Call: Calls LLM to extract critical claims
 * Process: Parses response and marks all sources as unverified
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');
const {
  normalizeFactCheckClaims,
  writeFactCheckClaimsArtifact,
} = require('../external-fact-check/claim-store');

const factCheckNode = {
  id: 'factCheck',
  type: 'fact_check',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.factCheck, {
      originalQuery:  state.originalQuery,
      arbiterResult:  state.arbiterResult || {},
      context:        state.context,
    });
    return { ...state, factCheckPrompt: prompt, currentPhase: 'factCheck' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.factCheckPrompt, { node: 'factCheck' });
  },

  async process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    // Ensure content is a string
    if (typeof content !== 'string') {
      console.warn('[fact-check-node] content is not a string:', typeof content);
      return { ...state };
    }

    // Strip markdown code blocks if present
    let cleanedResponse = content.trim();
    if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```[a-z]*\n?/, '');
      cleanedResponse = cleanedResponse.replace(/\n?```$/, '');
    }

    const result = safeParseJson(cleanedResponse);

    const normalizedClaims = normalizeFactCheckClaims(result.critical_claims || []);
    const confidence = Number(result.confidence ?? 0.5);

    // Always persist claims to the fact-store, regardless of pipeline mode.
    // This lets the memory layer accrue even when only the simple graph
    // runs. The artifact write is a side-effect; downstream behavior is
    // controlled by which fields we expose on the trace node, not by
    // whether the disk write happens.
    //
    // We persist defensively — if disk writes fail (read-only FS, full
    // disk, etc.), the in-memory pipeline still completes and the trace
    // is generated. Memory accrual is best-effort.
    let persistedArtifact = null;
    if (normalizedClaims.length > 0) {
      try {
        persistedArtifact = await writeFactCheckClaimsArtifact({
          criticalClaims: normalizedClaims,
          summary: result.summary || '',
          confidence,
          originalQuery: state.originalQuery,
          context: state.context,
          iteration: state.iteration || 0,
          sourceNode: 'factCheck',
          rawOutput: cleanedResponse,
        });
      } catch (err) {
        console.warn('[fact-check-node] claim persistence failed (non-fatal):', err.message);
      }
    }

    // The node type signals the rendering mode in the trace navigator:
    //   - 'fact_check_pipeline' — the downstream external pipeline will
    //     rehydrate claims from the artifact; expose artifact metadata.
    //   - 'fact_check'          — simple-mode display: inline claims +
    //     confidence + summary, no artifact metadata in the trace.
    //   In both modes the artifact is on disk; only the trace shape
    //   differs.
    const isPipelineMode = !!state.config?.enableFactCheckPipeline;
    const nodeType = isPipelineMode ? 'fact_check_pipeline' : 'fact_check';

    // Two distinct shapes:
    //   - traceContent: what the trace navigator renders. Clean for
    //     simple mode (inline claims, no artifact metadata), full
    //     artifact metadata for pipeline mode.
    //   - stateValue:   what downstream nodes consume. Carries BOTH
    //     the artifact metadata (artifact_path, fact_store_root —
    //     used by external-fact-check to rehydrate from disk) AND
    //     the inline critical_claims (used by memory-recall and any
    //     other node that wants the claims without a disk read).
    //     If write was skipped (all dups) or persistence failed, we
    //     fall back to just the inline shape.
    const traceContent = (isPipelineMode && persistedArtifact)
      ? persistedArtifact
      : {
        critical_claims: normalizedClaims,
        summary: result.summary || '',
        confidence,
      };
    const stateValue = persistedArtifact
      ? { ...persistedArtifact, critical_claims: normalizedClaims }
      : traceContent;

    const node = {
      id: `node_fact_check_${state.iteration || 0}`,
      type: nodeType,
      goal: 'Extract critical factual claims',
      content: traceContent,
      raw_output: cleanedResponse,
      status: 'completed',
      confidence,
      tokens,
      timestamp: new Date().toISOString(),
    };

    // Accumulate tokens in state
    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    return recordNode(
      { ...state, factCheckResult: stateValue, total_tokens_used: newTokens },
      node, 'factCheck'
    );
  },
};

module.exports = factCheckNode;

