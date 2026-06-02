/**
 * Triage Node
 *
 * Goal: Convert the hypothesis set into ranked, action-oriented guidance.
 * Inputs: All Hypotheses, EvidenceLinks, ConvergenceCheck state.
 * Outputs:
 *   - Ranked differential with confidence scores and key evidence.
 *   - recommended_next_steps (e.g., "Clinical correlation, CBC", "CT recommended").
 *
 * This is the "decision support" surface, not a final diagnosis.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const triageNode = {
  id: 'triage',
  type: 'triage',

  prepare(state, prompts) {
    const hypotheses = [...(state.hypotheses || [])]
      .filter(h => h.status !== 'ruled_out')
      .sort((a, b) => b.confidence - a.confidence);

    const prompt = buildPrompt(prompts.triage, {
      structuredQuestion: state.clinicalContextResult?.structured_question || '',
      rankedHypotheses: hypotheses,
      findings: state.imageObservationResult?.findings || [],
      targetedFindings: state.targetedFindings || [],
      convergenceDecision: state.convergenceDecision,
      convergenceReason: state.convergenceReason,
      adversaryResult: state.adversaryResult || {},
      patientAge: state.patientAge || 'unknown',
      patientSymptoms: state.patientSymptoms || 'not provided',
    });
    return { ...state, triagePrompt: prompt, currentPhase: 'triage' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.triagePrompt, { node: 'triage' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);

    result.ranked_differential = (result.ranked_differential || []).map((d, i) => ({
      rank: i + 1,
      label: d.label || '',
      confidence: Number(d.confidence ?? 0),
      key_supporting: d.key_supporting || [],
      key_contradicting: d.key_contradicting || [],
      reasoning: d.reasoning || '',
    }));

    result.recommended_next_steps = result.recommended_next_steps || [];
    result.urgency                = result.urgency                || 'routine';
    result.clinical_correlation   = result.clinical_correlation   || '';
    result.confidence             = Number(result.confidence ?? 0.5);

    const node = {
      id: `node_triage_${state.iteration || 0}`,
      type: 'triage',
      goal: 'Convert hypotheses into ranked decision-support output',
      content: result,
      raw_output: llmResponse,
      status: 'completed',
      confidence: result.confidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, triageResult: result },
      node, 'triage'
    );
  },
};

module.exports = triageNode;

