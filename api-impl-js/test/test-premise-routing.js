'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphLinear } = require('../graphs/irg-graph-linear');
const nodeRegistry = require('../core/execution/irg-node-registry');

const prompts = yaml.load(fs.readFileSync(path.join(__dirname, '../core/prompts/irg-prompts.yaml'), 'utf8'));
const registryWrapper = { get: (nodeId) => nodeRegistry.getNode(nodeId) };

function usage() {
  return { input_tokens: 120, output_tokens: 80, total_tokens: 200 };
}

function buildLlm(responses, promptLog) {
  return {
    async call(prompt, opts) {
      const node = opts?.node;
      if (promptLog && node) {
        promptLog[node] = prompt;
      }
      return { content: JSON.stringify(responses[node] || {}), usage: usage() };
    },
  };
}

function happyTail(response) {
  return {
    adversary: { weak_assumptions: [], strategy_flaws: [], recommended_adjustments: [], confidence: 0.88 },
    arbiter: {
      synthesis: 'Combined strategy and critique.',
      final_strategy: { key_points: ['kp'], structure: ['intro'], reasoning_approach: 'direct', evidence_types: ['general knowledge'] },
      addressed_concerns: [],
      confidence: 0.87,
    },
    factCheck: { critical_claims: [], confidence: 0.82 },
    impact: { implications: [], limitations: [], confidence: 0.8 },
    draft: { response, confidence: 0.86 },
    metaEvaluation: { execution_quality: 0.9, completeness: 0.9, clarity: 0.9, confidence: 0.9, recommendation: 'exit', iteration_learnings: '' },
    assessor: {
      eie_dimensions: {
        claim_evidence_alignment: 0.9,
        confidence_calibration: 0.9,
        scope_discipline: 0.9,
        omission_awareness: 0.9,
        internal_consistency: 0.9,
        reasoning_transparency: 0.9,
      },
      verification_confidence: 0.9,
      assessor_decision: 'exit',
      reasoning: 'Acceptable.',
      risk_flags: [],
      remediation_guidance: '',
    },
  };
}

