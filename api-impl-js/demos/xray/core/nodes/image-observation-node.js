/**
 * ImageObservation Node
 *
 * Actor: Vision model.
 * Goal: Extract findings only, never diagnoses.
 * Inputs: image_xray_*, structured_question, assumptions.
 * Outputs: findings[], image_quality + reasons, observation_confidence.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const imageObservationNode = {
  id: 'imageObservation',
  type: 'image_observation',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.imageObservation, {
      structuredQuestion: state.clinicalContextResult?.structured_question || state.clinicalQuestion,
      assumptions: state.clinicalContextResult?.assumptions || [],
      bodyRegion: state.bodyRegion || 'not specified',
      imagingModality: state.imagingModality || 'X-ray',
      imageDescriptions: state.imageDescriptions || 'No image descriptions provided',
    });
    return { ...state, imageObservationPrompt: prompt, currentPhase: 'imageObservation' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.imageObservationPrompt, { node: 'imageObservation' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    result.findings               = result.findings               || [];
    result.image_quality          = result.image_quality          || 'unknown';
    result.image_quality_reasons  = result.image_quality_reasons  || [];
    result.observation_confidence = Number(result.observation_confidence ?? 0.5);
    result.systematic_review      = result.systematic_review      || {};

    const node = {
      id: `node_image_observation_${state.iteration || 0}`,
      type: 'image_observation',
      goal: 'Extract radiographic findings without diagnoses',
      content: result,
      raw_output: llmResponse,
      status: 'completed',
      confidence: result.observation_confidence,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, imageObservationResult: result },
      node, 'imageObservation'
    );
  },
};

module.exports = imageObservationNode;

