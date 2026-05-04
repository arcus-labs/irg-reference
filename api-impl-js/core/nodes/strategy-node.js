/**
 * Strategy Node
 *
 * Elaborates on the response strategy based on clarification and adversarial critique.
 * On iterations, incorporates learnings from previous meta-evaluation to improve the strategy.
 * Generates a detailed plan for how to approach the query, including key points,
 * structure, and reasoning approach.
 *
 * Prepare: Renders strategy prompt with clarification, adversary results, and iteration learnings
 * LLM Call: Calls LLM to generate detailed strategy
 * Process: Parses strategy response and records it
 */

'use strict';

const { buildPrompt, recordNode, safeParseJson, extractTokens } = require('./node-utils');

function normalizeResponsePolicy(policy, fallbackPolicy = {}) {
  const fallback = (fallbackPolicy && typeof fallbackPolicy === 'object')
    ? fallbackPolicy
    : { policy: fallbackPolicy || '' };

  if (typeof policy === 'string' && policy.trim()) {
    return {
      policy: policy.trim(),
      rationale: fallback.rationale || '',
      delivery_goal: fallback.delivery_goal || fallback.user_experience_goal || '',
      delivery_variant: fallback.delivery_variant || fallback.style_variant_brief || '',
    };
  }

  if (!policy || typeof policy !== 'object') {
    return {
      policy: fallback.policy || '',
      rationale: fallback.rationale || '',
      delivery_goal: fallback.delivery_goal || fallback.user_experience_goal || '',
      delivery_variant: fallback.delivery_variant || fallback.style_variant_brief || '',
    };
  }

  return {
    policy: policy.policy || fallback.policy || '',
    rationale: policy.rationale || fallback.rationale || '',
    delivery_goal: policy.delivery_goal || policy.user_experience_goal || fallback.delivery_goal || fallback.user_experience_goal || '',
    delivery_variant: policy.delivery_variant || policy.style_variant_brief || fallback.delivery_variant || fallback.style_variant_brief || '',
  };
}

function normalizeSectionPlanItem(section) {
  if (!section || typeof section !== 'object') {
    return {
      tag: '',
      goal: '',
      instruction: '',
      reasoning: '',
      preferred_content: [],
      forbidden_content: [],
      tone_notes: '',
    };
  }

  return {
    tag: section.tag || '',
    goal: section.goal || '',
    instruction: section.instruction || '',
    reasoning: section.reasoning || '',
    preferred_content: Array.isArray(section.preferred_content) ? section.preferred_content : [],
    forbidden_content: Array.isArray(section.forbidden_content) ? section.forbidden_content : [],
    tone_notes: section.tone_notes || '',
  };
}

function normalizeEngagementVariant(variant, fallbackVariant = {}) {
  const fallback = (fallbackVariant && typeof fallbackVariant === 'object') ? fallbackVariant : {};

  if (!variant || typeof variant !== 'object') {
    return {
      style_handle: fallback.style_handle || '',
      style_goal: fallback.style_goal || '',
      hard_constraints: Array.isArray(fallback.hard_constraints) ? fallback.hard_constraints : [],
    };
  }

  return {
    style_handle: variant.style_handle || fallback.style_handle || '',
    style_goal: variant.style_goal || fallback.style_goal || '',
    hard_constraints: Array.isArray(variant.hard_constraints)
      ? variant.hard_constraints
      : Array.isArray(fallback.hard_constraints)
        ? fallback.hard_constraints
        : [],
  };
}

function normalizeBlueprint(blueprint, fallbackBlueprint = {}) {
  const fallback = (fallbackBlueprint && typeof fallbackBlueprint === 'object') ? fallbackBlueprint : {};

  if (!blueprint || typeof blueprint !== 'object') {
    return {
      opening_act: fallback.opening_act || '',
      nonsense_scope: fallback.nonsense_scope || '',
      invalid_scope: fallback.invalid_scope || '',
      salvageable_core: fallback.salvageable_core || '',
      closest_legitimate_frame: fallback.closest_legitimate_frame || '',
      forbidden_moves: Array.isArray(fallback.forbidden_moves) ? fallback.forbidden_moves : [],
      required_moves: Array.isArray(fallback.required_moves) ? fallback.required_moves : [],
      engagement_variant: normalizeEngagementVariant(fallback.engagement_variant),
      section_plan: Array.isArray(fallback.section_plan) ? fallback.section_plan.map(normalizeSectionPlanItem) : [],
    };
  }

  return {
    opening_act: blueprint.opening_act || '',
    nonsense_scope: blueprint.nonsense_scope || fallback.nonsense_scope || '',
    invalid_scope: blueprint.invalid_scope || fallback.invalid_scope || '',
    salvageable_core: blueprint.salvageable_core || fallback.salvageable_core || '',
    closest_legitimate_frame: blueprint.closest_legitimate_frame || fallback.closest_legitimate_frame || '',
    forbidden_moves: Array.isArray(blueprint.forbidden_moves)
      ? blueprint.forbidden_moves
      : Array.isArray(fallback.forbidden_moves)
        ? fallback.forbidden_moves
        : [],
    required_moves: Array.isArray(blueprint.required_moves)
      ? blueprint.required_moves
      : Array.isArray(fallback.required_moves)
        ? fallback.required_moves
        : [],
    engagement_variant: normalizeEngagementVariant(blueprint.engagement_variant, fallback.engagement_variant),
    section_plan: (Array.isArray(blueprint.section_plan) ? blueprint.section_plan : Array.isArray(fallback.section_plan) ? fallback.section_plan : [])
      .map(normalizeSectionPlanItem),
  };
}

