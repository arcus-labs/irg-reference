# X-ray Analysis IRG (HealthTech)

An Iterative Reasoning Graph for radiologists: analyze chest/skeletal X-ray
images for diagnostic findings, with a visible reasoning trace rather than a
single black-box prediction. Self-contained here, alongside the fintech IRGs,
and runs on the **same shared engine** (`api-impl-js/core`).

## Layout

```
demos/xray/
  knowledge/xray-claims.json          radiology substrate (ACR / Fleischner / Lung-RADS)
  scripts/seed-xray-rule-citations.js seeds the substrate via the shared kit seeder
  core/
    nodes/*.js                        reasoning nodes (image-quality gate → observation →
                                      triage → hypothesis → differential → adversary →
                                      evidence link → convergence → termination)
    xray-graph-linear.js              flow in the linear-array format (shared interpreter)
    xray-node-registry.js             node registry
    xray-prompts.yaml                 prompt templates
    output-formatter.js               trace → markdown report
    run-xray-modern.js                runs the graph on api-impl-js/core/execution +
                                      I/O seal + provenance (tamper-evident, attestable)
  test-xray-modern.js                 offline smoke test (mock LLM)
```

The **UI is served by the Trace Navigator** at `/medical/xray`
(`trace-navigator/src/app/medical/xray/` + `…/api/xray/*` + `…/src/lib/xray/`).
Its runner loads this engine at runtime via `runXrayModern`.

> The ops-fintech portal is fintech-only; the X-ray IRG is not surfaced there.

## Run

Offline smoke test (no API keys, mock provider):

```bash
node demos/xray/test-xray-modern.js
```

Seed the radiology substrate:

```bash
node demos/xray/scripts/seed-xray-rule-citations.js
```

The interactive UI runs inside the Trace Navigator (`cd trace-navigator &&
npm run dev` → `/medical/xray`). Provider keys (read from the repo-root `.env`):
`ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` (vision), or `GROQ_API_KEY` /
`OPENAI_API_KEY`. Without keys it falls back to the mock provider.

## Disclaimer

Demonstration software. Not a medical device; not for clinical use. Any output
is illustrative of the IRG reasoning process, not a diagnosis.
