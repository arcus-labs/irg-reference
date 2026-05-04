/**
 * Exit Node
 *
 * Terminal node that displays the final question and response.
 * Pure logic node (no LLM call) that formats the final output.
 *
 * Prepare: Updates phase
 * LLM Call: None (null)
 * Process: Formats and records the final question and response.
 *          Handles the clarification-owned early-exit path by generating a
 *          human-readable clarification request from clarify results.
 */

'use strict';

const { recordNode } = require('./node-utils');

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

/**
 * Build a user-facing clarification request when the pipeline detected a
 * fabricated or unrecognized premise and should not answer substantively.
 *
 * Source of truth:
 *   1. clarifyResult.premise_explanation
 *   2. clarifyResult.core_concepts with recognized: false
 */
function buildClarificationMessage(state) {
  const clarify = state.clarifyResult || {};
  const invalidTerms = (clarify.core_concepts || []).filter(t => t.recognized === false);
  const reason = clarify.premise_explanation
    || 'the query appears to rely on an unknown or potentially misworded term';

  let message = `**I can’t answer this as written** because ${reason}.\n\n`;

  if (invalidTerms.length > 0) {
    message += `**Potentially unrecognized term(s):**\n\n`;
    for (const { term, notes } of invalidTerms) {
      message += `- **"${term}"**: ${notes || 'This term does not appear to map cleanly to a recognized concept.'}\n`;
    }
    message += '\n';
  }

  message += 'Please clarify the term you intended or restate the question using standard terminology, and I can help from there.';
  return message;
}

const exitNode = {
  id: 'exit',
  type: 'exit',

  prepare(state) {
    return { ...state, currentPhase: 'exit' };
  },

  llmCall: null,

  process(state) {
    const isUnanswerable = state.strategyDecision === 'unanswerable'
      || state._nodeDecision === 'unanswerable'
      || state._exit === true
      || state.clarifyResult?.early_exit === true;

    const finalResponse = isUnanswerable
      ? buildClarificationMessage(state)
      : (typeof state.revisedDraft === 'string' && state.revisedDraft.trim())
        ? state.revisedDraft
        : firstNonEmptyString(
          state.lastNonEmptyDraft,
          state.currentDraft,
          state.draftResult?.response,
          state.draftResult?.draft_response,
          state.finalResponse
        );

    const finalConfidence = isUnanswerable
      ? undefined
      : Number(
        state.draftResult?.overall_confidence
        ?? state.draftResult?.confidence
        ?? state.lastNonEmptyDraftConfidence
        ?? state.finalConfidence
        ?? 0.5
      );

    const node = {
      id: 'node_exit',
      type: 'exit',
      goal: 'Display final question and response',
      content: {
        question: state.originalQuery,
        response: finalResponse,
        confidence: finalConfidence,
        convergenceDecision: state.convergenceDecision || (isUnanswerable ? 'unanswerable' : undefined),
        convergenceReason: state.convergenceReason,
        iterations: state.iteration || 0,
      },
      status: 'completed',
      confidence: finalConfidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, finalResponse, finalConfidence },
      node, 'exit'
    );
  },
};

module.exports = exitNode;