async function testFalsePremiseProceedsToDraft() {
  const promptLog = {};
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'antibiotics', recognized: true, notes: 'standard medical term' },
        { term: 'viral infections', recognized: true, notes: 'standard medical term' },
      ],
      premise_type: 'false_premise',
      premise_explanation: 'Antibiotics do not work against viruses; they treat bacterial infections.',
      ambiguities: [],
      missing_context: [],
      assumptions: ['The question assumes antibiotics treat viruses.'],
      scope_assessment: 'clear',
      failure_modes: ['false_premise'],
      salvageable_core: 'The user is asking about the role of antibiotics in infection treatment.',
      invalid_components: ['the assumption that antibiotics treat viral infections'],
      dangerous_terms: ['effective against viral infections'],
      clarification_questions: [],
      can_proceed: true,
      early_exit: false,
      confidence: 0.95,
      reasoning: 'The concepts are real, but the premise is false.',
    },
    strategy: {
      key_points: ['Correct the false premise', 'Explain antibiotics vs viruses'],
      structure: ['Correction', 'Explanation'],
      reasoning_approach: 'Correct first, then answer helpfully.',
      evidence_types: ['medical knowledge'],
      response_policy: {
        policy: 'answer_with_correction',
        rationale: 'Correction is required before answering the legitimate part.',
        delivery_goal: 'clear and non-condescending',
      },
      blueprint: {
        opening_act: 'Lead with a concise correction.',
        salvageable_core: 'Explain when antibiotics are useful.',
        closest_legitimate_frame: 'difference between viral and bacterial infections',
        forbidden_moves: ['do not imply antibiotics treat viruses'],
        required_moves: ['state that antibiotics treat bacterial infections'],
        engagement_variant: {
          style_handle: 'brief clinical explainer',
          style_goal: 'make the correction easy to understand',
          hard_constraints: ['do not soften the correction into ambiguity'],
        },
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Correct the premise immediately',
            instruction: 'State the correction in the first sentence',
            reasoning: 'Prevents the false premise from being laundered',
            preferred_content: ['short corrective answer'],
            forbidden_content: ['agreement with the false premise'],
            tone_notes: 'clear and respectful',
          },
        ],
      },
      confidence: 0.9,
    },
    ...happyTail('Antibiotics are not effective against viral infections. They treat bacterial infections instead.'),
    adversary: {
      weak_assumptions: [],
      strategy_flaws: [],
      recommended_adjustments: [],
      laundering_risks: ['The answer could accidentally imply antibiotics work on viruses if the correction is too soft.'],
      blueprint_gaps: ['Need an explicit opening correction.'],
      counter_blueprint: {
        use_counter_blueprint: false,
        reason: '',
        response_policy: {
          policy: 'answer_with_correction',
          rationale: 'The response posture is already correct.',
        },
        section_plan: [],
      },
      confidence: 0.88,
    },
    arbiter: {
      synthesis: 'Combined strategy and critique.',
      final_strategy: {
        key_points: ['kp'],
        structure: ['intro'],
        reasoning_approach: 'direct',
        evidence_types: ['general knowledge'],
      },
      addressed_concerns: [],
      laundering_risks_resolved: ['Resolved the risk of tacitly endorsing the false premise by keeping the opening corrective.'],
      confidence: 0.87,
    },
  }, promptLog);

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Why are antibiotics effective against viral infections?',
    context: 'medical question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'approved');
  assert.ok(result.nodes.some((n) => n.type === 'draft'));
  assert.ok(result.finalResponse.includes('not effective against viral infections'));
  assert.equal(result.clarifyResult.can_proceed, true);
  assert.equal(result.strategyResult.response_policy.policy, 'answer_with_correction');
  assert.deepEqual(result.strategyResult.blueprint.required_moves, ['state that antibiotics treat bacterial infections']);
  assert.equal(result.adversaryResult.counter_blueprint.response_policy.policy, 'answer_with_correction');
  assert.equal(result.arbiterResult.final_strategy.response_policy.policy, 'answer_with_correction');
  assert.deepEqual(result.arbiterResult.final_strategy.forbidden_moves, ['do not imply antibiotics treat viruses']);
  assert.deepEqual(result.responseContract.required_moves, ['state that antibiotics treat bacterial infections']);
  assert.equal(result.draftResult.execution_contract.response_policy.policy, 'answer_with_correction');
  assert.deepEqual(result.draftResult.execution_contract.forbidden_moves, ['do not imply antibiotics treat viruses']);
  assert.ok(result.draftResult.response.includes('## Overview'));
  assert.ok(promptLog.strategy.includes('RESPONSE-POLICY RUBRIC'));
  assert.ok(promptLog.adversary.includes('RESPONSE-POLICY RUBRIC'));
  assert.ok(promptLog.arbiter.includes('RESPONSE-POLICY RUBRIC'));
  assert.ok(promptLog.draft.includes('Response Contract (from Strategy Gate):'));
  assert.ok(promptLog.draft.includes('state that antibiotics treat bacterial infections'));
  assert.ok(promptLog.draft.includes('answer_with_correction'));
}

