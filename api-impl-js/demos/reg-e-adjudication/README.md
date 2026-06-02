# IRG demo — Regulation E adjudication

The serious one. A consumer files a Reg E unauthorized-transaction dispute; the
IRG ingests the institution's evidence packet, reasons through the case with
the full System-2 stack, and produces three artifacts for the adjuster:

1. **`<case>.trace.json`** — the complete IRG reasoning trace (drop into the
   trace navigator to walk through it node by node).
2. **`<case>.decision.json`** — a structured IRAC-shaped decision artifact
   (issue, rule, application findings, conclusion, consumer recourse,
   regulatory next steps). Audit-ready.
3. **`<case>.notice.md`** — the consumer-facing notice letter, Toulmin-shaped
   to satisfy §1005.11(d)/(e) disclosure: claim, grounds, cited rule,
   acknowledged rebuttal, qualifier + recourse.

This is the demo where IRG's value lands for a regulated buyer: a reasoning
process that is **auditable by structure** (every step a named node in the
trace), **grounded in citations** (every regulatory and factual statement
cited to a verified rule or evidence item), and **honest** (the adversary
node challenges the leading hypothesis before the arbiter rules, and the
draft separates rule-application from determination).

---

## Strategy composition (Cognitive Engineering Thesis §10)

The graph is *not* `irg-simple` with a different prompt. It is a **named
strategy composition** drawn from the thesis's strategy inventory:

| Layer | Strategy | Where it lives |
|---|---|---|
| Outer | **IRAC** — Issue → Rule → Application → Conclusion | distributed across `strategy` / `caseRecall` / `arbiter` |
| Application phase | **Differential Diagnosis** — enumerate candidates (true fraud / forgotten-consent / family use / merchant error / account compromise), narrow with evidence | `strategy` and `arbiter` prompts |
| Challenge | **Steelman + Red Team** — strengthen the consumer's claim, then attack the leading hypothesis | `adversary` prompt |
| Output | **Toulmin Argumentation** — Claim · Grounds · Warrant · Rebuttal · Qualifier | `draft` prompt + notice-letter projection |

The three-layer separation the thesis prescribes (§3) is enforced:

- **Structure (the graph):** `irg-graph-reg-e-adjudication` — same topology as `irg-simple`, with `caseRecall` swapped in for `memoryRecall`.
- **Implementation (the prompts):** an overlay-only **adjudication prompt pack** appended to each node's `system` at deploy time. The committed YAML prompts are untouched.
- **Substrate (the knowledge):** the Reg E rules are precomputed verified citation artifacts in the fact-store — first-class, queryable, exportable, swappable. See `../reg-e/scripts/seed-reg-e-rule-citations.js`.

This is the design discipline. Same engine, swap the layer.

---

## How it runs

```
seed Reg E rule citations  ──►  parse case packet (markdown)
                                     │
                                     ▼
              irg-reg-e-adjudication graph  (real LLM, full System-2)
              clarify → strategy → adversary → arbiter → strategyGate
                  → factCheck → caseRecall → impact → draft
                  → citationApply → citationQuality
                  → metaEvaluation → assessor → convergence → exit
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
       decision.json          notice.md (Toulmin)      trace.json
       (IRAC-shaped)          §1005.11(d)/(e) letter   (navigator-viewable)
```

The runner auto-seeds the rule citations into a fresh fact-store, overlays the
adjudication prompt pack onto a clone of the YAML, runs the graph, and
projects the trace into the decision artifact and the notice letter via two
focused post-graph LLM calls.

## Case packet (markdown text file)

A realistic dispute is documented in `cases/case-001-bright-stream.md`:

- Consumer dispute form (the consumer's verbatim statement).
- Internal transaction record + authorization & tokenization log (the
  $487.23 charge, the consent token from a prior free-trial enrollment).
- Account session log (no consumer session at transaction time).
- Customer account history (no prior streaming-media merchants).
- Merchant profile (legitimate, known free-trial-to-recurring model).
- Reporting timeline (consumer reported within 2 business days of statement).
- An **`## Evidence Index`** section enumerating `[E1] … [E9]` — these are the
  structured citation handles the IRG cites from.

The case is designed with real adversarial tension: a consent token from
*6 months earlier* (free trial → recurring billing) is on file. The consumer
denies signing up. A naive system would refund or deny without engagement;
the IRG must steelman the consumer, red-team the institution's records, and
issue a defensible determination.

## Run

```sh
# needs an LLM provider key (API_KEY_GROQ) in the repo-root .env
node demos/reg-e-adjudication/adjudicate.js
# options:
#   --case <case-id>         (default: case-001-bright-stream)
#   --provider groq          (any configured provider)
#   --model <model>          (default: llama-3.3-70b-versatile)
#   --no-seed                (skip rule-citation auto-seed)
```

Outputs land in `demos/reg-e-adjudication/output/` (gitignored). Copy the
`*.trace.json` into `trace-navigator/traces/` to walk through the reasoning
node by node in the UI.

## What you should see (case-001)

The forgotten-consent pattern produces a defensible **DENY**:

- Decision: `deny` · refund $0 · liability tier `n/a — not unauthorized`.
- Issue: whether the disputed transaction is unauthorized under §1005.2(m).
- Rule: §1005.2(m) (definition), §1005.6(b)(1) (would-be tier if it were).
- Application findings: tokenized consent predates the disputed transaction; the recurring billing token was provisioned from a consumer-initiated subscription enrollment; consumer reported promptly (timing acknowledged as context).
- Conclusion: not an unauthorized EFT — the transfer was authorized via the prior consent.
- Consumer recourse: cancel the subscription with the merchant; Northwind customer support; (notice letter also notes the CFPB complaint right and the right to request a copy of the investigation).

A different case packet (clear third-party fraud) would produce **ACCEPT**
with the $50 liability tier and the §1005.11 investigation timeline. Same
graph, same prompts. Different evidence, different determination.
