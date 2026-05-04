# IRG Reference

Reference implementation and tooling for **Iterative Reasoning Graphs (IRG)**.

IRG externalizes reasoning into explicit graph steps so a model can clarify ambiguity, challenge its own plan, fact-check important claims, assess confidence, and emit inspectable traces.

This repo contains:
- a JavaScript API/runtime in `api-impl-js/`
- a Next.js trace viewer in `trace-navigator/`
- shared defaults in `shared/`
- supporting design notes in `_docs/`

> ⚠️ **This is a research/reference implementation.** It is not hardened for direct exposure to the public internet. Read [`SECURITY.md`](./SECURITY.md) before deploying.

## Repo layout

```text
.
├── README.md
├── LICENSE                 ← CC BY-SA 4.0
├── SECURITY.md
├── CONTRIBUTING.md
├── .env.example
├── _docs/                  ← design notes (CC BY-SA)
├── api-impl-js/
│   ├── api/                ← Express server
│   ├── core/               ← interpreter, primitives, LLM clients
│   ├── graphs/             ← graph definitions (irg-simple, irg-full)
│   ├── test/               ← Node test scripts
│   └── IRG_API.md
├── shared/
│   └── runtime-defaults.json
├── trace-navigator/        ← Next.js trace viewer
├── irg-flow-diagram.md     ← graph flow chart
└── ecosystem.config.cjs
```

## Requirements

- Node.js 20+
- An API key for **at least one** supported LLM provider (see below), or a local Ollama install.

## Quick start

```bash
cp .env.example .env
# Fill in at least one API_KEY_*, plus the trace-navigator entries
# if you plan to run the UI.

# Start the API server
cd api-impl-js
npm install
npm run api
# Listens on http://localhost:2100

# (in another shell) Start the trace navigator
cd trace-navigator
npm install
npm run dev
# Open http://localhost:2000
```

## LLM providers

The API server supports **seven providers** out of the box. Configure any subset by setting the corresponding API key in `.env`:

| Provider   | Env var             | Auto-routed model prefixes                          |
|------------|---------------------|-----------------------------------------------------|
| Groq       | `API_KEY_GROQ`      | (default fallback — no exclusive prefix)            |
| OpenAI     | `API_KEY_OPENAI`    | `gpt-`, `o1`, `o3`, `o4`, `chatgpt-`                |
| Anthropic  | `API_KEY_ANTHROPIC` | `claude-`                                           |
| Mistral    | `API_KEY_MISTRAL`   | `mistral-`, `mixtral-`, `codestral-`, `magistral-`  |
| Google     | `API_KEY_GOOGLE`    | `gemini-`                                           |
| Together   | `API_KEY_TOGETHER`  | `meta-llama/`, `mistralai/`, `Qwen/`, `deepseek-ai/`|
| Ollama     | (none — local)      | `ollama/`                                           |

The provider is selected per-request in this order:

1. Explicit `provider` field in the request body
2. Inferred from the `model` field's prefix
3. The default provider (first one configured, or first listed in `LLM_PROVIDERS_ENABLED`)

To restrict which providers your server accepts, set `LLM_PROVIDERS_ENABLED` (comma-separated, order = display priority):

```env
LLM_PROVIDERS_ENABLED=anthropic,groq,openai
```

If unset, every provider with a configured key is enabled.

## API endpoints

- `GET /health` — service health
- `GET /providers` — list of enabled providers and their curated models
- `POST /webhook/irg-process` — main IRG execution
- `POST /webhook/fact-check-process` — standalone fact-check pipeline

### Main IRG flow example

```bash
curl -X POST http://localhost:2100/webhook/irg-process \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the best practices for machine learning?",
    "context": {"team": "IRG", "project": "reference"},
    "graph": "irg-simple",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "maxIterations": 4,
    "confidenceThreshold": 0.8,
    "enableFactCheck": true,
    "enableImpactPrediction": true,
    "enableAssessor": true
  }'
```

`provider` is optional — if omitted, the model prefix is used to pick the right one.

### Standalone fact-check example

```bash
curl -X POST http://localhost:2100/webhook/fact-check-process \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Check whether Saturn has rings.",
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

## Graph variants

Selectable per-request via the `graph` field:

- **`irg-simple`** (default) — clarify → strategy → adversary → arbiter → factCheck → impact → draft → metaEvaluation → assessor → convergence
- **`irg-full`** — adds the external fact-check pipeline (cache lookup, citation source generation, citation write) between fact-check and impact

See `irg-flow-diagram.md` for a visual.

## Outputs

The API returns structured trace data: node execution records, run metadata, final decision, and (when fact-checking is enabled) `factCheckResult` / `externalFactCheckResult` / `factCheckPipelineResult` blocks.

When the citation pipeline runs, it writes **provisional** filesystem artifacts under `_fact-store/` for later review and reuse.

## Tests

```bash
cd api-impl-js && npm test
cd trace-navigator && npm test
```

## Security & deployment

This reference implementation has **no authentication** on the API server and **no rate limiting**. A bad actor with network access can drain your provider quotas. If you deploy this anywhere reachable from outside your machine, put a reverse proxy with auth + rate limits in front. See [`SECURITY.md`](./SECURITY.md).

## Useful docs

- [`api-impl-js/IRG_API.md`](./api-impl-js/IRG_API.md) — full API reference
- [`_docs/Iterative_Reasoning_Graphs.md`](./_docs/Iterative_Reasoning_Graphs.md) — IRG protocol writeup
- [`_docs/Epistemic_Integrity_Evaluations.md`](./_docs/Epistemic_Integrity_Evaluations.md) — EIE protocol writeup
- [`_docs/EIE-questions.md`](./_docs/EIE-questions.md) — EIE standard question set
- [`trace-navigator/README.md`](./trace-navigator/README.md) — trace viewer setup
- [`irg-flow-diagram.md`](./irg-flow-diagram.md) — graph flow chart
- [`agentic-coder-flow.md`](./agentic-coder-flow.md) — applying IRG to coding agents

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs and issues welcome.

## License

This repository — code, docs, diagrams — is licensed under [**Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**](./LICENSE).

You are free to share and adapt the work, including for commercial use, provided you give attribution and license your derivatives under the same terms.

Arcus Labs publishes a separate commercial product line built on these ideas (the Reason DSL runtime and EIE monitoring pipeline). That work is not part of this repository and is licensed under different terms.
