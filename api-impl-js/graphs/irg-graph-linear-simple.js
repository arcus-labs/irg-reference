/**
 * IRG Graph Definition — Simplified Linear Format
 *
 * A streamlined variant of the full IRG graph that uses the internal
 * fact-check node only — no external fact-check pipeline (no cache
 * lookup, no citation source generation, no citation write).
 *
 * Use this graph for demos and environments where the external
 * fact-check pipeline adds complexity without adding value.
 *
 * The main workflow:
 *  1.  Clarify       — Identify ambiguities and missing context
 *  2.  Strategy      — Elaborate on response strategy and approach
 *  3.  Adversary     — Challenge assumptions and identify flaws
 *  4.  Arbiter       — Synthesize strategy and adversary into unified approach
 *  5.  Fact Check    — Extract and assess critical claims (internal only)
 *  6.  Memory Recall — Look up prior verified evidence for these claims
 *  7.  Impact        — Predict downstream effects and risks
 *  8.  Draft         — Generate response using arbiter strategy + fact checks + impact
 *  9.  Meta-Eval     — Evaluate draft quality and recommend next steps
 * 10.  Assessor      — Governance integrity check (EIE dimensions)
 * 11.  Convergence   — Decide: accept / iterate / fail
 * 12.  Exit          — Terminal node
 */

'use strict';

const irgGraphLinearSimple = [
  'clarify',
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
  'memoryRecall',

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
  irgGraphLinearSimple,
};
