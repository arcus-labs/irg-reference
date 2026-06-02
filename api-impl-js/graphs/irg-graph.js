/**
 * IRG Graph — Compatibility Wrapper Around The Linear Graph
 *
 * The deprecated tree graph has been removed. This module keeps the historic
 * `runGraph` entrypoint working by routing it through the active linear graph
 * interpreter and node registry.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseYamlOnly } = require('../core/parsing/yaml-format-utils');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphExternalFacts } = require('./irg-graph-external-facts');
const nodeRegistry = require('../core/execution/irg-node-registry');

// ---------------------------------------------------------------------------
// Legacy exports (for backward compatibility)
// ---------------------------------------------------------------------------

const irgGraph = irgGraphExternalFacts;

function loadPrompts(promptsPath) {
  const resolved = promptsPath || path.join(__dirname, '../core/prompts/irg-prompts.yaml');
  const raw = fs.readFileSync(resolved, 'utf8');
  return parseYamlOnly(raw);
}

const interpreter = {
  runGraph,
  runLinearGraph,
  loadPrompts,
};

/**
 * Execute the IRG graph through the active linear runtime.
 *
 * @param {Object}   initialState  - IRG state object
 * @param {Object}   llmClient     - LLM client
 * @param {Object}   [prompts]     - Parsed prompts
 * @returns {Promise<Object>}      - Final state
 */
async function runGraph(initialState, llmClient, prompts) {
  const resolvedPrompts = prompts || loadPrompts();
  const registryWrapper = {
    get: (nodeId) => nodeRegistry.getNode(nodeId),
  };

  return runLinearGraph(irgGraphExternalFacts, initialState, llmClient, resolvedPrompts, registryWrapper);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  irgGraph,
  loadPrompts,
  runGraph,
  irgGraphExternalFacts,
  // Legacy alias for backward compatibility with older callers.
  irgGraphLinear: irgGraphExternalFacts,
  interpreter,
};

