/**
 * ConvergenceCheck Node (No LLM — Pure Logic)
 *
 * Goal: Decide whether to iterate or terminate.
 * Inputs: Time/compute budget, confidence deltas, active hypotheses, unresolved uncertainty.
 * Outputs: decision (iterate | converged | bounded_uncertainty | insufficient_data)
 * Routing:
 *   iterate → back to DifferentialExpansion / TargetedReanalysis
 *   others  → Termination
 */

'use strict';

const { recordNode } = require('./node-utils');

const convergenceCheckNode = {
  id: 'convergenceCheck',
  type: 'convergence_check',

  prepare(state) {
    return { ...state, currentPhase: 'convergenceCheck' };
  },

  llmCall: null,

  process(state) {
    const iteration     = state.iteration || 0;
    const maxIterations = state.config?.maxIterations ?? 3;
    const confThreshold = state.config?.confidenceThreshold ?? 0.75;

    const hypotheses     = state.hypotheses || [];
    const active         = hypotheses.filter(h => h.status === 'active');
    const topConfidence  = active.length > 0 ? Math.max(...active.map(h => h.confidence)) : 0;
    const redFlags       = (state.adversaryResult?.red_flags || []).length;
    const prevConfidence = state._prevTopConfidence ?? 0;
    const delta          = topConfidence - prevConfidence;

    let decision;
    let reason;

    if (iteration >= maxIterations - 1) {
      // Budget exhausted
      if (topConfidence >= confThreshold) {
        decision = 'converged';
        reason   = `Max iterations (${maxIterations}) reached. Top confidence ${topConfidence.toFixed(2)} meets threshold.`;
      } else {
        decision = 'bounded_uncertainty';
        reason   = `Max iterations (${maxIterations}) reached. Top confidence ${topConfidence.toFixed(2)} below threshold ${confThreshold}.`;
      }
    } else if (topConfidence >= confThreshold && active.length <= 3 && redFlags === 0) {
      decision = 'converged';
      reason   = `High confidence (${topConfidence.toFixed(2)}), narrow differential (${active.length}), no red flags.`;
    } else if (active.length === 0) {
      decision = 'insufficient_data';
      reason   = 'All hypotheses ruled out or weakened.';
    } else if (Math.abs(delta) < 0.02 && iteration > 0) {
      decision = 'bounded_uncertainty';
      reason   = `Confidence stalled (delta=${delta.toFixed(3)}). Further iteration unlikely to resolve.`;
    } else {
      decision = 'iterate';
      reason   = `Confidence ${topConfidence.toFixed(2)} < ${confThreshold}, ${active.length} active hypotheses, iterating.`;
    }

    const node = {
      id: `node_convergence_check_${iteration}`,
      type: 'convergence_check',
      goal: 'Decide whether to iterate or terminate',
      content: {
        decision,
        reason,
        top_confidence: topConfidence,
        active_hypotheses: active.length,
        red_flags: redFlags,
        delta,
        iteration,
      },
      status: 'completed',
      confidence: topConfidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        convergenceDecision: decision,
        convergenceReason: reason,
        _nodeDecision: decision,
        _prevTopConfidence: topConfidence,
        iteration: decision === 'iterate' ? iteration + 1 : iteration,
      },
      node, 'convergenceCheck'
    );
  },
};

module.exports = convergenceCheckNode;

