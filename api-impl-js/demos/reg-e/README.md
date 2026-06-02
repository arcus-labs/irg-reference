# IRG demo — Regulation E (consumer financial)

Three consumer-support scenarios that showcase IRG's value for a regulated
financial product: **grounded, citation-backed answers with a built-in honesty
posture and an auditable reasoning trace.**

> **Framing (important):** these are demonstrations of *grounded reasoning*, not
> legal advice and not a certified compliance product. By design the IRG **cites
> the rule, hedges, refuses to issue a binding determination, and escalates to
> the institution's formal dispute/notification process.** That posture — "here
> is what the regulation says, here is what we still need, here is your next
> step" — is itself the point.

## Scenarios (`scenarios.json`)

| id | Reg E area | Consumer question |
|---|---|---|
| `unauthorized-charge` | §1005.2(m), §1005.6, §1005.11 | "A $240 charge I never made — am I on the hook, and what now?" |
| `stop-recurring-payment` | §1005.10(c) | "Stop my recurring gym membership before the next pull." |
| `remittance-cancel` | §1005.34, §1005.33 | "I sent money abroad with the wrong account number — can I cancel?" |

## How it works

```
knowledge pack (CFR rules as verified claims)
        │  seed (embed into a demo fact-store)
        ▼
  retrieve applicable rules  ──►  draft (compliance posture, real LLM)
   • llm: reasoning selects        • cites the § for every rule statement
     the relevant rules            • hedges, escalates, no determination
   • semantic: ClaimIndex          ▼
     (best w/ OpenAI embeds)   citationApply  → resolve durable IDs + references[]
                                   ▼
                              citationQuality → ALCE recall / precision / f1
```

Everything reuses the real IRG pieces: the citation pipeline
(`core/citations`), the `draft` / `citationApply` / `citationQuality` nodes, the
pluggable `ClaimIndex` (`core/retrieval`), and the fact-store. The only
demo-specific glue is the knowledge pack, the seeder, the retriever, and the
compliance prompt addendum (applied at draft time — the committed core prompts
are untouched).

## Knowledge pack (`knowledge/reg-e-claims.json`)

12 CFR Part 1005 rules, each as a **verified** fact-claim with the exact §, an
eCFR link, and the rule text as the supporting span. Paraphrased for demos;
authoritative text is the eCFR.

## Retrieval modes

- **`--retrieval llm`** (default): the reasoning step selects which rules apply.
  Reliable with any provider — it bridges consumer language ("am I on the hook")
  to the legal concept ("liability") that sparse local embeddings miss.
- **`--retrieval semantic`**: pure `ClaimIndex` embedding retrieval. Best with a
  strong embedding provider (set `API_KEY_OPENAI`); with the local hash embedder
  it is noisier (kept for illustration).

## Run

```sh
# needs an LLM provider key (e.g. API_KEY_GROQ) in the repo-root .env
node demos/reg-e/run.js --scenario unauthorized-charge
node demos/reg-e/run.js --scenario stop-recurring-payment
node demos/reg-e/run.js --scenario remittance-cancel
# options: --provider groq --model <m> --retrieval llm|semantic
```

Outputs (written to `demos/reg-e/output/`, gitignored):
- `<scenario>.json` — query, selected rules, the cited answer, `references[]`, citation-quality scores.
- `<scenario>.trace.json` — a trace-navigator-viewable trace (drop into `trace-navigator/traces/` to explore the reasoning visually).

## What to look for in the demo

- Every regulatory statement carries an inline citation resolving to the exact CFR §.
- The answer **hedges and escalates** instead of ruling on the consumer's liability.
- The **References** list links to the eCFR.
- **Citation quality** gives an at-a-glance recall/precision/f1 over the answer.
- The full reasoning **trace** is auditable end-to-end.