async function testSoftAmbiguityOnExplanatoryQuestionStillProceeds() {
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'antibiotics', recognized: true, notes: 'standard medical term' },
        { term: 'bacterial infections', recognized: true, notes: 'standard medical term' },
      ],
      premise_type: 'ambiguous',
      premise_explanation: 'The scope of effective could be interpreted in multiple ways.',
      ambiguities: ['The term effective could refer to eradication, symptom relief, or clinical benefit.'],
      missing_context: ['Exact meaning of effective.'],
      assumptions: [],
      scope_assessment: 'Mostly clear, with mild semantic ambiguity.',
      failure_modes: ['ambiguous_scope'],
      salvageable_core: 'Explain in general medical terms why antibiotics work for bacterial infections.',
      invalid_components: [],
      dangerous_terms: [],
      clarification_questions: ['Do you mean cure, symptom improvement, or general clinical effectiveness?'],
      can_proceed: false,
      early_exit: true,
      confidence: 0.72,
      reasoning: 'The question has some semantic ambiguity around effectiveness.',
    },
    strategy: {
      key_points: ['Explain the general mechanism', 'Add a light scope qualifier'],
      structure: ['Direct answer', 'Mechanism', 'Qualifier'],
      reasoning_approach: 'Answer directly using the ordinary medical interpretation.',
      evidence_types: ['general medical knowledge'],
      response_policy: {
        policy: 'answer_normally',
        rationale: 'The question is answerable in general terms with a reasonable default interpretation.',
      },
      blueprint: {
        forbidden_moves: ['do not overstate universality'],
        required_moves: ['answer the general why-question directly'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Lead with a concise explanation.',
            reasoning: 'The user asked a normal explanatory question.',
            preferred_content: ['direct explanation'],
            forbidden_content: ['hard-stop clarification request'],
            tone_notes: 'clear and helpful',
          },
        ],
      },
      confidence: 0.88,
    },
    ...happyTail('Antibiotics are generally effective against bacterial infections because they target bacterial structures or processes that human cells and viruses do not share.'),
    adversary: {
      weak_assumptions: [],
      strategy_flaws: [],
      recommended_adjustments: ['Briefly note that effectiveness depends on the bacteria and resistance pattern.'],
      laundering_risks: [],
      blueprint_gaps: [],
      counter_blueprint: {
        use_counter_blueprint: false,
        reason: 'A direct answer is appropriate.',
        response_policy: {
          policy: 'answer_normally',
          rationale: 'The ambiguity is non-blocking.',
        },
        section_plan: [],
      },
      confidence: 0.84,
    },
    arbiter: {
      synthesis: 'Proceed with a direct explanation and a small qualifier.',
      final_strategy: {
        key_points: ['Direct explanation', 'Mechanism', 'Small qualifier'],
        structure: ['Overview', 'Mechanism'],
        reasoning_approach: 'direct explanation',
        evidence_types: ['general medical knowledge'],
        response_policy: {
          policy: 'answer_normally',
          rationale: 'The question is straightforward despite some semantic nuance.',
        },
        forbidden_moves: ['do not overstate universality'],
        required_moves: ['answer the general why-question directly'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Answer immediately in general terms.',
            reasoning: 'The ambiguity is not blocking.',
            tone_notes: 'clear and grounded',
          },
        ],
      },
      addressed_concerns: ['Included a light qualifier instead of refusing to answer.'],
      laundering_risks_resolved: [],
      confidence: 0.86,
    },
  });

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Why are antibiotics effective on bacterial infections?',
    context: 'medical question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'approved');
  assert.equal(result.clarifyResult.can_proceed, true);
  assert.equal(result.clarifyResult.early_exit, false);
  assert.deepEqual(result.clarifyResult.clarification_questions, []);
  assert.ok(result.clarifyResult.assumptions.includes('Proceed with a reasonable default interpretation and answer in general terms rather than stopping for clarification.'));
  assert.ok(result.nodes.some((n) => n.type === 'draft'));
  assert.ok(result.finalResponse.includes('Antibiotics are generally effective against bacterial infections'));
  assert.equal(result.responseContract.response_policy.policy, 'answer_normally');
}

