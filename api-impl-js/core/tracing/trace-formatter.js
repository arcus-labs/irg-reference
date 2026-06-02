'use strict';

const { irgApiRequestDefaults } = require('../../../shared/runtime-defaults.json');

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function findLatestNonEmptyResponse(trace) {
  for (const entry of [...trace].reverse()) {
    const response = firstNonEmptyString(
      entry?.content?.response,
      entry?.content?.finalResponse,
      entry?.content?.draft_response,
      entry?.node_id?.content?.response,
      entry?.node_id?.content?.finalResponse,
      entry?.node_id?.content?.draft_response
    );
    if (response) {
      return response;
    }
  }
  return '';
}

/**
 * Trace Formatter
 *
 * Converts IRG graph execution results into the trace format
 * expected by the trace-navigator.
 */

function formatTrace(executionResult, requestParams) {
  const now = new Date().toISOString();
  const resolvedRequestParams = {
    ...irgApiRequestDefaults,
    ...requestParams,
  };

  // Build trace array from executed nodes
  // Each node in state.nodes is a full node object with id, type, goal, content, etc.
  const trace = (executionResult.nodes || []).map((nodeRecord) => {
    const content = nodeRecord?.content || {};

    return {
      ...nodeRecord,
      timestamp: now,
      node_id: nodeRecord,  // Full node object with id, type, goal, content, etc.
      content,
      status: nodeRecord?.status || 'completed',
      input: {
        query: resolvedRequestParams.query,
        context: resolvedRequestParams.context,
      },
      output: content,
      duration_ms: 0,
    };
  });

  // Extract the final response from draft result
  // If draftResult is an object, extract just the text response
  const latestNonEmptyTraceResponse = findLatestNonEmptyResponse(trace);

  let draftResponse = typeof executionResult.draftResult === 'string'
    ? executionResult.draftResult
    : firstNonEmptyString(
      executionResult.finalResponse,
      executionResult.revisedDraft,
      executionResult.currentDraft,
      executionResult.lastNonEmptyDraft,
      executionResult.draftResult?.response,
      executionResult.draftResult?.draft_response,
      latestNonEmptyTraceResponse
    );

  // Determine if response should be YAML
  const shouldBeYaml = typeof draftResponse === 'string' && draftResponse.includes('---');

  // Calculate total tokens from tokenUsage array if available
  let totalTokensUsed = executionResult.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  if (executionResult.tokenUsage && Array.isArray(executionResult.tokenUsage)) {
    let inputTokens = 0;
    let outputTokens = 0;
    executionResult.tokenUsage.forEach(usage => {
      inputTokens += usage.prompt_tokens || 0;
      outputTokens += usage.completion_tokens || 0;
    });
    totalTokensUsed = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    };
  }

  const finalConfidence = Number.isFinite(executionResult.finalConfidence)
    ? executionResult.finalConfidence
    : undefined;

  return {
    // Metadata
    session_id: generateSessionId(),
    timestamp: now,
    query: resolvedRequestParams.query,
    context: resolvedRequestParams.context,
    config: {
      maxIterations: resolvedRequestParams.maxIterations || irgApiRequestDefaults.maxIterations,
      confidenceThreshold: resolvedRequestParams.confidenceThreshold || irgApiRequestDefaults.confidenceThreshold,
      model: resolvedRequestParams.model || irgApiRequestDefaults.model,
      enableFactCheck: resolvedRequestParams.enableFactCheck !== false,
      enableImpactPrediction: resolvedRequestParams.enableImpactPrediction !== false,
      enableAssessor: resolvedRequestParams.enableAssessor !== false,
      enableFactCheckPipeline: resolvedRequestParams.enableFactCheckPipeline === true,
    },

    // Execution results
    trace,
    final_decision: executionResult._nodeDecision || 'unknown',
    ...(finalConfidence !== undefined ? { finalConfidence } : {}),
    nodes_executed: executionResult.nodes?.length || 0,
    total_tokens_used: totalTokensUsed,

    // Response content
    draft_response: draftResponse,
    convergence_result: executionResult.convergenceResult || {},

    // Citations (Citation_Application.md). `references` are the resolved
    // citation records backing the cited answer; `citation_quality` is the
    // ALCE-style recall/precision scoring (null when nothing was citable).
    references: executionResult.references
      || executionResult.citationApplyResult?.references
      || [],
    citation_quality: executionResult.citationQualityResult || null,

    // Flag for YAML format
    __yaml: shouldBeYaml,
  };
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return `irg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  formatTrace,
  generateSessionId,
};

