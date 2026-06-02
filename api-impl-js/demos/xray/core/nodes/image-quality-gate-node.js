/**
 * ImageQualityGate Node (Early Gate — No LLM)
 *
 * Goal: Decide if the study is interpretable.
 * Inputs: image_quality, findings.
 * Outputs: route (proceed | insufficient_data), structured reason if insufficient.
 * Routing:
 *   insufficient_data → Termination(state="insufficient_data")
 *   proceed → initialHypothesisSet
 */

'use strict';

const { recordNode } = require('./node-utils');

const imageQualityGateNode = {
  id: 'imageQualityGate',
  type: 'image_quality_gate',

  prepare(state) {
    return { ...state, currentPhase: 'imageQualityGate' };
  },

  llmCall: null,

  process(state) {
    const quality    = state.imageObservationResult?.image_quality || 'unknown';
    const reasons    = state.imageObservationResult?.image_quality_reasons || [];
    const findings   = state.imageObservationResult?.findings || [];
    const confidence = state.imageObservationResult?.observation_confidence ?? 0.5;

    // Determine if image is interpretable
    const uninterpretable = quality === 'non_diagnostic' || quality === 'poor';
    const noFindings      = findings.length === 0 && quality === 'unknown';
    const lowConfidence   = confidence < 0.2;

    const insufficient = uninterpretable || noFindings || lowConfidence;
    const decision     = insufficient ? 'insufficient_data' : 'proceed';
    const reason       = insufficient
      ? `Image quality: ${quality}. ${reasons.join('; ')}. Findings: ${findings.length}. Confidence: ${confidence.toFixed(2)}`
      : `Image quality: ${quality}. ${findings.length} findings. Confidence: ${confidence.toFixed(2)}`;

    const node = {
      id: `node_image_quality_gate_${state.iteration || 0}`,
      type: 'image_quality_gate',
      goal: 'Decide if the study is interpretable',
      content: { decision, reason, quality, findings_count: findings.length },
      status: 'completed',
      confidence: insufficient ? 0.0 : 1.0,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        imageQualityDecision: decision,
        imageQualityReason: reason,
        _nodeDecision: decision,
      },
      node, 'imageQualityGate'
    );
  },
};

module.exports = imageQualityGateNode;

