/**
 * IRG Graph — Reg E Adjudication
 *
 * Composition (per the Cognitive Engineering thesis §10.3):
 *
 *   Outer:                 IRAC (Issue → Rule → Application → Conclusion)
 *   Inside Application:    Differential Diagnosis + Steelman + Red Team
 *   Output:                Toulmin Argumentation (Claim · Grounds · Warrant · Rebuttal · Qualifier)
 *
 * The graph TOPOLOGY is `irg-graph-linear-simple` with `memoryRecall` replaced
 * by `caseRecall` (the adjudication-specific recall step that merges per-case
 * evidence with the precomputed Reg E rule citation corpus into a unified
 * citable set). The strategy composition is implemented in the prompt PACK
 * the runner overlays at deploy time — same graph engine, different cognitive
 * behavior, exactly as the thesis's three-layer model prescribes.
 *
 * Phase mapping:
 *   - clarify          → CLR  · Clarification (problem semantics)
 *   - classifyCase     · classify the dispute under §1005.11(a)(i)–(vii) or out-of-scope (locks category for all downstream nodes)
 *   - strategy         → STR  · Response Strategy (IRAC issue + rule retrieval plan; differential setup)
 *   - adversary        → ADV  · Adversary (Steelman the consumer + Red Team the leading hypothesis)
 *   - arbiter          → ARB  · Arbiter (resolve adversary; produce the IRAC Application + Conclusion)
 *   - strategyGate     · gate (early exit on unanswerable / out-of-scope)
 *   - factCheck        → VRF  · Fact Check (validate facts the analysis depends on)
 *   - caseRecall       · recall (evidence + applicable Reg E rule citations → citable set)
 *   - impact           · Impact (consequences of accept vs deny; consumer recourse)
 *   - draft            → GEN  · Generate (Toulmin-shaped decision rationale, cites [E*] + [R*])
 *   - citationApply    · resolves cit_N → durable uuid + references
 *   - citationQuality  · ALCE recall / precision on the cited rationale
 *   - metaEvaluation   → EVL  · Evaluation (does the conclusion follow IRAC? notice elements present?)
 *   - assessor         → ASR  · Assessor (EIE governance — posture, abstention, traceability)
 *   - convergence      · iterate or finalize
 *   - exit             · terminal
 *
 * Selected via `"graph": "irg-reg-e-adjudication"`.
 */

'use strict';

const irgGraphRegEAdjudication = [
  'clarify',
  'classifyCase',
  'strategy',
  'adversary',
  'arbiter',

  {
    gate: 'strategyGate',
    on: {
      approved: 'proceed',
      unanswerable: 'exit',
    },
  },

  'factCheck',
  'caseRecall',

  'impact',
  'draft',
  'citationApply',
  'citationQuality',
  'metaEvaluation',
  'assessor',

  {
    converge: 'convergence',
    on: {
      iterate: 'goto:strategy',
      accept: 'exit',
      accept_with_caveats: 'exit',
      fail: 'exit',
    },
  },

  'exit',
];

module.exports = {
  irgGraphRegEAdjudication,
};
