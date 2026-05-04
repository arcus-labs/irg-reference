/**
 * Adversary Node
 *
 * Challenges assumptions and identifies strategy flaws through adversarial critique.
 * Helps identify weaknesses before committing to a response.
 *
 * Prepare: Renders adversary prompt with query and clarification results
 * LLM Call: Calls LLM to critique the strategy
 * Process: Parses response and records critical findings
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');

function normalizeResponsePolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    return { policy: '', rationale: '' };
  }

  return {
    policy: policy.policy || '',
    rationale: policy.rationale || '',
  };
}

const adversaryNode = {
  id: 'adversary',
  type: 'adversary',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.adversary, {
      originalQuery: state.originalQuery,
      clarifyResult: state.clarifyResult,
      strategyResult: state.strategyResult || {},
      responsePolicyRubric: prompts.response_policy_rubric || '',
    });
    return { ...state, adversaryPrompt: prompt, currentPhase: 'adversary' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.adversaryPrompt, { node: 'adversary' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    const result = safeParseJson(content);
    result.weak_assumptions = result.weak_assumptions || [];
    result.strategy_flaws = result.strategy_flaws || [];
    result.recommended_adjustments = result.recommended_adjustments || [];
    result.laundering_risks = Array.isArray(result.laundering_risks) ? result.laundering_risks : [];
    result.blueprint_gaps = Array.isArray(result.blueprint_gaps) ? result.blueprint_gaps : [];

    const counterBlueprint = result.counter_blueprint && typeof result.counter_blueprint === 'object'
      ? result.counter_blueprint
      : {};

    result.counter_blueprint = {
      use_counter_blueprint: counterBlueprint.use_counter_blueprint === true,
      reason: counterBlueprint.reason || '',
      response_policy: normalizeResponsePolicy(counterBlueprint.response_policy),
      section_plan: Array.isArray(counterBlueprint.section_plan) ? counterBlueprint.section_plan : [],
    };

    result.confidence = Number(result.confidence ?? 0.5);

    const node = {
      id: `node_adversary_${state.iteration || 0}`,
      type: 'adversary',
      goal: 'Challenge assumptions and identify strategy flaws',
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
      { ...state, adversaryResult: result, total_tokens_used: newTokens },
      node, 'adversary'
    );
  },
};

module.exports = adversaryNode;

