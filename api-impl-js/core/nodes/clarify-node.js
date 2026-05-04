/**
 * Clarify Node
 *
 * Identifies ambiguities and missing context in the original query.
 * Helps ensure the reasoning process starts with a clear understanding.
 *
 * Prepare: Renders clarify prompt with query and context
 * LLM Call: Calls LLM to identify ambiguities
 * Process: Parses response and records results
 */

'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');

const EXPLANATORY_QUERY_PATTERN = /^(why|how)\b/i;
const HARD_BLOCKING_AMBIGUITY_PATTERN = /\b(timeframe|time horizon|jurisdiction|asset class|market regime|ticker|country|state|city|location|date|year|dosage|dose|specific contract|specific patient|specific market|benchmark|comparison baseline)\b/i;
const HARD_BLOCKING_FAILURE_MODES = new Set([
  'unknown_invented_referent',
  'fabricated_authority',
  'invalid_metric',
  'pseudo_quantification',
  'category_mismatch',
  'mechanism_mismatch',
  'mixed_valid_invalid',
  'unsupported_optimization',
  'unsupported_extrapolation',
]);

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function hasUnrecognizedCoreConcepts(coreConcepts) {
  return normalizeList(coreConcepts).some((concept) => concept && concept.recognized === false);
}

function shouldDowngradeSoftAmbiguity(result, originalQuery) {
  if (result.premise_type !== 'ambiguous') return false;
  if (result.can_proceed !== false && result.early_exit !== true) return false;
  if (!EXPLANATORY_QUERY_PATTERN.test(String(originalQuery || '').trim().toLowerCase())) return false;
  if (hasUnrecognizedCoreConcepts(result.core_concepts)) return false;
  if (normalizeList(result.invalid_components).length > 0) return false;
  if (normalizeList(result.dangerous_terms).length > 0) return false;

  const failureModes = normalizeList(result.failure_modes).map((value) => String(value || '').trim().toLowerCase());
  if (failureModes.some((mode) => HARD_BLOCKING_FAILURE_MODES.has(mode))) return false;

  const ambiguityText = [
    ...normalizeList(result.ambiguities),
    ...normalizeList(result.missing_context),
    ...normalizeList(result.clarification_questions),
    result.scope_assessment,
    result.premise_explanation,
    result.reasoning,
  ].join(' ').toLowerCase();

  return !HARD_BLOCKING_AMBIGUITY_PATTERN.test(ambiguityText);
}

function applySoftAmbiguityOverride(result, originalQuery) {
  if (!shouldDowngradeSoftAmbiguity(result, originalQuery)) {
    return result;
  }

  const assumptions = normalizeList(result.assumptions);
  const overrideAssumption = 'Proceed with a reasonable default interpretation and answer in general terms rather than stopping for clarification.';
  if (!assumptions.includes(overrideAssumption)) {
    assumptions.push(overrideAssumption);
  }

  return {
    ...result,
    assumptions,
    can_proceed: true,
    early_exit: false,
    clarification_questions: [],
    scope_assessment: result.scope_assessment || 'Grounded explanatory question with only non-blocking ambiguity.',
    reasoning: [
      result.reasoning,
      'Non-blocking ambiguity detected; proceed with a reasonable default interpretation instead of forcing clarification.',
    ].filter(Boolean).join(' '),
  };
}


const clarifyNode = {
  id: 'clarify',
  type: 'clarify',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.clarify, {
      originalQuery: state.originalQuery,
      context: state.context,
    });
    return { ...state, clarifyPrompt: prompt, currentPhase: 'clarify' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.clarifyPrompt, { node: 'clarify' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    let result = safeParseJson(content);
    result.core_concepts = result.core_concepts || [];
    result.premise_type = result.premise_type || 'valid';
    result.premise_explanation = result.premise_explanation || '';
    result.ambiguities = result.ambiguities || [];
    result.missing_context = result.missing_context || [];
    result.assumptions = result.assumptions || [];
    result.scope_assessment = result.scope_assessment || '';
    result.failure_modes = Array.isArray(result.failure_modes) ? result.failure_modes : [];
    result.salvageable_core = result.salvageable_core || '';
    result.invalid_components = Array.isArray(result.invalid_components) ? result.invalid_components : [];
    result.dangerous_terms = Array.isArray(result.dangerous_terms) ? result.dangerous_terms : [];
    result.clarification_questions = result.clarification_questions || [];
    result.can_proceed = result.can_proceed !== false;
    result.early_exit = result.early_exit === true;
    result.confidence = Number(result.confidence ?? 0.5);
    result.reasoning = result.reasoning || '';
    result = applySoftAmbiguityOverride(result, state.originalQuery);

    const node = {
      id: `node_clarify_${state.iteration || 0}`,
      type: 'clarify',
      goal: 'Identify ambiguities and missing context',
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
      { ...state, clarifyResult: result, total_tokens_used: newTokens },
      node, 'clarify'
    );
  },
};

module.exports = clarifyNode;