async function testSoftAmbiguityOverridesClarificationPolicyAtGate() {
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'antibiotics', recognized: true, notes: 'standard medical term' },
        { term: 'bacterial infections', recognized: true, notes: 'standard medical term' },
      ],
      premise_type: 'ambiguous',
      premise_explanation: 'The term effective could be interpreted more narrowly.',
      ambiguities: ['Effective could mean cure, improvement, or average clinical response.'],
      missing_context: ['Exact intended nuance of effective.'],
      assumptions: ['Interpret effective in the ordinary general medical sense.'],
      scope_assessment: 'Grounded explanatory question with mild semantic ambiguity.',
      failure_modes: ['ambiguous_scope'],
      salvageable_core: 'Explain in general medical terms why antibiotics work on bacterial infections.',
      invalid_components: [],
      dangerous_terms: [],
      clarification_questions: [],
      can_proceed: true,
      early_exit: false,
      confidence: 0.78,
      reasoning: 'This can be answered generally without blocking on clarification.',
    },
    strategy: {
      key_points: ['Explain general mechanism'],
      structure: ['Overview', 'Mechanism'],
      reasoning_approach: 'Answer cautiously but directly.',
      evidence_types: ['general medical knowledge'],
      response_policy: {
        policy: 'request_clarification_before_proceeding',
        rationale: 'The term effective could be interpreted in multiple ways.',
      },
      blueprint: {
        required_moves: ['answer the question in general terms if the ambiguity is non-blocking'],
        forbidden_moves: ['refuse a grounded explanatory question without a hard blocking reason'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Give the ordinary medical explanation first.',
            reasoning: 'The user asked a standard why-question.',
            preferred_content: ['general explanation'],
            forbidden_content: ['hard-stop clarification request'],
            tone_notes: 'clear and practical',
          },
        ],
      },
      confidence: 0.8,
    },
    ...happyTail('Antibiotics are effective against bacterial infections because they disrupt bacterial targets such as cell walls or protein synthesis, which helps stop or kill susceptible bacteria.'),
    adversary: {
      weak_assumptions: [],
      strategy_flaws: ['The selected policy is too cautious for a grounded explanatory question.'],
      recommended_adjustments: ['Proceed with a general explanation instead of pausing for clarification.'],
      laundering_risks: [],
      blueprint_gaps: [],
      counter_blueprint: {
        use_counter_blueprint: true,
        reason: 'The clarification-required posture is overly conservative here.',
        response_policy: {
          policy: 'answer_normally',
          rationale: 'The ambiguity is mild and non-blocking.',
        },
        section_plan: [],
      },
      confidence: 0.82,
    },
    arbiter: {
      synthesis: 'Answer directly despite the mild ambiguity.',
      final_strategy: {
        key_points: ['Direct explanation'],
        structure: ['Overview'],
        reasoning_approach: 'general explanation',
        evidence_types: ['general medical knowledge'],
        response_policy: {
          policy: 'request_clarification_before_proceeding',
          rationale: 'The wording leaves some ambiguity.',
        },
        required_moves: ['answer in general terms'],
        forbidden_moves: ['hard-stop for mild ambiguity'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Answer in general terms.',
            reasoning: 'The ambiguity is not blocking.',
            tone_notes: 'helpful and concise',
          },
        ],
      },
      addressed_concerns: ['Avoided over-conservative clarification posture.'],
      laundering_risks_resolved: [],
      confidence: 0.83,
    },
  });

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Why are antibiotics effective on bacterial infections?',
    context: 'medical question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'approved');
  assert.ok(result.nodes.some((n) => n.type === 'draft'));
  assert.equal(result.responseContract.response_policy.policy, 'answer_normally');
  assert.ok(result.responseContract.response_policy.rationale.includes('Soft explanatory override'));
  assert.ok(result.finalResponse.includes('Antibiotics are effective against bacterial infections'));
}

