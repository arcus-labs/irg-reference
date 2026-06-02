/**
 * ClinicalContext Node (Clarify)
 *
 * Goal: Capture and disambiguate the clinical question before any imaging reasoning.
 * Inputs: User question, patient metadata (age, symptoms, history) if available.
 * Outputs: structured_question, assumptions, missing_info, can_proceed flag.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const clinicalContextNode = {
  id: 'clinicalContext',
  type: 'clinical_context',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.clinicalContext, {
      clinicalQuestion: state.clinicalQuestion || state.originalQuery,
      patientAge: state.patientAge || 'unknown',
      patientSymptoms: state.patientSymptoms || 'not provided',
      patientHistory: state.patientHistory || 'not provided',
      imagingModality: state.imagingModality || 'X-ray',
      bodyRegion: state.bodyRegion || 'not specified',
    });
    return { ...state, clinicalContextPrompt: prompt, currentPhase: 'clinicalContext' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.clinicalContextPrompt, { node: 'clinicalContext' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    result.structured_question = result.structured_question || state.clinicalQuestion || state.originalQuery;
    result.assumptions         = result.assumptions         || [];
    result.missing_info        = result.missing_info        || [];
    result.can_proceed         = result.can_proceed !== false;
    result.confidence          = Number(result.confidence ?? 0.5);

    const node = {
      id: `node_clinical_context_${state.iteration || 0}`,
      type: 'clinical_context',
      goal: 'Capture and disambiguate the clinical question',
      content: result,
      raw_output: llmResponse,
      status: 'completed',
      confidence: result.confidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, clinicalContextResult: result },
      node, 'clinicalContext'
    );
  },
};

module.exports = clinicalContextNode;

