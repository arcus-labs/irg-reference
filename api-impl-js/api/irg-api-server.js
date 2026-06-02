#!/usr/bin/env node

'use strict';

const path = require('path');
// Load .env from repository root (two levels up from api-impl-js/api)
const envPath = path.resolve(__dirname, '../../.env');
console.log(`Loading .env from: ${envPath}`);
require('dotenv').config({ path: envPath });

const express = require('express');
const fs = require('fs');
const yaml = require('js-yaml');
const { createLLMClient, describeEnabledProviders } = require('../core/llm');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphExternalFacts } = require('../graphs/irg-graph-external-facts');
const { irgGraphLinearSimple } = require('../graphs/irg-graph-linear-simple');
const { factCheckPipelineGraph } = require('../graphs/fact-check-pipeline-graph');
const { startScheduledSweep, DEFAULT_INTERVAL_MS, sweepExpired } = require('../core/external-fact-check/sweeper');
const factStoreDb = require('../core/external-fact-check/db');

// Available reasoning graphs — selected by `graph` request parameter
const availableGraphs = {
  'irg-simple': irgGraphLinearSimple,
  'irg-external-facts': irgGraphExternalFacts,
};
const nodeRegistry = require('../core/execution/irg-node-registry');
const { formatTrace } = require('../core/tracing/trace-formatter');
const {
  servicePorts,
  irgApiRequestDefaults,
  factCheckPipelineRequestDefaults,
} = require('../../shared/runtime-defaults.json');

// Load prompts once at startup
const promptsPath = path.join(__dirname, '../core/prompts/irg-prompts.yaml');
const promptsYaml = fs.readFileSync(promptsPath, 'utf8');
const prompts = yaml.load(promptsYaml);
console.log(`[Startup] Loaded prompts from ${promptsPath}`);
console.log(`[Startup] Available prompts: ${Object.keys(prompts).join(', ')}`);
if (!prompts.assessor) {
  console.warn('[Startup] ⚠️  WARNING: assessor prompt not found in prompts!');
}

const app = express();
const PORT = Number(process.env.IRG_API_PORT || servicePorts.irgApi);

// Middleware
app.use(express.json());

function buildRegistryWrapper() {
  return {
    get: (nodeId) => nodeRegistry.getNode(nodeId),
  };
}

function normalizeIncomingClaim(claim) {
  if (typeof claim === 'string') {
    return {
      claim,
      importance: '',
      assessment: 'uncertain',
      reasoning: '',
      source: null,
    };
  }

  return {
    claim: claim?.claim || '',
    importance: claim?.importance || '',
    assessment: claim?.assessment || 'uncertain',
    reasoning: claim?.reasoning || '',
    source: claim?.source ?? null,
  };
}

function buildInitialState({ query, context, maxIterations, confidenceThreshold, enableAssessor, enableFactCheckPipeline, maxTokens, factCheckResult }) {
  return {
    originalQuery: query,
    context,
    ...(factCheckResult ? { factCheckResult } : {}),
    config: {
      maxIterations,
      confidenceThreshold,
      enableAssessor,
      enableFactCheckPipeline,
      maxTokens,
    },
  };
}

function normalizeFactCheckInput(body) {
  if (body?.factCheckResult?.artifact_path && typeof body.factCheckResult.artifact_path === 'string') {
    return body.factCheckResult;
  }

  const rawClaims = Array.isArray(body?.factCheckResult?.critical_claims)
    ? body.factCheckResult.critical_claims
    : Array.isArray(body?.claims)
      ? body.claims
      : [];

  const criticalClaims = rawClaims
    .map(normalizeIncomingClaim)
    .filter((claim) => typeof claim.claim === 'string' && claim.claim.trim());

  return criticalClaims.length > 0
    ? { critical_claims: criticalClaims }
    : null;
}

function formatFactCheckPipelineResponse(result, requestParams) {
  const resolvedRequestParams = {
    ...factCheckPipelineRequestDefaults,
    ...requestParams,
  };

  return {
    session_id: `fact-check-${Date.now()}`,
    timestamp: new Date().toISOString(),
    query: resolvedRequestParams.query,
    context: resolvedRequestParams.context,
    config: {
      maxIterations: resolvedRequestParams.maxIterations || factCheckPipelineRequestDefaults.maxIterations,
      confidenceThreshold: resolvedRequestParams.confidenceThreshold || factCheckPipelineRequestDefaults.confidenceThreshold,
      model: resolvedRequestParams.model || factCheckPipelineRequestDefaults.model,
      enableFactCheckPipeline: resolvedRequestParams.enableFactCheckPipeline !== false,
    },
    final_decision: result._nodeDecision || 'complete',
    nodes_executed: result.nodes?.length || 0,
    trace: result.nodes || [],
    externalFactCheckResult: result.externalFactCheckResult || {},
    citationSourceGenerationResult: result.citationSourceGenerationResult || {},
    factCheckPipelineResult: result.factCheckPipelineResult || {},
  };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'irg-api' });
});

