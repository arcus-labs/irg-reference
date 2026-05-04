/**
 * IRG Graph Definition — Linear Format with Parallel Support
 *
 * A more declarative, readable graph format that supports:
 *   - Linear sequences (simple strings)
 *   - Branching (gate nodes with conditional routing)
 *   - Parallel execution (multiple nodes running concurrently)
 *   - Looping (goto: syntax for jumping to earlier nodes)
 *   - Explicit exit points
 */

'use strict';

/**
 * IRG Graph Definition — Linear Format
 *
 * The main workflow:
 * 1. Clarify - Identify ambiguities and missing context
 * 2. Strategy - Elaborate on response strategy and approach
 * 3. Adversary - Challenge assumptions and identify flaws
 * 4. Arbiter - Synthesize strategy and adversary into unified approach
 * 5. Fact Check - Extract claims from the arbiter's unified strategy
 * 6. External Fact Check - Rehydrate persisted claims and check local citation cache
 * 7. Fact-Check Pipeline Gate - Optionally generate source candidates + citations
 * 8. Impact - Predict downstream effects and risks
 * 9. Draft - Generate response using arbiter strategy + fact checks + impact
 * 10. Meta-Evaluation - Evaluate draft quality and recommend next steps
 * 11. Convergence - Decide: accept/iterate/fail
 * 12. Exit - Terminal node (implicit record)
 */
const irgGraphLinear = [
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

  'impact',
  'draft',
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
  irgGraphLinear,
};
