/**
 * Hypothesis Node (InitialHypothesisSet)
 *
 * Goal: Generate initial diagnostic hypotheses as persistent nodes.
 * Inputs: ClinicalContext, ImageObservation.
 * Outputs: Multiple Hypothesis entries with label, supporting/conflicting findings,
 *          confidence, and status (active | weakened | ruled_out).
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const hypothesisNode = {
  id: 'hypothesis',
  type: 'hypothesis',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.hypothesis, {
      structuredQuestion: state.clinicalContextResult?.structured_question || '',
      assumptions: state.clinicalContextResult?.assumptions || [],
      findings: state.imageObservationResult?.findings || [],
      patientAge: state.patientAge || 'unknown',
      patientSymptoms: state.patientSymptoms || 'not provided',
      patientHistory: state.patientHistory || 'not provided',
    });
    return { ...state, hypothesisPrompt: prompt, currentPhase: 'hypothesis' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.hypothesisPrompt, { node: 'hypothesis' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    const hypotheses = (result.hypotheses || []).map((h, i) => ({
      id: `hyp_${state.iteration || 0}_${i}`,
      label: h.label || `Hypothesis ${i + 1}`,
      supporting_findings: h.supporting_findings || [],
      conflicting_findings: h.conflicting_findings || [],
      confidence: Number(h.confidence ?? 0.5),
      status: h.status || 'active',
      reasoning: h.reasoning || '',
    }));

    // Merge with existing hypotheses (persistent — updated, not replaced)
    const existing = state.hypotheses || [];
    const merged = [...existing];
    for (const h of hypotheses) {
      const idx = merged.findIndex(e => e.label.toLowerCase() === h.label.toLowerCase());
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...h, id: merged[idx].id };
      } else {
        merged.push(h);
      }
    }

    const node = {
      id: `node_hypothesis_${state.iteration || 0}`,
      type: 'hypothesis',
      goal: 'Generate initial diagnostic hypothesis set',
      content: { hypotheses: merged, new_count: hypotheses.length },
      raw_output: llmResponse,
      status: 'completed',
      confidence: Math.max(...merged.map(h => h.confidence), 0),
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, hypotheses: merged, hypothesisResult: result },
      node, 'hypothesis'
    );
  },
};

module.exports = hypothesisNode;