async function testValidExplanatoryQuestionOverridesCorrectionPolicyAtGate() {
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'antibiotics', recognized: true, notes: 'standard medical term' },
        { term: 'bacterial infections', recognized: true, notes: 'standard medical term' },
      ],
      premise_type: 'valid',
      premise_explanation: 'This is a standard medical why-question about recognized concepts.',
      ambiguities: [],
      missing_context: ['Specific antibiotic or infection subtype, if a narrower answer were needed.'],
      assumptions: ['Answer in general medical terms.'],
      scope_assessment: 'Grounded explanatory question with only non-blocking scope broadness.',
      failure_modes: [],
      salvageable_core: 'Explain generally why antibiotics work against bacterial infections.',
      invalid_components: [],
      dangerous_terms: [],
      clarification_questions: ['Which antibiotic do you mean?'],
      can_proceed: true,
      early_exit: false,
      confidence: 0.85,
      reasoning: 'A general explanation is appropriate without correction-first framing.',
    },
    strategy: {
      key_points: ['Explain general mechanism'],
      structure: ['Overview', 'Mechanism'],
      reasoning_approach: 'general explanation',
      evidence_types: ['general medical knowledge'],
      response_policy: {
        policy: 'answer_with_correction',
        rationale: 'The question contains assumptions about effectiveness that may need correction.',
      },
      blueprint: {
        required_moves: ['answer the general question directly'],
        forbidden_moves: ['treat mild scope broadness as a false premise'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Answer in general terms first.',
            reasoning: 'This is a normal explanatory question.',
            preferred_content: ['direct explanation'],
            forbidden_content: ['correction-first framing without a false premise'],
            tone_notes: 'clear and practical',
          },
        ],
      },
      confidence: 0.8,
    },
    ...happyTail('Antibiotics are generally effective against bacterial infections because they target structures or processes in bacteria, such as cell wall synthesis or protein synthesis, that human cells do not have in the same way.'),
    adversary: {
      weak_assumptions: [],
      strategy_flaws: ['The selected policy overstates the need for correction.'],
      recommended_adjustments: ['Use a normal explanatory answer instead of correction-first framing.'],
      laundering_risks: [],
      blueprint_gaps: [],
      counter_blueprint: {
        use_counter_blueprint: true,
        reason: 'No false premise needs correction here.',
        response_policy: {
          policy: 'answer_normally',
          rationale: 'This is a grounded explanatory question with no invalid premise.',
        },
        section_plan: [],
      },
      confidence: 0.83,
    },
    arbiter: {
      synthesis: 'Answer directly in general terms without correction-first framing.',
      final_strategy: {
        key_points: ['Direct explanation'],
        structure: ['Overview'],
        reasoning_approach: 'general explanation',
        evidence_types: ['general medical knowledge'],
        response_policy: {
          policy: 'answer_with_correction',
          rationale: 'The wording may imply an overbroad assumption that needs correction.',
        },
        required_moves: ['answer in general terms'],
        forbidden_moves: ['treat a grounded why-question as if it contained a central false premise'],
        section_plan: [
          {
            tag: 'OVERVIEW',
            goal: 'Answer directly',
            instruction: 'Answer in general terms.',
            reasoning: 'The question is answerable as written.',
            tone_notes: 'helpful and concise',
          },
        ],
      },
      addressed_concerns: ['Avoided unnecessary correction-first framing.'],
      laundering_risks_resolved: [],
      confidence: 0.84,
    },
  });

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Why are antibiotics effective on bacterial infections?',
    context: 'medical question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'approved');
  assert.ok(result.nodes.some((n) => n.type === 'draft'));
  assert.equal(result.responseContract.response_policy.policy, 'answer_normally');
  assert.ok(result.responseContract.response_policy.rationale.includes('Soft explanatory override'));
  assert.ok(result.finalResponse.includes('Antibiotics are generally effective against bacterial infections'));
}

