/**
 * IRG Interpreter — Legacy Tree Graph Executor
 *
 * Deprecated: the active runtime uses `irg-interpreter-linear.js` and the
 * linear graph definition. This executor remains only as a legacy utility.
 *
 * Executes a tree-based graph definition by:
 * 1. Starting at the specified start node
 * 2. Executing each node's prepare → llmCall → process pipeline
 * 3. Determining next node(s) based on node output
 * 4. Supporting branching, iteration, and early exit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseYamlOnly } = require('../parsing/yaml-format-utils');
const nodeRegistry = require('./irg-node-registry');

// ---------------------------------------------------------------------------
// Prompt Loader
// ---------------------------------------------------------------------------

function loadPrompts(promptsPath) {
  const resolved = promptsPath || path.join(__dirname, '../prompts/irg-prompts.yaml');
  const raw = fs.readFileSync(resolved, 'utf8');
  return parseYamlOnly(raw);
}

// ---------------------------------------------------------------------------
// Graph Interpreter
// ---------------------------------------------------------------------------

/**
 * Determine the next node ID based on node output and graph definition
 * @param {Object} graphDef - The graph definition
 * @param {string} currentNodeId - Current node ID
 * @param {Object} state - Current state
 * @returns {string|null} Next node ID, or null if no next node
 */
function getNextNodeId(graphDef, currentNodeId, state) {
  const nodeDef = graphDef.nodes[currentNodeId];
  if (!nodeDef || !nodeDef.next) return null;

  const { next } = nodeDef;

  // If next is an array, return the first (and only) element
  if (Array.isArray(next)) {
    return next.length > 0 ? next[0] : null;
  }

  // If next is an object, use state to determine which branch
  if (typeof next === 'object') {
    // Check for decision-based routing
    const decision = state.convergenceDecision || state.strategyDecision;
    if (decision && next[decision]) {
      return next[decision];
    }
    // Fallback to default
    return next.default || null;
  }

  return null;
}

/**
 * Execute the IRG graph against an initial state
 * @param {Object} graphDef - Graph definition with startNode and nodes
 * @param {Object} initialState - Initial state object
 * @param {Object} llmClient - LLM client with async call(prompt, opts) method
 * @param {Object} [prompts] - Parsed prompts; loaded from YAML if omitted
 * @returns {Promise<Object>} Final state after graph execution
 */
async function runGraph(graphDef, initialState, llmClient, prompts) {
  const resolvedPrompts = prompts || loadPrompts();
  const visitedNodes = new Set();
  const maxIterations = initialState.config?.maxIterations ?? 5;

  // Initialize state
  let state = {
    __irg: { kind: 'state', v: 1 },
    iteration: 0,
    currentPhase: 'init',
    nodes: [],
    history: [],
    metrics: { startTime: Date.now(), phaseTimings: {} },
    ...initialState,
  };

  let currentNodeId = graphDef.startNode;
  let iterationCount = 0;

  while (currentNodeId && iterationCount < maxIterations * 2) {
    // Prevent infinite loops
    const nodeKey = `${currentNodeId}_iter${state.iteration || 0}`;
    if (visitedNodes.has(nodeKey)) {
      console.warn(`[irg-interpreter] Cycle detected at node "${currentNodeId}"`);
      break;
    }
    visitedNodes.add(nodeKey);

    // Get node from registry
    let node;
    try {
      node = nodeRegistry.getNode(currentNodeId);
    } catch (err) {
      console.error(`[irg-interpreter] ${err.message}`);
      break;
    }

    // Execute node pipeline: prepare → llmCall → process
    state = node.prepare(state, resolvedPrompts);

    let llmResult = null;
    if (node.llmCall) {
      try {
        llmResult = await node.llmCall(state, llmClient);
      } catch (err) {
        console.error(`[irg-interpreter] LLM call failed for node "${currentNodeId}":`, err.message);
        llmResult = '';
      }
    }

    // Pass the full llmResult to the node's process function
    // The node will handle extracting content and tokens
    state = node.process(state, llmResult);

    // Determine next node
    currentNodeId = getNextNodeId(graphDef, currentNodeId, state);
    iterationCount++;
  }

  state.metrics.endTime = Date.now();
  state.metrics.totalMs = state.metrics.endTime - state.metrics.startTime;

  return state;
}

module.exports = {
  runGraph,
  loadPrompts,
  getNextNodeId,
};