const strategyNode = {
  id: 'strategy',
  type: 'strategy',

  prepare(state, prompts) {
    // On iterations, include learnings from previous meta-evaluation and assessor feedback
    const iterationLearnings = state.draftEvaluation?.iterationLearnings || '';

    // Include detailed meta-evaluation feedback on iterations
    let metaEvalFeedback = '';
    if (state.iteration > 0 && state.draftEvaluation) {
      const evaluation = state.draftEvaluation;
      const feedbackItems = [];

      if (evaluation.executionQualityJustification && evaluation.executionQuality < 0.8) {
        feedbackItems.push(`Execution Quality (${(evaluation.executionQuality * 100).toFixed(0)}%): ${evaluation.executionQualityJustification}`);
      }
      if (evaluation.completenessJustification && evaluation.completeness < 0.8) {
        feedbackItems.push(`Completeness (${(evaluation.completeness * 100).toFixed(0)}%): ${evaluation.completenessJustification}`);
      }
      if (evaluation.clarityJustification && evaluation.clarity < 0.8) {
        feedbackItems.push(`Clarity (${(evaluation.clarity * 100).toFixed(0)}%): ${evaluation.clarityJustification}`);
      }

      if (feedbackItems.length > 0) {
        metaEvalFeedback = `\n\nMeta-Evaluation Quality Feedback:\n  - ${feedbackItems.join('\n  - ')}`;
      }
    }

    // Include assessor governance integrity feedback on iterations
    let assessorFeedback = '';
    if (state.iteration > 0 && state.judgmentArtifact) {
      const artifact = state.judgmentArtifact;
      const failedDimensions = Object.entries(artifact.eie_dimensions || {})
        .filter(([_, dimData]) => dimData.score < 0.8)
        .map(([dim, dimData]) => `${dim.replace(/_/g, ' ')}: ${dimData.justification || 'needs improvement'}`)
        .join('\n  - ');

      if (failedDimensions) {
        assessorFeedback = `\n\nGovernance Integrity Feedback from Assessor:\n  - ${failedDimensions}`;
      }
    }

    const prompt = buildPrompt(prompts.strategy, {
      originalQuery: state.originalQuery,
      context: state.context,
      clarifyResult: state.clarifyResult || {},
      adversaryResult: state.adversaryResult || {},
      responsePolicyRubric: prompts.response_policy_rubric || '',
      metaEvalFeedback: metaEvalFeedback,
      assessorFeedback: assessorFeedback,
      iterationLearnings: iterationLearnings,
      iteration: state.iteration || 0,
    });
    return { ...state, strategyPrompt: prompt, currentPhase: 'strategy' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.strategyPrompt, { node: 'strategy' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    const result = safeParseJson(content);
    const fallbackBlueprint = {
      salvageable_core: state.clarifyResult?.salvageable_core || '',
      invalid_scope: Array.isArray(state.clarifyResult?.invalid_components)
        ? state.clarifyResult.invalid_components.join('; ')
        : '',
      nonsense_scope: Array.isArray(state.clarifyResult?.dangerous_terms)
        ? state.clarifyResult.dangerous_terms.join('; ')
        : '',
      engagement_variant: {
        style_goal: '',
        style_handle: '',
        hard_constraints: [],
      },
    };

    result.key_points = result.key_points || [];
    result.structure = result.structure || [];
    result.reasoning_approach = result.reasoning_approach || '';
    result.evidence_types = result.evidence_types || [];
    result.response_policy = normalizeResponsePolicy(result.response_policy);
    result.blueprint = normalizeBlueprint(result.blueprint, fallbackBlueprint);
    result.confidence = Number(result.confidence ?? 0.75);

    const node = {
      id: `node_strategy_${state.iteration || 0}`,
      type: 'strategy',
      goal: 'Elaborate on response strategy and approach',
      content: result,
      raw_output: content,
      status: 'completed',
      confidence: result.confidence,
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

    return recordNode(
      { ...state, strategyResult: result, total_tokens_used: newTokens },
      node, 'strategy'
    );
  },
};

module.exports = strategyNode;