/**
 * Providers endpoint
 *
 * Returns the list of LLM providers enabled on this server, in display
 * order, along with each provider's curated model list and default model.
 * The trace-navigator uses this to populate its provider/model selectors.
 */
app.get('/providers', (req, res) => {
  res.json({ providers: describeEnabledProviders() });
});

/**
 * Fact-store stats endpoint.
 *
 * Returns aggregate counts and per-domain breakdowns for the claim and
 * citation stores. Returns `{ stats: null }` if the store has never been
 * written to (no JSON files yet). Throws 500 (with a FactStoreError
 * message) if DuckDB itself fails — the trace-navigator uses this to
 * surface a clean error state in its Memory tab.
 */
app.get('/fact-store/stats', async (req, res) => {
  try {
    const stats = await factStoreDb.getStats();
    res.json({ stats });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ /fact-store/stats:`, err.message);
    res.status(500).json({
      error: 'fact_store_stats_failed',
      message: err.message,
    });
  }
});

/**
 * Fact-store sweep endpoint.
 *
 * Triggers an on-demand sweep of expired citation artifacts. Accepts
 * `?dry_run=1` to report what would be removed without touching disk.
 *
 * NOTE: no authentication on this endpoint — same trust model as the
 * rest of the API server. Operators exposing this publicly must put
 * authn + rate limits in front. See SECURITY.md.
 */
app.post('/fact-store/sweep', async (req, res) => {
  try {
    const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true';
    const result = await sweepExpired({ dryRun });
    res.json({ result });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ /fact-store/sweep:`, err.message);
    res.status(500).json({
      error: 'fact_store_sweep_failed',
      message: err.message,
    });
  }
});

/**
 * Main IRG Processing Endpoint
 *
 * POST /webhook/irg-process
 */
