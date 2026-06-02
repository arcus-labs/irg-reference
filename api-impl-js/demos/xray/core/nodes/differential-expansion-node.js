/**
 * DifferentialExpansion Node (Knowledge)
 *
 * Goal: Expand and structure the differential.
 * Inputs: Existing Hypothesis nodes, findings, clinical context.
 * Actions:
 *   - Add new Hypothesis nodes (e.g., "Atelectasis", "Mass").
 *   - Adjust priors/confidence based on guidelines/knowledge.
 *   - Flag missing evidence that would discriminate between hypotheses.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const differentialExpansionNode = {
  id: 'differentialExpansion',
  type: 'differential_expansion',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.differentialExpansion, {
      structuredQuestion: state.clinicalContextResult?.structured_question || '',
      findings: state.imageObservationResult?.findings || [],
      hypotheses: state.hypotheses || [],
      patientAge: state.patientAge || 'unknown',
      patientSymptoms: state.patientSymptoms || 'not provided',
      patientHistory: state.patientHistory || 'not provided',
    });
    return { ...state, differentialExpansionPrompt: prompt, currentPhase: 'differentialExpansion' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.differentialExpansionPrompt, { node: 'differentialExpansion' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);

    // New hypotheses to add
    const newHypotheses = (result.new_hypotheses || []).map((h, i) => ({
      id: `hyp_diff_${state.iteration || 0}_${i}`,
      label: h.label || `Differential ${i + 1}`,
      supporting_findings: h.supporting_findings || [],
      conflicting_findings: h.conflicting_findings || [],
      confidence: Number(h.confidence ?? 0.3),
      status: 'active',
      reasoning: h.reasoning || '',
    }));

    // Confidence adjustments to existing hypotheses
    const adjustments = result.confidence_adjustments || [];
    const merged = [...(state.hypotheses || [])];
    for (const adj of adjustments) {
      const idx = merged.findIndex(h => h.label.toLowerCase() === (adj.label || '').toLowerCase());
      if (idx >= 0) {
        merged[idx].confidence = Number(adj.new_confidence ?? merged[idx].confidence);
        if (adj.status) merged[idx].status = adj.status;
      }
    }

    // Add new hypotheses (avoid duplicates)
    for (const h of newHypotheses) {
      if (!merged.find(e => e.label.toLowerCase() === h.label.toLowerCase())) {
        merged.push(h);
      }
    }

    const missingEvidence = result.missing_evidence || [];
    const discriminators  = result.discriminating_features || [];

    const node = {
      id: `node_differential_expansion_${state.iteration || 0}`,
      type: 'differential_expansion',
      goal: 'Expand and structure the differential diagnosis',
      content: {
        new_hypotheses: newHypotheses,
        adjustments,
        missing_evidence: missingEvidence,
        discriminating_features: discriminators,
        total_hypotheses: merged.length,
      },
      raw_output: llmResponse,
      status: 'completed',
      confidence: Math.max(...merged.map(h => h.confidence), 0),
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        hypotheses: merged,
        missingEvidence,
        discriminatingFeatures: discriminators,
        differentialExpansionResult: result,
      },
      node, 'differentialExpansion'
    );
  },
};

module.exports = differentialExpansionNode;

