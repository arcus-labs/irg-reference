/**
 * Record Node
 *
 * Pure logic node (no LLM call) that persists the final response and execution trace.
 * Formats and records the final output for consumption by downstream systems.
 *
 * Prepare: Updates phase
 * LLM Call: None (null)
 * Process: Formats final response and records execution trace
 */

'use strict';

const { recordNode } = require('./node-utils');

const recordFinalNode = {
  id: 'record',
  type: 'record',

  prepare(state) {
    return { ...state, currentPhase: 'record' };
  },

  llmCall: null,

  process(state) {
    const finalResponse =
      (typeof state.revisedDraft === 'string' && state.revisedDraft.trim())
        ? state.revisedDraft
        : (state.currentDraft || state.draftResult?.draft_response || '');

    const finalConfidence = Number(
      state.draftResult?.overall_confidence ?? 0.5
    );

    const node = {
      id: 'node_record',
      type: 'record',
      goal: 'Persist final response and trace',
      content: {
        finalResponse,
        finalConfidence,
        convergenceDecision: state.convergenceDecision,
        convergenceReason:   state.convergenceReason,
        iterations:          state.iteration || 0,
      },
      status: 'completed',
      confidence: finalConfidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, finalResponse, finalConfidence },
      node, 'record'
    );
  },
};

module.exports = recordFinalNode;

