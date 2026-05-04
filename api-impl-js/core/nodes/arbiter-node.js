/**
 * Arbiter Node
 *
 * Synthesizes the proposed strategy and adversarial critique into a unified,
 * comprehensive response strategy that addresses both perspectives.
 * Acts as a wise mediator between the strategic vision and critical concerns.
 *
 * Prepare: Renders arbiter prompt with strategy and adversary results
 * LLM Call: Calls LLM to synthesize both perspectives
 * Process: Parses synthesis and records the unified strategy
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');

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

function normalizeFinalStrategy(finalStrategy, state) {
  const strategyResult = state.strategyResult || {};
  const strategyBlueprint = strategyResult.blueprint || {};
  const counterBlueprint = state.adversaryResult?.counter_blueprint?.use_counter_blueprint === true
    ? state.adversaryResult.counter_blueprint
    : {};
  const result = (finalStrategy && typeof finalStrategy === 'object') ? finalStrategy : {};

  const fallbackPolicy = counterBlueprint.response_policy?.policy
    ? counterBlueprint.response_policy
    : strategyResult.response_policy?.policy
      ? strategyResult.response_policy
      : {};

  const fallbackSectionPlan = Array.isArray(counterBlueprint.section_plan) && counterBlueprint.section_plan.length > 0
    ? counterBlueprint.section_plan
    : strategyBlueprint.section_plan || [];

  return {
    key_points: Array.isArray(result.key_points) ? result.key_points : strategyResult.key_points || [],
    structure: Array.isArray(result.structure) ? result.structure : strategyResult.structure || [],
    reasoning_approach: result.reasoning_approach || strategyResult.reasoning_approach || '',
    evidence_types: Array.isArray(result.evidence_types) ? result.evidence_types : strategyResult.evidence_types || [],
    response_policy: normalizeResponsePolicy(result.response_policy, fallbackPolicy),
    forbidden_moves: Array.isArray(result.forbidden_moves)
      ? result.forbidden_moves
      : Array.isArray(strategyBlueprint.forbidden_moves)
        ? strategyBlueprint.forbidden_moves
        : [],
    required_moves: Array.isArray(result.required_moves)
      ? result.required_moves
      : Array.isArray(strategyBlueprint.required_moves)
        ? strategyBlueprint.required_moves
        : [],
    section_plan: (Array.isArray(result.section_plan) && result.section_plan.length > 0
      ? result.section_plan
      : Array.isArray(fallbackSectionPlan)
        ? fallbackSectionPlan
        : []).map(normalizeSectionPlanItem),
  };
}

const arbiterNode = {
  id: 'arbiter',
  type: 'arbiter',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.arbiter, {
      originalQuery: state.originalQuery,
      context: state.context,
      clarifyResult: state.clarifyResult || {},
      strategyResult: state.strategyResult || {},
      adversaryResult: state.adversaryResult || {},
      responsePolicyRubric: prompts.response_policy_rubric || '',
    });
    return { ...state, arbiterPrompt: prompt, currentPhase: 'arbiter' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.arbiterPrompt, { node: 'arbiter' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    const result = safeParseJson(content);
    result.final_strategy = normalizeFinalStrategy(result.final_strategy, state);
    result.synthesis = result.synthesis || '';
    result.addressed_concerns = Array.isArray(result.addressed_concerns) ? result.addressed_concerns : [];
    result.laundering_risks_resolved = Array.isArray(result.laundering_risks_resolved) ? result.laundering_risks_resolved : [];
    result.confidence = Number(result.confidence ?? 0.8);

    const node = {
      id: `node_arbiter_${state.iteration || 0}`,
      type: 'arbiter',
      goal: 'Synthesize strategy and adversarial critique into unified response strategy',
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
      { ...state, arbiterResult: result, total_tokens_used: newTokens },
      node, 'arbiter'
    );
  },
};

module.exports = arbiterNode;

