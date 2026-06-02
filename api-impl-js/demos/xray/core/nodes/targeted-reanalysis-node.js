/**
 * TargetedReanalysis Node (Vision Loop)
 *
 * Goal: Re-run vision for specific questions, not entire images.
 * Inputs: Triggers from Hypotheses / Adversary (e.g., "check for air bronchograms").
 * Outputs: Focused findings, local confidence for each targeted feature.
 * Edges:
 *   triggered_by: Hypothesis IDs or Adversary findings.
 *   Feeds into EvidenceLink.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const targetedReanalysisNode = {
  id: 'targetedReanalysis',
  type: 'targeted_reanalysis',

  prepare(state, prompts) {
    // Collect targeted questions from adversary + missing evidence + discriminators
    const targetedQuestions = [
      ...(state.adversaryResult?.targeted_questions || []),
      ...(state.adversaryResult?.disproval_checklist || []),
      ...(state.discriminatingFeatures || []),
    ];

    const prompt = buildPrompt(prompts.targetedReanalysis, {
      targetedQuestions,
      findings: state.imageObservationResult?.findings || [],
      hypotheses: state.hypotheses || [],
      imageDescriptions: state.imageDescriptions || 'No image descriptions provided',
      bodyRegion: state.bodyRegion || 'not specified',
    });
    return { ...state, targetedReanalysisPrompt: prompt, currentPhase: 'targetedReanalysis' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.targetedReanalysisPrompt, { node: 'targetedReanalysis' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    const focusedFindings = (result.focused_findings || []).map((f, i) => ({
      id: `focused_${state.iteration || 0}_${i}`,
      question: f.question || '',
      finding: f.finding || '',
      present: f.present ?? null,
      confidence: Number(f.confidence ?? 0.5),
      triggered_by: f.triggered_by || [],
    }));

    // Append to accumulated targeted findings
    const allTargetedFindings = [
      ...(state.targetedFindings || []),
      ...focusedFindings,
    ];

    const node = {
      id: `node_targeted_reanalysis_${state.iteration || 0}`,
      type: 'targeted_reanalysis',
      goal: 'Re-examine image for specific features',
      content: { focused_findings: focusedFindings, total_queries: focusedFindings.length },
      raw_output: llmResponse,
      status: 'completed',
      confidence: focusedFindings.length > 0
        ? focusedFindings.reduce((s, f) => s + f.confidence, 0) / focusedFindings.length
        : 0.5,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        targetedFindings: allTargetedFindings,
        targetedReanalysisResult: result,
      },
      node, 'targetedReanalysis'
    );
  },
};

module.exports = targetedReanalysisNode;

