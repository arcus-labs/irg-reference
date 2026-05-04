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
const { irgGraphLinear } = require('../graphs/irg-graph-linear');
const { irgGraphLinearSimple } = require('../graphs/irg-graph-linear-simple');
const { factCheckPipelineGraphLinear } = require('../graphs/fact-check-pipeline-graph-linear');

// Available reasoning graphs — selected by `graph` request parameter
const availableGraphs = {
  'irg-simple': irgGraphLinearSimple,
  'irg-full': irgGraphLinear,
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
 * Main IRG Processing Endpoint
 *
 * POST /webhook/irg-process
 */
app.post('/webhook/irg-process', async (req, res) => {
  try {
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
      enableFactCheckPipeline: req.body?.enableFactCheckPipeline === true,
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

    // Select the reasoning graph
    const graphName = req.body?.graph || 'irg-simple';
    const selectedGraph = availableGraphs[graphName] || availableGraphs['irg-simple'];

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
      factCheckPipelineGraphLinear,
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

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     IRG API Server                                     ║`);
  console.log(`╠════════════════════════════════════════════════════════╣`);
  console.log(`║ Listening on: http://localhost:${PORT}`);
  console.log(`║ Endpoint: POST /webhook/irg-process`);
  console.log(`║ Endpoint: POST /webhook/fact-check-process`);
  console.log(`║ Endpoint: GET  /providers`);
  console.log(`║ Health:   GET  /health`);
  console.log(`║ LLM providers: ${providerSummary}`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);
});

