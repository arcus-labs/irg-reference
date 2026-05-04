/**
 * Impact Node
 *
 * Predicts downstream effects and risks of the proposed response.
 * Evaluates potential harms and positive impacts.
 *
 * Prepare: Renders impact prompt with query and draft results
 * LLM Call: Calls LLM to predict impacts
 * Process: Parses response and records impact assessment
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');

const impactNode = {
  id: 'impact',
  type: 'impact_prediction',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.impact, {
      originalQuery:  state.originalQuery,
      currentDraft:   state.currentDraft || '',
      evaluateResult: state.evaluateResult || {},
    });
    return { ...state, impactPrompt: prompt, currentPhase: 'impact' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.impactPrompt, { node: 'impact' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    const result = safeParseJson(content);
    result.implications = result.implications || [];
    result.limitations = result.limitations || [];
    result.confidence = Number(result.confidence ?? 0.5);

    const node = {
      id: `node_impact_${state.iteration || 0}`,
      type: 'impact_prediction',
      goal: 'Predict downstream effects and risks',
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
      { ...state, impactResult: result, total_tokens_used: newTokens },
      node, 'impact'
    );
  },
};

module.exports = impactNode;