app.post('/webhook/irg-process', async (req, res) => {
  try {
    // Select the reasoning graph FIRST so we can derive the pipeline
    // flag from it. The flag and the graph used to be independently
    // controllable — but in practice the only valid combinations are
    // (irg-simple, pipeline=false) and (irg-external-facts, pipeline=true).
    // Any other combo gave misleading trace output (e.g. claim
    // artifacts marked as "pipeline" when no pipeline ran). The graph
    // is now the source of truth.
    const graphName = availableGraphs[req.body?.graph] ? req.body.graph : 'irg-simple';
    const selectedGraph = availableGraphs[graphName];
    const isPipelineGraph = graphName === 'irg-external-facts';

    const requestParams = {
      query: req.body?.query || '',
      context: req.body?.context || irgApiRequestDefaults.context,
      maxIterations: req.body?.maxIterations || irgApiRequestDefaults.maxIterations,
      confidenceThreshold: req.body?.confidenceThreshold || irgApiRequestDefaults.confidenceThreshold,
      model: req.body?.model || irgApiRequestDefaults.model,
      maxTokens: req.body?.maxTokens || irgApiRequestDefaults.maxTokens,
      enableFactCheck: req.body?.enableFactCheck !== false,
      enableImpactPrediction: req.body?.enableImpactPrediction !== false,
      enableAssessor: req.body?.enableAssessor !== false,
      // Tied to graph choice — see comment above. The request body's
      // enableFactCheckPipeline is ignored. Callers control behavior
      // via `graph` only.
      enableFactCheckPipeline: isPipelineGraph,
    };

    const {
      query,
      context,
      maxIterations,
      confidenceThreshold,
      model,
      maxTokens,
      enableFactCheck,
      enableImpactPrediction,
      enableAssessor,
      enableFactCheckPipeline,
    } = requestParams;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    // Initialize the LLM client. Selection precedence: explicit `provider`
    // → model-prefix inference → default provider. Throws if no provider
    // is enabled or the requested provider isn't configured.
    let llmClient;
    try {
      llmClient = createLLMClient({ provider: req.body?.provider, model });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const initialState = buildInitialState({
      query,
      context,
      maxIterations,
      confidenceThreshold,
      enableAssessor,
      enableFactCheckPipeline,
      maxTokens,
    });

    const registryWrapper = buildRegistryWrapper();

    // Execute the graph
    const queryPreview = typeof query === 'string' ? query.substring(0, 50) : String(query).substring(0, 50);
    console.log(`[${new Date().toISOString()}] Executing IRG (${graphName}) for query: ${queryPreview}...`);
    const result = await runLinearGraph(selectedGraph, initialState, llmClient, prompts, registryWrapper);

    // Format the trace
    const trace = formatTrace(result, requestParams);

    console.log(`[${new Date().toISOString()}] ✅ IRG execution completed`);

    // Return the trace
    res.json(trace);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error:`, error.message);
    res.status(500).json({
      error: 'IRG execution failed',
      message: error.message,
    });
  }
});

app.post('/webhook/fact-check-process', async (req, res) => {
  try {
    const requestParams = {
      query: req.body?.query || factCheckPipelineRequestDefaults.query,
      context: req.body?.context || factCheckPipelineRequestDefaults.context,
      maxIterations: req.body?.maxIterations || factCheckPipelineRequestDefaults.maxIterations,
      confidenceThreshold: req.body?.confidenceThreshold || factCheckPipelineRequestDefaults.confidenceThreshold,
      model: req.body?.model || factCheckPipelineRequestDefaults.model,
      maxTokens: req.body?.maxTokens || factCheckPipelineRequestDefaults.maxTokens,
      enableFactCheckPipeline: req.body?.enableFactCheckPipeline !== false,
    };

    const {
      query,
      context,
      maxIterations,
      confidenceThreshold,
      model,
      maxTokens,
      enableFactCheckPipeline,
    } = requestParams;

    const factCheckResult = normalizeFactCheckInput(req.body);
    if (!factCheckResult) {
      return res.status(400).json({ error: 'claims or factCheckResult.critical_claims is required' });
    }

    let llmClient;
    try {
      llmClient = createLLMClient({ provider: req.body?.provider, model });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const initialState = buildInitialState({
      query,
      context,
      maxIterations,
      confidenceThreshold,
      enableAssessor: false,
      enableFactCheckPipeline,
      maxTokens,
      factCheckResult,
    });

    const registryWrapper = buildRegistryWrapper();
    const result = await runLinearGraph(
      factCheckPipelineGraph,
      initialState,
      llmClient,
      prompts,
      registryWrapper
    );

    res.json(formatFactCheckPipelineResponse(result, requestParams));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Fact-check pipeline error:`, error.message);
    res.status(500).json({
      error: 'Fact-check pipeline execution failed',
      message: error.message,
    });
  }
});

// Start server
app.listen(PORT, () => {
  const enabledProviders = describeEnabledProviders();
  const providerSummary = enabledProviders.length
    ? enabledProviders.map((p) => p.name).join(', ')
    : '(none — set at least one API_KEY_*)';

  // Schedule background sweeps of expired fact-store citations.
  // Override with FACT_STORE_SWEEP_INTERVAL_MS (set to 0 to disable
  // the periodic timer; a one-shot sweep still runs at startup).
  const sweepIntervalMs = Number.isFinite(Number(process.env.FACT_STORE_SWEEP_INTERVAL_MS))
    ? Number(process.env.FACT_STORE_SWEEP_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;
  startScheduledSweep({ intervalMs: sweepIntervalMs });

  const sweepLabel = sweepIntervalMs > 0
    ? `every ${Math.round(sweepIntervalMs / 1000 / 60)} min`
    : 'startup only';

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     IRG API Server                                     ║`);
  console.log(`╠════════════════════════════════════════════════════════╣`);
  console.log(`║ Listening on: http://localhost:${PORT}`);
  console.log(`║ Endpoint: POST /webhook/irg-process`);
  console.log(`║ Endpoint: POST /webhook/fact-check-process`);
  console.log(`║ Endpoint: GET  /providers`);
  console.log(`║ Endpoint: GET  /fact-store/stats`);
  console.log(`║ Endpoint: POST /fact-store/sweep [?dry_run=1]`);
  console.log(`║ Health:   GET  /health`);
  console.log(`║ LLM providers: ${providerSummary}`);
  console.log(`║ Fact-store sweep: ${sweepLabel}`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);
});

