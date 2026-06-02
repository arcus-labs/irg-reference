/**
 * X-Ray IRG Graph — Linear (modern-stack) format.
 *
 * Same flow as xray-graph-definition.js (the original tree), re-expressed in
 * the api-impl-js linear-array format so the X-ray IRG runs on the SHARED
 * interpreter (core/execution/irg-interpreter-linear.js) used by the fintech
 * graphs — gaining provenance, the I/O seal, and a uniform trace shape.
 *
 * Control flow:
 *   clinicalContext → imageObservation
 *   ⟦imageQualityGate⟧  proceed → hypothesis · insufficient_data → goto termination
 *   hypothesis → differentialExpansion → adversary → targetedReanalysis → evidenceLink
 *   ⟦convergenceCheck⟧  iterate → goto differentialExpansion
 *                       converged | bounded_uncertainty | insufficient_data → goto triage
 *   triage → termination → record → exit
 *
 * The gate/converge nodes already set `state._nodeDecision` and the
 * convergence node manages `state.iteration`, exactly as the linear
 * interpreter expects — so no node changes are required.
 */

'use strict';

const xrayGraphLinear = [
  'clinicalContext',
  'imageObservation',

  {
    gate: 'imageQualityGate',
    on: {
      proceed: 'proceed',
      insufficient_data: 'goto:termination',
    },
  },

  'hypothesis',
  'differentialExpansion',
  'adversary',
  'targetedReanalysis',
  'evidenceLink',

  {
    converge: 'convergenceCheck',
    on: {
      iterate: 'goto:differentialExpansion',
      converged: 'goto:triage',
      bounded_uncertainty: 'goto:triage',
      insufficient_data: 'goto:triage',
    },
  },

  'triage',
  'termination',
  'record',
  'exit',
];

module.exports = { xrayGraphLinear };
