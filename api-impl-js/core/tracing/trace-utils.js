/**
 * Trace Utilities for Event Sourcing Pattern
 * 
 * This module provides utilities for implementing a pure append-only trace
 * where the trace IS the state, and state is derived by replaying events.
 */

/**
 * Derive current state from trace by replaying all events
 * @param {Array} trace - Array of immutable event entries
 * @param {Object} rootConfig - Initial configuration (sessionId, originalQuery, context, config)
 * @returns {Object} Current state derived from trace
 */
function deriveState(trace, rootConfig) {
  const state = {
    // Immutable root config
    sessionId: rootConfig.sessionId,
    originalQuery: rootConfig.originalQuery,
    context: rootConfig.context,
    config: rootConfig.config,
    
    // Derived from trace
    iteration: 0,
    currentPhase: 'init',
    clarifyResult: null,
    draftResult: null,
    evaluateResult: null,
    impactResult: null,
    reviseResult: null,
    convergenceDecision: null,
    convergenceReason: null,
    finalResponse: null,
    finalConfidence: 0.0,
  };

  // Replay trace to build current state
  for (const event of trace) {
    // Extract iteration number from event ID
    const iterMatch = event.id.match(/_(\d+)$/);
    const eventIteration = iterMatch ? parseInt(iterMatch[1]) : 0;
    state.iteration = Math.max(state.iteration, eventIteration);

    switch (event.type) {
      case 'clarify':
        state.clarifyResult = event.content;
        state.currentPhase = 'clarify';
        break;
      case 'draft':
        state.draftResult = event.content;
        state.currentPhase = 'draft';
        state.currentDraft = event.content.response || event.content.draft_response || state.currentDraft;
        break;
      case 'fact_check':
      case 'fact_check_pipeline':
      case 'evaluate':
        state.evaluateResult = event.content;
        state.currentPhase = 'evaluate';
        break;
      case 'impact_prediction':
      case 'impact':
        state.impactResult = event.content;
        state.currentPhase = 'impact';
        break;
      case 'revision':
        state.reviseResult = event.content;
        state.currentPhase = 'revise';
        state.currentDraft = event.content.revised_response;
        break;
      case 'convergence_check':
        state.convergenceDecision = event.content.decision;
        state.convergenceReason = event.content.reason;
        state.currentPhase = 'convergence_check';
        break;
    }
  }

  return state;
}

/**
 * Create an immutable event entry for the trace
 * @param {Object} params - Event parameters
 * @returns {Object} Immutable event entry
 */
function createEvent({
  id,
  type,
  goal,
  inputs = [],
  content = {},
  raw_output = '',
  tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0 },
  parsing = { success: true, method: 'standard', errors: [] },
  status = 'completed',
  confidence = 0.5,
}) {
  return Object.freeze({
    id,
    type,
    goal,
    inputs,
    content: Object.freeze(content),
    raw_output,
    tokens: Object.freeze(tokens),
    parsing: Object.freeze(parsing),
    status,
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Extract tokens from LLM response
 * @param {Object} llmResponse - Response from LLM
 * @returns {Object} Token counts
 */
function extractTokens(llmResponse) {
  if (!llmResponse) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0 };
  }

  if (llmResponse.usage) {
    return {
      input_tokens: llmResponse.usage.prompt_tokens || 0,
      output_tokens: llmResponse.usage.completion_tokens || 0,
      total_tokens: llmResponse.usage.total_tokens || 0,
      reasoning_tokens: llmResponse.usage.reasoning_tokens || 0,
    };
  }

  if (llmResponse.message?.usage) {
    return {
      input_tokens: llmResponse.message.usage.prompt_tokens || 0,
      output_tokens: llmResponse.message.usage.completion_tokens || 0,
      total_tokens: llmResponse.message.usage.total_tokens || 0,
      reasoning_tokens: llmResponse.message.usage.reasoning_tokens || 0,
    };
  }

  return { input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0 };
}

module.exports = {
  deriveState,
  createEvent,
  extractTokens,
};

