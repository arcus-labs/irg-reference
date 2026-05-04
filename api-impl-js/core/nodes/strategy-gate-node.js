/**
 * Strategy Gate Node
 *
 * Pure logic node (no LLM call) that decides whether to proceed or exit early.
 * If the query is deemed unanswerable, routes directly to record node.
 *
 * Prepare: Updates phase
 * LLM Call: None (null)
 * Process: Evaluates clarification results and makes routing decision
 */

'use strict';

const { recordNode } = require('./node-utils');

const CLARIFICATION_REQUIRED_POLICIES = new Set([
  'ask_for_clarification',
  'request_clarification_before_proceeding',
  'reject_unknown_referent_and_clarify',
]);
const SOFT_EXPLANATORY_OVERRIDE_POLICIES = new Set([
  ...CLARIFICATION_REQUIRED_POLICIES,
  'answer_with_correction',
]);

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

function shouldOverrideClarificationPolicy(clarify, responsePolicy, originalQuery) {
  const policyName = responsePolicy?.policy || '';
  if (!SOFT_EXPLANATORY_OVERRIDE_POLICIES.has(policyName)) return false;
  if (!['valid', 'ambiguous'].includes(clarify?.premise_type)) return false;
  if (clarify?.can_proceed !== true || clarify?.early_exit === true) return false;
  if (!EXPLANATORY_QUERY_PATTERN.test(String(originalQuery || '').trim().toLowerCase())) return false;
  if (hasUnrecognizedCoreConcepts(clarify?.core_concepts)) return false;
  if (normalizeList(clarify?.invalid_components).length > 0) return false;
  if (normalizeList(clarify?.dangerous_terms).length > 0) return false;

  const failureModes = normalizeList(clarify?.failure_modes).map((value) => String(value || '').trim().toLowerCase());
  if (failureModes.some((mode) => HARD_BLOCKING_FAILURE_MODES.has(mode))) return false;

  const ambiguityText = [
    ...normalizeList(clarify?.ambiguities),
    ...normalizeList(clarify?.missing_context),
    ...normalizeList(clarify?.clarification_questions),
    clarify?.scope_assessment,
    clarify?.premise_explanation,
    clarify?.reasoning,
  ].join(' ').toLowerCase();

  return !HARD_BLOCKING_AMBIGUITY_PATTERN.test(ambiguityText);
}

function overrideClarificationPolicy(responsePolicy) {
  return {
    ...responsePolicy,
    policy: 'answer_normally',
    rationale: [
      responsePolicy?.rationale,
      'Soft explanatory override: grounded explanatory question can be answered in general terms without forcing clarification or correction-first framing.',
    ].filter(Boolean).join(' '),
  };
}

const strategyGateNode = {
  id: 'strategyGate',
  type: 'strategy_gate',

  prepare(state) {
    return { ...state, currentPhase: 'strategyGate' };
  },

  llmCall: null,

  process(state) {
    const clarify = state.clarifyResult || {};
    const strategy = state.strategyResult || {};
    const arbiter = state.arbiterResult || {};
    const finalStrategy = arbiter.final_strategy || {};
    const strategyBlueprint = strategy.blueprint || {};

    let responsePolicy = finalStrategy.response_policy?.policy
      ? finalStrategy.response_policy
      : strategy.response_policy?.policy
        ? strategy.response_policy
        : {};

    if (shouldOverrideClarificationPolicy(clarify, responsePolicy, state.originalQuery)) {
      responsePolicy = overrideClarificationPolicy(responsePolicy);
    }

    const responseContract = {
      response_policy: responsePolicy,
      dangerous_terms: Array.isArray(clarify.dangerous_terms) ? clarify.dangerous_terms : [],
      invalid_components: Array.isArray(clarify.invalid_components) ? clarify.invalid_components : [],
      failure_modes: Array.isArray(clarify.failure_modes) ? clarify.failure_modes : [],
      laundering_risks: Array.isArray(state.adversaryResult?.laundering_risks) ? state.adversaryResult.laundering_risks : [],
      forbidden_moves: Array.isArray(finalStrategy.forbidden_moves) && finalStrategy.forbidden_moves.length > 0
        ? finalStrategy.forbidden_moves
        : Array.isArray(strategyBlueprint.forbidden_moves)
          ? strategyBlueprint.forbidden_moves
          : [],
      required_moves: Array.isArray(finalStrategy.required_moves) && finalStrategy.required_moves.length > 0
        ? finalStrategy.required_moves
        : Array.isArray(strategyBlueprint.required_moves)
          ? strategyBlueprint.required_moves
          : [],
      section_plan: Array.isArray(finalStrategy.section_plan) && finalStrategy.section_plan.length > 0
        ? finalStrategy.section_plan
        : Array.isArray(strategyBlueprint.section_plan)
          ? strategyBlueprint.section_plan
          : [],
    };

    const policyName = responseContract.response_policy?.policy || '';

    const exitReasons = [];
    if (clarify.can_proceed === false) exitReasons.push('clarify.cannot_proceed');
    if (clarify.early_exit === true) exitReasons.push('clarify.early_exit');
    if (CLARIFICATION_REQUIRED_POLICIES.has(policyName)) exitReasons.push(`response_policy:${policyName}`);

    const unanswerable = exitReasons.length > 0;
    const decision = unanswerable ? 'unanswerable' : 'approved';

    const node = {
      id: `node_strategy_gate_${state.iteration || 0}`,
      type: 'strategy_gate',
      goal: 'Decide whether to proceed or exit early',
      content: {
        decision,
        unanswerable,
        source: responsePolicy.policy ? 'strategy_policy' : 'clarify_signal',
        exit_reasons: exitReasons,
        response_contract: responseContract,
      },
      status: 'completed',
      confidence: 1.0,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        strategyDecision: decision,
        responseContract,
        _exit: unanswerable,
        // For new interpreter: set decision for routing
        _nodeDecision: decision,
      },
      node, 'strategyGate'
    );
  },
};

module.exports = strategyGateNode;

