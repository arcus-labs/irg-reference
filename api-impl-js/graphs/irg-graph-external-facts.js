/**
 * IRG Graph — External Facts variant
 *
 * The full reasoning pipeline, including the external fact-check pipeline:
 *   factCheck → externalFactCheck → (optional) citation generation + write → impact
 *
 * Compared with `irg-graph-linear-simple.js`, this variant persists
 * claims to the filesystem fact-store, looks up cached citations, and
 * optionally generates and writes provisional citation artifacts.
 *
 * Selected at request time via `"graph": "irg-external-facts"`.
 */

'use strict';

/**
 * The main workflow:
 *  1.  Clarify              — Identify ambiguities and missing context
 *  2.  Strategy             — Elaborate on response strategy and approach
 *  3.  Adversary            — Challenge assumptions and identify flaws
 *  4.  Arbiter              — Synthesize strategy and adversary
 *  5.  Strategy Gate        — Early-exit for unanswerable premises
 *  6.  Fact Check           — Extract critical claims; persist artifact
 *  7.  External Fact Check  — Rehydrate persisted claims; check citation cache
 *  8.  Pipeline Gate        — Decide whether to generate sources for unresolved claims
 *  9.  Citation Source Gen  — Generate candidate sources (LLM)
 * 10.  Citation Write       — Persist provisional citation artifacts
 * 11.  Citation Fetch       — HTTP-fetch candidate URLs; extract HTML+markdown
 * 12.  Citation Verify      — LLM-check whether each source supports the claim
 * 13.  Impact               — Predict downstream effects and risks
 * 14.  Draft                — Compose response using arbiter + facts + impact
 * 15.  Meta-Evaluation      — Score draft quality
 * 16.  Assessor             — Governance audit (EIE dimensions)
 * 17.  Convergence          — Accept / iterate / fail
 * 18.  Exit                 — Terminal
 */
const irgGraphExternalFacts = [
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
  'externalFactCheck',
  {
    gate: 'factCheckPipelineGate',
    on: {
      run: 'citationSourceGeneration',
      skip: 'impact',
    },
  },
  'citationSourceGeneration',
  'citationWrite',
  'citationFetch',
  'citationVerify',

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
  irgGraphExternalFacts,
};
