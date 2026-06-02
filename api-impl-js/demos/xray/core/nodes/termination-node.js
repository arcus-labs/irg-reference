/**
 * Termination Node (No LLM — Pure Logic)
 *
 * Goal: Encode explicit end-state of reasoning.
 * States:
 *   converged             — high-confidence leading hypothesis (still assistive)
 *   bounded_uncertainty   — narrow but unresolved differential
 *   insufficient_data     — quality / information limits
 * Outputs:
 *   termination_state, explanation, escalation flags.
 */

'use strict';

const { recordNode } = require('./node-utils');

const terminationNode = {
  id: 'termination',
  type: 'termination',

  prepare(state) {
    return { ...state, currentPhase: 'termination' };
  },

  llmCall: null,

  process(state) {
    // Determine termination state from upstream decisions
    let terminationState = state.convergenceDecision || state.imageQualityDecision || 'unknown';
    if (terminationState === 'proceed') terminationState = 'converged'; // should not happen

    // Build explanation
    const explanations = [];
    if (state.convergenceReason) explanations.push(state.convergenceReason);
    if (state.imageQualityReason) explanations.push(state.imageQualityReason);

    // Escalation flags
    const escalationFlags = [];
    if (terminationState === 'insufficient_data') {
      escalationFlags.push('Image quality insufficient — escalate to radiologist for repeat study.');
    }
    if (terminationState === 'bounded_uncertainty') {
      escalationFlags.push('Differential not fully resolved — recommend radiologist review.');
    }
    const redFlags = state.adversaryResult?.red_flags || [];
    if (redFlags.length > 0) {
      escalationFlags.push(`Red flags identified: ${redFlags.join('; ')}`);
    }

    // Active hypotheses summary
    const active = (state.hypotheses || []).filter(h => h.status === 'active');
    const topHypothesis = active.length > 0
      ? active.reduce((a, b) => a.confidence > b.confidence ? a : b)
      : null;

    const node = {
      id: 'node_termination',
      type: 'termination',
      goal: 'Encode explicit end-state of reasoning',
      content: {
        termination_state: terminationState,
        explanation: explanations.join(' '),
        escalation_flags: escalationFlags,
        top_hypothesis: topHypothesis ? topHypothesis.label : null,
        top_confidence: topHypothesis ? topHypothesis.confidence : 0,
        active_count: active.length,
        iterations: state.iteration || 0,
      },
      status: 'completed',
      confidence: topHypothesis ? topHypothesis.confidence : 0,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        terminationState,
        terminationExplanation: explanations.join(' '),
        escalationFlags,
      },
      node, 'termination'
    );
  },
};

module.exports = terminationNode;

