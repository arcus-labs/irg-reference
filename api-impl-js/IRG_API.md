# IRG API Server

A standalone Express.js API server that executes the Iterative Reasoning Graph (IRG).

## Quick Start

### Start the Server

```bash
cd api-impl-js
npm run api
```

The server will start on `http://localhost:2100`

### Health Check

```bash
curl http://localhost:2100/health
```

Response:
```json
{"status":"ok","service":"irg-api"}
```

## API Endpoint

### POST /webhook/irg-process

Executes the IRG graph with the given query and returns a complete trace.

When `enableFactCheckPipeline` is enabled, the main IRG flow will:
- run the normal internal `factCheck` node
- run `externalFactCheck` against the filesystem-backed fact store
- if unresolved claims remain, run a source-generation + citation-writing pipeline before drafting

**Request:**
```bash
curl -X POST http://localhost:2100/webhook/irg-process \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the best practices for machine learning?",
    "context": {"team": "IRG", "project": "reference"},
    "maxIterations": 4,
    "confidenceThreshold": 0.8,
    "model": "llama-3.3-70b-versatile",
    "maxTokens": 10000,
    "enableFactCheck": true,
    "enableImpactPrediction": true,
    "enableAssessor": true,
    "enableFactCheckPipeline": true
  }'
```

**Request Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | The question or prompt to process |
| `context` | object | `{}` | Additional context for the query |
| `maxIterations` | number | 4 | Maximum number of iterations |
| `confidenceThreshold` | number | 0.8 | Confidence threshold for acceptance |
| `model` | string | `llama-3.3-70b-versatile` | Groq model to use |
| `maxTokens` | number | 10000 | Max tokens for LLM response |
| `enableFactCheck` | boolean | true | Enable fact-checking node |
| `enableImpactPrediction` | boolean | true | Enable impact prediction node |
| `enableAssessor` | boolean | true | Enable the assessor/audit node |
| `enableFactCheckPipeline` | boolean | false | If true, unresolved external-fact-check claims will go through source generation and provisional citation writing before draft generation |

**Response:**

Returns a complete trace object with:
- `session_id`: Unique session identifier
- `timestamp`: Execution timestamp
- `query`: The original query
- `config`: Configuration used
- `trace`: Array of node execution records
- `final_decision`: Final decision (accept/iterate/fail)
- `nodes_executed`: Number of nodes executed
- `draft_response`: The final YAML+Markdown response
- `__yaml`: Flag indicating YAML format

When fact-checking is active, the trace may also include state derived from:
- `factCheckResult`: internally extracted claims
- `externalFactCheckResult`: filesystem cache lookup results and claim-level verification status
- `factCheckPipelineResult`: provisional citation-writing summary when the optional pipeline runs

### Fact-check pipeline behavior in the main IRG flow

If `enableFactCheckPipeline` is `false` (default), the graph runs:

- `factCheck`
- `externalFactCheck`
- `impact`
- then continues to `draft`

If `enableFactCheckPipeline` is `true`, the graph inserts:

- `factCheckPipelineGate`
- `citationSourceGeneration`
- `citationWrite`
- `impact`

The gate only runs the pipeline when unresolved claims remain after `externalFactCheck`.

## Standalone Fact-Check Pipeline Endpoint

### POST /webhook/fact-check-process

Runs the fact-check pipeline in isolation, without the rest of the IRG drafting loop.

This endpoint is useful when you already have claims and want to:
- check the filesystem fact store for existing citations
- generate candidate sources for unresolved claims
- write provisional citation artifacts for later review

**Request:**
```bash
curl -X POST http://localhost:2100/webhook/fact-check-process \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Check whether Saturn has rings.",
    "context": {"team": "IRG", "project": "reference"},
    "maxIterations": 2,
    "confidenceThreshold": 0.8,
    "model": "llama-3.3-70b-versatile",
    "enableFactCheckPipeline": true,
    "claims": [
      {
        "claim": "Saturn has rings.",
        "importance": "Core astronomy claim.",
        "assessment": "true",
        "reasoning": "Widely known astronomy fact.",
        "source": null
      }
    ]
  }'
```

You can provide claims in either of these shapes:

- top-level `claims`
- `factCheckResult.critical_claims`

**Request Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | `Standalone fact-check pipeline request` | Optional label/query for the run |
| `context` | object | `{}` | Additional context |
| `maxIterations` | number | 2 | Maximum iterations in the standalone pipeline |
| `confidenceThreshold` | number | 0.8 | Confidence threshold included in response metadata |
| `model` | string | `llama-3.3-70b-versatile` | Groq model to use |
| `enableFactCheckPipeline` | boolean | true | Keeps the standalone pipeline enabled; if false, the gate may skip source generation |
| `claims` | array | optional | Array of claim objects to process |
| `factCheckResult.critical_claims` | array | optional | Alternate input shape matching the internal fact-check node output |

At least one of `claims` or `factCheckResult.critical_claims` must be provided.

**Response:**

Returns a JSON object with:

- `session_id`
- `timestamp`
- `query`
- `context`
- `config`
- `final_decision`
- `nodes_executed`
- `trace`
- `externalFactCheckResult`
- `citationSourceGenerationResult`
- `factCheckPipelineResult`

## Citation Artifact Semantics

The citation writer currently writes **provisional** artifacts only.

These records represent generated source candidates, not verified evidence. Written artifacts are marked with fields such as:

- `verification_level: provisional`
- `verification_status: suggested_sources_unverified`
- `retrieval_mode: llm_generated_source_candidates`
- `retrieval_deferred: true`

Important behavior:

- provisional artifacts are stored in the filesystem fact store for later review/reuse
- provisional artifacts are surfaced by `externalFactCheck`
- provisional artifacts are **not** treated as verified cache hits
- the draft/meta prompts are instructed to treat them as research leads unless an explicitly verified cached citation exists

## Filesystem Outputs

When the citation writer runs, it writes to the filesystem fact store:

- citation JSON artifacts under `fact-store/citations/YYYY-MM/`
- retrieval log entries in `fact-store/metadata/retrieval_log.jsonl`

## Configuration

The API reads the Groq API key from the `.env` file at the repository root:

```
API_KEY_GROQ=your_api_key_here
```

## Development

The server loads:
- Prompts from `core/prompts/irg-prompts.yaml`
- Graph definition from `graphs/irg-graph-linear.js`
- Node registry from `core/execution/irg-node-registry.js`
- Groq LLM client from `core/llm/groq-llm-client.js`

All changes to these files are reflected immediately on the next request.

