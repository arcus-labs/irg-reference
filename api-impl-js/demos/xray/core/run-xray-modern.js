/**
 * Run the X-Ray IRG on the MODERN shared stack.
 *
 * Executes the X-ray graph on api-impl-js's linear interpreter (the same one
 * the fintech IRGs use) instead of the bespoke xray-interpreter, and wraps the
 * run with the shared governance layer:
 *   - I/O seal   — every LLM call hash-chained (tamper-evident)
 *   - provenance — model + code/prompt/graph/substrate SHAs + determinism
 *
 * The X-ray reasoning nodes are unchanged: their prepare/llmCall/process
 * contract already matches the linear interpreter, and the gate/converge nodes
 * already set `state._nodeDecision`.
 *
 * Usage:
 *   const { runXrayModern } = require('./run-xray-modern');
 *   const { state, provenance } = await runXrayModern(initialState, llmClient, { modelId });
 */

'use strict';

const fs = require('fs');
const path = require('path');

const yaml = require('js-yaml');

const { xrayGraphLinear } = require('./xray-graph-linear');
const xrayNodeRegistry = require('./xray-node-registry');

// This engine now lives inside api-impl-js (demos/xray/core), so the shared
// interpreter + governance modules resolve via in-package relative paths.
// __dirname = api-impl-js/demos/xray/core
const { runLinearGraph } = require('../../../core/execution/irg-interpreter-linear');
const { withIoSeal, finalizeSeal } = require('../../_adjudication-kit/io-seal');
const { buildProvenance } = require('../../_adjudication-kit/provenance');

const PROMPTS_PATH = path.join(__dirname, 'xray-prompts.yaml');
const GRAPH_PATH = path.join(__dirname, 'xray-graph-linear.js');
const KNOWLEDGE_PATH = path.resolve(__dirname, '..', 'knowledge', 'xray-claims.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function loadPrompts() {
  return yaml.load(fs.readFileSync(PROMPTS_PATH, 'utf8'));
}

// The linear interpreter looks up an 'exit' node by id; the X-ray registry has
// none. Return null for unknown ids (incl. 'exit') so the interpreter's
// null-tolerant exit handling ends the run cleanly.
function makeRegistryWrapper() {
  return {
    get(id) {
      try { return xrayNodeRegistry.getNode(id); }
      catch { return null; }
    },
  };
}

async function runXrayModern(initialState, llmClient, opts = {}) {
  const prompts = loadPrompts();
  const { client: sealedClient, seal } = withIoSeal(llmClient);

  const startTime = Date.now();
  const seededState = {
    iteration: 0,
    currentPhase: 'init',
    nodes: [],
    history: [],
    hypotheses: [],
    metrics: { startTime, phaseTimings: {} },
    config: { maxIterations: 3, confidenceThreshold: 0.75 },
    ...initialState,
  };

  const state = await runLinearGraph(
    xrayGraphLinear,
    seededState,
    sealedClient,
    prompts,
    makeRegistryWrapper(),
  );

  state.metrics = state.metrics || { startTime, phaseTimings: {} };
  state.metrics.endTime = Date.now();
  state.metrics.totalMs = state.metrics.endTime - startTime;

  const provenance = buildProvenance({
    runId: opts.runId || `xray-${Date.now()}`,
    provider: opts.provider || (opts.modelId ? opts.modelId.split('/')[0] : 'unknown'),
    model: opts.modelId || 'unknown',
    determinism: opts.determinism || { temperature: 0, seed: null },
    runnerPath: __filename,
    promptsPath: PROMPTS_PATH,
    promptPackPath: GRAPH_PATH, // no overlay pack; the graph file stands in
    graphPath: GRAPH_PATH,
    extraNodePaths: [
      path.join(__dirname, 'nodes', 'image-observation-node.js'),
      path.join(__dirname, 'nodes', 'adversary-node.js'),
      path.join(__dirname, 'nodes', 'convergence-check-node.js'),
      path.join(__dirname, 'nodes', 'triage-node.js'),
    ],
    knowledgePath: KNOWLEDGE_PATH,
    repoRoot: REPO_ROOT,
  });
  provenance.io_seal = finalizeSeal(seal);

  return { state, provenance };
}

module.exports = { runXrayModern };
