/**
 * Record Node (No LLM — Output Serialization)
 *
 * Goal: Persist the final IRG trace for audit and visualization.
 * Inputs: All nodes + edges + termination state.
 * Outputs:
 *   - Serialized trace (for trace-navigator).
 *   - Metadata for EIE-like evaluation (assumptions, uncertainty markers, abstentions).
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
    // Build the final trace
    const trace = {
      __xray_irg: { kind: 'trace', v: 1 },
      timestamp: new Date().toISOString(),
      clinical_question: state.clinicalContextResult?.structured_question || state.clinicalQuestion || '',
      termination_state: state.terminationState || 'unknown',
      iterations: state.iteration || 0,

      // Full hypothesis set (final state)
      hypotheses: state.hypotheses || [],

      // Triage output
      triage: state.triageResult || null,

      // All nodes in the reasoning graph
      reasoning_nodes: state.nodes || [],
      history: state.history || [],

      // EIE-compatible metadata
      eie_metadata: {
        assumptions: state.clinicalContextResult?.assumptions || [],
        missing_info: state.clinicalContextResult?.missing_info || [],
        uncertainty_markers: {
          convergence_decision: state.convergenceDecision,
          convergence_reason: state.convergenceReason,
          image_quality: state.imageObservationResult?.image_quality,
        },
        abstention: state.terminationState === 'insufficient_data',
        escalation_flags: state.escalationFlags || [],
        red_flags: state.adversaryResult?.red_flags || [],
      },

      // Timing
      metrics: state.metrics || {},
    };

    const node = {
      id: 'node_record',
      type: 'record',
      goal: 'Persist the final IRG trace for audit',
      content: { trace_size: JSON.stringify(trace).length, termination_state: trace.termination_state },
      status: 'completed',
      confidence: 1.0,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, trace },
      node, 'record'
    );
  },
};

module.exports = recordFinalNode;

