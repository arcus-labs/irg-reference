/**
 * Adversary Node (Counter-Hypothesis)
 *
 * Goal: Challenge the current leading hypothesis set.
 * Inputs: Ranked hypotheses, findings, missing evidence.
 * Outputs:
 *   - Alternative explanations for key findings.
 *   - "What would disprove the top hypothesis?" checklist.
 *   - Identification of overlooked hypotheses or red flags.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const adversaryNode = {
  id: 'adversary',
  type: 'adversary',

  prepare(state, prompts) {
    // Rank hypotheses by confidence for adversary review
    const ranked = [...(state.hypotheses || [])]
      .filter(h => h.status === 'active')
      .sort((a, b) => b.confidence - a.confidence);

    const prompt = buildPrompt(prompts.adversary, {
      structuredQuestion: state.clinicalContextResult?.structured_question || '',
      findings: state.imageObservationResult?.findings || [],
      rankedHypotheses: ranked,
      missingEvidence: state.missingEvidence || [],
      patientAge: state.patientAge || 'unknown',
      patientSymptoms: state.patientSymptoms || 'not provided',
    });
    return { ...state, adversaryPrompt: prompt, currentPhase: 'adversary' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.adversaryPrompt, { node: 'adversary' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    result.alternative_explanations = result.alternative_explanations || [];
    result.disproval_checklist      = result.disproval_checklist      || [];
    result.overlooked_hypotheses    = result.overlooked_hypotheses    || [];
    result.red_flags                = result.red_flags                || [];
    result.targeted_questions       = result.targeted_questions       || [];
    result.confidence               = Number(result.confidence ?? 0.5);

    const node = {
      id: `node_adversary_${state.iteration || 0}`,
      type: 'adversary',
      goal: 'Challenge the leading hypothesis set',
      content: result,
      raw_output: llmResponse,
      status: 'completed',
      confidence: result.confidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, adversaryResult: result },
      node, 'adversary'
    );
  },
};

module.exports = adversaryNode;

