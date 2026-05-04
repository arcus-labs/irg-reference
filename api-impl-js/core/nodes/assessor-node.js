/**
 * Assessor Node
 *
 * The external auditor that verifies the Evaluation node's assessment.
 * Scores across 6 EIE dimensions and produces a judgment artifact.
 *
 * Prepare: Renders assessor prompt with evaluation results and trace
 * LLM Call: Calls LLM to assess and score
 * Process: Parses judgment artifact and determines gate decision
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');
const { buildFactCheckPromptResultSync } = require('../external-fact-check/claim-store');

function normalizeAssessorDecision(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return 'iterate';
  }

  if (['exit', 'release', 'accept', 'approved'].includes(normalized)) {
    return 'exit';
  }

  if (['iterate', 'refuse', 'revise', 'retry', 'reject'].includes(normalized)) {
    return 'iterate';
  }

  return normalized;
}

const assessorNode = {
  id: 'assessor',
  type: 'assessor',

  prepare(state, prompts) {
    // Safety check: if assessor prompt not found, use a default
    if (!prompts) {
      console.warn('[assessor-node] Prompts object is null/undefined');
      return { ...state, assessorPrompt: '', currentPhase: 'assessor' };
    }

    if (!prompts.assessor) {
      console.warn('[assessor-node] Assessor prompt not found in prompts object');
      console.warn('[assessor-node] Available prompts:', Object.keys(prompts).join(', '));
      console.warn('[assessor-node] Prompts object type:', typeof prompts);
      console.warn('[assessor-node] Prompts object keys:', Object.keys(prompts));
      return { ...state, assessorPrompt: '', currentPhase: 'assessor' };
    }

    // Build the trace summary for verification
    const traceNodes = state.trace || [];
    const traceSummary = traceNodes.map(node => ({
      id: node.id,
      type: node.type,
      goal: node.goal,
      confidence: node.confidence,
      status: node.status,
    }));
    const factCheckPromptResult = buildFactCheckPromptResultSync(state.factCheckResult);

    const prompt = buildPrompt(prompts.assessor, {
      originalQuery: state.originalQuery,
      metaEvaluationResult: state.metaEvaluationResult || {},
      draftEvaluation: state.draftEvaluation || {},
      currentDraft: state.currentDraft || '',
      traceSummary: JSON.stringify(traceSummary, null, 2),
      factCheckResult: factCheckPromptResult,
      adversaryResult: state.adversaryResult || {},
      impactResult: state.impactResult || {},
    });

    console.log('[assessor-node] Prompt built, length:', prompt.length);
    if (prompt.length === 0) {
      console.warn('[assessor-node] WARNING: Assessor prompt is empty!');
    }

    return { ...state, assessorPrompt: prompt, currentPhase: 'assessor' };
  },

  async llmCall(state, llmClient) {
    // Safety check: if assessor prompt is empty, return empty response
    if (!state.assessorPrompt) {
      console.warn('[assessor-node] assessorPrompt is empty, skipping LLM call');
      return '{}';
    }

    console.log('[assessor-node] Making LLM call with prompt length:', state.assessorPrompt.length);
    console.log('[assessor-node] Prompt preview:', state.assessorPrompt.substring(0, 200));

    const response = await llmClient.call(state.assessorPrompt, { node: 'assessor' });

    console.log('[assessor-node] LLM response type:', typeof response);
    if (typeof response === 'object' && response.content) {
      console.log('[assessor-node] Response content length:', response.content.length);
      console.log('[assessor-node] Response usage:', response.usage);
    } else if (typeof response === 'string') {
      console.log('[assessor-node] Response length:', response.length);
    }

    return response;
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    let content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    // Safety check: ensure content is a string
    if (typeof content !== 'string') {
      console.warn('[assessor-node] content is not a string:', typeof content);
      content = '{}';
    }

    // Strip markdown code blocks if present (e.g., ```json {...} ```)
    let cleanedResponse = content.trim();
    if (cleanedResponse.startsWith('```')) {
      // Remove opening code fence (e.g., ```json or ```)
      cleanedResponse = cleanedResponse.replace(/^```[a-z]*\n?/, '');
      // Remove closing code fence
      cleanedResponse = cleanedResponse.replace(/\n?```$/, '');
    }

    const result = safeParseJson(cleanedResponse);

    // Extract EIE dimension scores and justifications
    const eieDimensions = result.eie_dimensions || {};

    // Helper function to extract score from either new format (object with score) or old format (number)
    const extractDimensionData = (dimension) => {
      const dimData = eieDimensions[dimension];
      if (typeof dimData === 'object' && dimData !== null) {
        return {
          score: Number(dimData.score ?? 0.5),
          justification: dimData.justification || '',
          supporting_examples: Array.isArray(dimData.supporting_examples) ? dimData.supporting_examples : [],
          improvement_areas: dimData.improvement_areas || '',
        };
      }
      // Fallback to old format (just a number)
      return {
        score: Number(dimData ?? 0.5),
        justification: '',
        supporting_examples: [],
        improvement_areas: '',
      };
    };

    const claimEvidenceAlignment = extractDimensionData('claim_evidence_alignment');
    const confidenceCalibration = extractDimensionData('confidence_calibration');
    const scopeDiscipline = extractDimensionData('scope_discipline');
    const omissionAwareness = extractDimensionData('omission_awareness');
    const internalConsistency = extractDimensionData('internal_consistency');
    const reasoningTransparency = extractDimensionData('reasoning_transparency');

    // Calculate overall EIE score
    const overallEieScore = (
      claimEvidenceAlignment.score +
      confidenceCalibration.score +
      scopeDiscipline.score +
      omissionAwareness.score +
      internalConsistency.score +
      reasoningTransparency.score
    ) / 6;

    const verificationConfidence = Number(result.verification_confidence ?? 0.5);
    const assessorDecision = normalizeAssessorDecision(
      result.assessor_decision || result.decision || result.release_decision
    );
    const reasoning = result.reasoning || '';
    const riskFlags = result.risk_flags || [];
    const remediationGuidance = result.remediation_guidance || '';

    const node = {
      id: `node_assessor_${state.iteration || 0}`,
      type: 'assessor',
      goal: 'Assess governance integrity and produce judgment artifact',
      content: {
        eie_dimensions: {
          claim_evidence_alignment: claimEvidenceAlignment,
          confidence_calibration: confidenceCalibration,
          scope_discipline: scopeDiscipline,
          omission_awareness: omissionAwareness,
          internal_consistency: internalConsistency,
          reasoning_transparency: reasoningTransparency,
        },
        overall_eie_score: overallEieScore,
        verification_confidence: verificationConfidence,
        assessor_decision: assessorDecision,
        release_decision: assessorDecision,
        reasoning,
        risk_flags: riskFlags,
        remediation_guidance: remediationGuidance,
      },
      raw_output: content,
      status: 'completed',
      confidence: verificationConfidence,
      tokens,
      timestamp: new Date().toISOString(),
    };

    // Accumulate tokens in state
    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    const newState = {
      ...state,
      assessorResult: result,
      judgmentArtifact: {
        eie_dimensions: {
          claim_evidence_alignment: claimEvidenceAlignment,
          confidence_calibration: confidenceCalibration,
          scope_discipline: scopeDiscipline,
          omission_awareness: omissionAwareness,
          internal_consistency: internalConsistency,
          reasoning_transparency: reasoningTransparency,
        },
        overall_eie_score: overallEieScore,
        verification_confidence: verificationConfidence,
        assessor_decision: assessorDecision,
        release_decision: assessorDecision,
        reasoning,
        risk_flags: riskFlags,
        remediation_guidance: remediationGuidance,
      },
      total_tokens_used: newTokens,
    };

    return recordNode(newState, node, 'assessor');
  },
};

module.exports = assessorNode;