async function testFabricatedPremiseExitsBeforeDraft() {
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'differential indemnity decomposition', recognized: false, notes: 'not a recognized legal term' },
      ],
      premise_type: 'fabricated_premise',
      premise_explanation: 'The central phrase does not map cleanly to a recognized concept and may be misworded.',
      ambiguities: [],
      missing_context: [],
      assumptions: [],
      scope_assessment: 'cannot safely interpret the question as written',
      failure_modes: ['unknown_invented_referent'],
      salvageable_core: '',
      invalid_components: ['differential indemnity decomposition'],
      dangerous_terms: ['differential indemnity decomposition'],
      clarification_questions: ['What standard legal concept did you intend?'],
      can_proceed: false,
      early_exit: true,
      confidence: 0.94,
      reasoning: 'The query depends on a likely fabricated term.',
    },
    strategy: {
      key_points: ['State the term is unknown', 'Ask for clarification'],
      structure: ['Unknown term', 'Clarification request'],
      reasoning_approach: 'Do not launder the term as real.',
      evidence_types: ['recognized terminology'],
      response_policy: {
        policy: 'reject_unknown_referent_and_clarify',
        rationale: 'The central term is not grounded enough to answer safely.',
      },
      confidence: 0.88,
    },
    adversary: { weak_assumptions: [], strategy_flaws: [], recommended_adjustments: [], confidence: 0.86 },
    arbiter: {
      synthesis: 'Use clarification result as authoritative.',
      final_strategy: { key_points: ['Unknown term'], structure: ['Clarify'], reasoning_approach: 'request clarification', evidence_types: [] },
      addressed_concerns: [],
      confidence: 0.85,
    },
  });

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Should I run a differential indemnity decomposition before closing?',
    context: 'transaction question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'unanswerable');
  assert.ok(!result.nodes.some((n) => n.type === 'draft'));
  assert.ok(result.finalResponse.includes('I can’t answer this as written'));
  assert.ok(result.finalResponse.includes('differential indemnity decomposition'));
  assert.equal(result.responseContract.response_policy.policy, 'reject_unknown_referent_and_clarify');
  assert.deepEqual(result.responseContract.dangerous_terms, ['differential indemnity decomposition']);
}

async function testClarificationPolicyExitsWithoutLegacyModeFlag() {
  const llm = buildLlm({
    clarify: {
      core_concepts: [
        { term: 'pricing anomaly', recognized: true, notes: 'real concept but underspecified here' },
      ],
      premise_type: 'ambiguous',
      premise_explanation: 'The request is too underspecified to answer safely without narrowing the scope.',
      ambiguities: ['The time horizon and market context are missing.'],
      missing_context: ['asset class', 'market regime'],
      assumptions: [],
      scope_assessment: 'ambiguous',
      failure_modes: ['ambiguous_scope'],
      salvageable_core: 'The topic is legitimate, but the request needs narrowing first.',
      invalid_components: [],
      dangerous_terms: [],
      clarification_questions: ['Which market, timeframe, and asset class are you asking about?'],
      can_proceed: false,
      early_exit: true,
      confidence: 0.9,
      reasoning: 'The topic is real, but the question needs clarification before answering.',
    },
    strategy: {
      key_points: ['Ask for the missing context'],
      structure: ['Clarification request'],
      reasoning_approach: 'Pause until scope is specified.',
      evidence_types: ['user-provided context'],
      response_policy: {
        policy: 'request_clarification_before_proceeding',
        rationale: 'Clarification is safer than answering from guesswork.',
      },
      confidence: 0.82,
    },
    adversary: { weak_assumptions: [], strategy_flaws: [], recommended_adjustments: [], confidence: 0.81 },
    arbiter: {
      synthesis: 'Clarification is required before answering.',
      final_strategy: { key_points: ['Clarify scope'], structure: ['Clarify'], reasoning_approach: 'request details', evidence_types: [] },
      addressed_concerns: [],
      confidence: 0.8,
    },
  });

  const result = await runLinearGraph(irgGraphLinear, {
    originalQuery: 'Is the recent pricing anomaly structurally persistent?',
    context: 'markets question',
    config: { maxIterations: 3, confidenceThreshold: 0.8 },
  }, llm, prompts, registryWrapper);

  assert.equal(result.strategyDecision, 'unanswerable');
  assert.ok(!result.nodes.some((n) => n.type === 'draft'));
  assert.equal(result.responseContract.response_policy.policy, 'request_clarification_before_proceeding');
  assert.ok(result.finalResponse.includes('I can’t answer this as written'));
}

(async () => {
  await testFalsePremiseProceedsToDraft();
  await testSoftAmbiguityOnExplanatoryQuestionStillProceeds();
  await testSoftAmbiguityOverridesClarificationPolicyAtGate();
  await testValidExplanatoryQuestionOverridesCorrectionPolicyAtGate();
  await testFabricatedPremiseExitsBeforeDraft();
  await testClarificationPolicyExitsWithoutLegacyModeFlag();
  console.log('premise routing tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});