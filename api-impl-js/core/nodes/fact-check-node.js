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
  writeFactCheckClaimsArtifactSync,
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

  process(state, llmResponse) {
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

    // The node type signals the rendering mode:
    //   - 'fact_check_pipeline' — claims are persisted to disk for downstream
    //     pipeline nodes (externalFactCheck, citationSourceGeneration, etc.)
    //   - 'fact_check'          — claims are returned inline only, no persistence
    const isPipelineMode = !!state.config?.enableFactCheckPipeline;
    const nodeType = isPipelineMode ? 'fact_check_pipeline' : 'fact_check';

    let factCheckOutput;
    if (isPipelineMode) {
      factCheckOutput = writeFactCheckClaimsArtifactSync({
        criticalClaims: normalizedClaims,
        summary: result.summary || '',
        confidence,
        originalQuery: state.originalQuery,
        context: state.context,
        iteration: state.iteration || 0,
        sourceNode: 'factCheck',
        rawOutput: cleanedResponse,
      });
    } else {
      factCheckOutput = {
        critical_claims: normalizedClaims,
        summary: result.summary || '',
        confidence,
      };
    }

    const node = {
      id: `node_fact_check_${state.iteration || 0}`,
      type: nodeType,
      goal: 'Extract critical factual claims',
      content: factCheckOutput,
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
      { ...state, factCheckResult: factCheckOutput, total_tokens_used: newTokens },
      node, 'factCheck'
    );
  },
};

module.exports = factCheckNode;

