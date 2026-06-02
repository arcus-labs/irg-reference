/**
 * Standalone Fact-Check Pipeline Graph
 *
 * The fact-check pipeline by itself — without the reasoning loop
 * (clarify / strategy / adversary / arbiter / draft / etc.).
 *
 * Used by `POST /webhook/fact-check-process` to check a list of
 * claims against the local fact-store, optionally generate candidate
 * sources, fetch them, and verify them — all without invoking the
 * full IRG. Useful for batch fact-checking, demos that focus on the
 * citation pipeline, and seeding the fact-store with verified
 * citations for claims that didn't come from an IRG run.
 *
 * Flow:
 *   externalFactCheck → [pipeline gate] →
 *     citationSourceGeneration → citationWrite →
 *     citationFetch → citationVerify → exit
 */

'use strict';

const factCheckPipelineGraph = [
  'externalFactCheck',
  {
    gate: 'factCheckPipelineGate',
    on: {
      run: 'citationSourceGeneration',
      skip: 'exit',
    },
  },
  'citationSourceGeneration',
  'citationWrite',
  'citationFetch',
  'citationVerify',
  'exit',
];

module.exports = {
  factCheckPipelineGraph,
  // Legacy alias for backward compatibility with any external code
  // that still imports the old name. Safe to remove once we're sure
  // no consumer relies on it.
  factCheckPipelineGraphLinear: factCheckPipelineGraph,
};
