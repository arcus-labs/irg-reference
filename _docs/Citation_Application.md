# Citation Application — Contract Spec

**Status:** v0.1 (locked for JS reference implementation)
**Scope:** language-agnostic contract. The JS implementation is the first conformant implementation; Python / Rust / LangChain ports must satisfy the same contract + golden fixtures.

---

## 1. Purpose

Decorate IRG responses with verifiable citations to claims the pipeline has **verified**. Two-phase design:

1. **Generation-time tagging** — the drafting model wraps asserted claims in an inline `<citation>` tag as it writes.
2. **Deterministic validation** (`citationApply`) — strip hallucinated references, mint/assign IDs, build the reference list.

Applies to both graphs:
- `irg-external-facts` — uses **fresh** verified citations from `citationVerify`.
- `irg-simple` — uses **recalled** verified citations surfaced by `memoryRecall` from prior runs.

If no verified citations are available, the feature is inert and drafting behaves exactly as before.

---

## 2. Identifiers (two-ID system)

Every citation carries **two** identifiers:

| ID | Type | Source | Purpose | Shown to user |
|----|------|--------|---------|---------------|
| `uuid` | UUID v5 (derived) | Derived deterministically from `claim_key` (RFC-4122 v5, fixed IRG namespace); durable across sessions | Stable, traceable handle — links a citation back to the exact claim record | No |
| `seq` | positive integer | Assigned by `citationApply`, dense 1..K by first appearance in the prose | Human-readable marker (`[1]`, `[2]`) | Yes |

- The **claim's `uuid`** is a deterministic UUID v5 over the `claim_key` (the SHA-256 of the canonical DSL), using a fixed IRG namespace. It is written onto the claim at first persistence and recomputed identically on recall, so citing the same claim across different responses — or across store rebuilds and polyglot ports — always yields the same `uuid`. (We chose derived-v5 over random-v4 precisely so durability needs no read-back plumbing and the projection stays a pure, conformance-testable function.)
- The **`seq`** is per-response and renumbered densely so output reads `[1][2][3]` with no gaps.
- `claim_key` (existing SHA-256 of the canonical DSL) is also carried for provenance, but is NOT a citation identifier — it's the dedup/match key.

---

## 3. The citation tag

### 3.1 Draft phase (what the LLM emits)

The model is given the citable set with short provisional handles `cit_<n>` and emits:

```
<citation ref="cit_3">antibiotics do not act on viral infections</citation>
```

- Element: `citation`
- `ref`: one or more space-separated provisional handles (`cit_1`, `cit_1 cit_2`)
- Inner content: the prose span making the claim
- **No nesting.**

### 3.2 Resolved phase (after `citationApply`)

`citationApply` rewrites each tag to carry both durable and display IDs:

```
<citation ref="3f9c…uuid" seq="1">antibiotics do not act on viral infections</citation>
```

- `ref`: the claim's durable `uuid` (space-separated for multi-source)
- `seq`: the display integer(s) (space-separated, parallel to `ref`)

The renderer shows `seq` as the superscript marker and resolves `ref` → the `references[]` entry for the tooltip / link.

---

## 4. The Reference record

Every response carries `references: Reference[]`. Each entry:

```jsonc
{
  "uuid": "3f9c…",                    // durable claim UUID — matches tag ref
  "seq": 1,                            // dense display integer — matches tag seq
  "claim_key": "a1b2…",                // SHA-256 provenance link (not an ID)
  "claim_text": "Antibiotics target bacteria, not viruses.",
  "verdict": "supported",              // supported | refuted | inconclusive
  "verification_level": "verified",    // verified | provisional
  "verification_confidence": 0.0,      // 0–1, from citationVerify
  "sources": [
    {
      "url": "https://…",
      "title": "…",
      "supporting_span": "…",          // the exact passage that supports/refutes
      "span_offset": 1840,             // char offset of the span in the fetched markdown (nullable)
      "excerpt": "…"                   // readability lead fallback when no span found
    }
  ],
  "citation_path": "citations/2026-05/a1b2….json"  // optional
}
```

### 4.1 Span-level grounding

`citationVerify` does not merely return a verdict — when it judges `supported` or `refuted`, it returns the **exact passage** from the fetched source markdown that backs that verdict, stored as `sources[].supporting_span` (with a best-effort `span_offset` into the markdown). This turns "here is a source about this topic" into "here is the exact sentence that supports/contradicts the claim" — the credibility jump that span-level attribution systems (e.g. the Anthropic Citations API) provide.

Rules:
- `supporting_span` is REQUIRED on a source whenever the citation's verdict is `supported` or `refuted` and the source was successfully fetched.
- If verification could not locate a span (e.g. the supporting evidence is diffuse), `supporting_span` is `null` and `excerpt` (the readability lead) is the fallback shown in the UI.
- `span_offset` is best-effort; `null` is acceptable. The span text is authoritative, the offset is a convenience for highlighting.

---

## 5. Citability rules (honesty contract)

Only **verified** citations may be cited. Provisional/unfetched/inconclusive evidence never becomes a `<citation>`.

| verification_level | verdict | Citable? | Rendering |
|---|---|---|---|
| `verified` | `supported` | ✅ | normal citation |
| `verified` | `refuted` | ✅ | "contradicts" citation — the prose presents the correction |
| `verified` | `inconclusive` | ❌ | — |
| `provisional` | any | ❌ | at most a non-citation "research lead" note |

**Refuted is deliberately citable.** "Contrary to a common belief, X is false [1]" is a stronger integrity posture than only citing confirmations.

---

## 6. Flow

```
        ┌─ build citable set ─┐     ┌──── draft (LLM) ────┐     ┌── citationApply (pure module) ─┐
verify/ │ verified +          │     │ citation-aware       │     │ parse <citation> tags          │
recall ─┤ supported|refuted   ├────▶│ prompt: wrap claims  ├────▶│ drop refs ∉ citable set        ├──▶ prose + references[]
results │ provisional cit_N   │     │ in <citation ref=…>  │     │ resolve cit_N → uuid           │
        │ + carry claim uuid  │     └──────────────────────┘     │ renumber dense seq 1..K        │
        └─────────────────────┘                                  │ rewrite tags ref=uuid seq=int  │
                                                                  │ build references[]             │
                                                                  └────────────────────────────────┘
```

1. **Build citable set** (pre-draft, pure fn): collect verified+citable citations from `citationVerifyResult` (fresh) and `memoryRecallResult` (recalled). Each entry: `{ handle: 'cit_N', uuid, claim_key, claim_text, verdict, verification_level, verification_confidence, sources }`. Empty set → skip all citation logic.
2. **Draft** (LLM): citation-aware prompt receives the citable set and wraps asserting spans in `<citation ref="cit_N">…</citation>`. Instructed to: cite only when the span genuinely makes that claim; never invent handles; present refuted claims as corrections.
3. **`citationApply`** (pure module, no LLM): parse tags → drop any handle not in the citable set (keep inner text) → resolve surviving handles to `uuid` → renumber used citations densely by first appearance → rewrite tags with `ref`+`seq` → build `references[]`.

---

## 7. Generation-time + validation rationale

Attribution correctness is the entire value; a wrong citation actively misleads. Only the model writing the sentence knows which claim it's asserting, so attribution is most accurate at write time. The fatal risk — hallucinated handles — is killed cheaply by the deterministic `citationApply` pass. Pure post-hoc prose→claim matching (cf. RARR, §11) remains a documented fallback for models that ignore the instruction, but is NOT the primary path.

---

## 8. Components (JS reference)

| Component | Type | Role |
|---|---|---|
| `core/citations/citation-format.js` | pure module | parse / serialize / validate / rewrite tags — **conformance core** |
| `core/citations/build-citable-set.js` | pure module | assemble citable set from verify + recall results |
| `core/citations/apply.js` | pure module | the validate → resolve → renumber → build-references function |
| `core/nodes/citation-apply-node.js` | pure-logic node | thin graph wrapper around `core/citations/apply.js` |
| `core/prompts/irg-prompts.yaml` | prompt | citation-aware draft variant |
| `core/nodes/draft-node.js` | change | thread citable set in, select prompt variant |
| `core/external-fact-check/claim-store.js` | change | mint + persist claim `uuid` |
| graphs + registry | wiring | `draft → citationApply → metaEvaluation …` (both graphs) |
| trace-navigator | UI | `CitationMark` component, References section, `citation_apply` card |

`citationApply` is its own module with the node as a thin wrapper — separation of concerns; the pure module is what the conformance fixtures target.

---

## 9. Trace navigator rendering

- Prose: `react-markdown` + `rehype-raw`, custom `citation` component → superscript `seq`, hover tooltip (claim · verdict · confidence · source title · excerpt), click → URL. Verdict color: supported = accent, refuted = red.
- **References** section under the answer: dense numbered list with verdict badge, confidence, source links + excerpts.
- `citation_apply` node card: tags found / validated / dropped-as-invalid / references built.

---

## 10. Conformance (polyglot)

**Shared contract:** §2 IDs, §3 tag syntax, §4 Reference schema, §5 citability table, §6 validation semantics.

**Golden fixtures** (the heart of cross-impl conformance — pure, language-neutral):

```
{ draft_with_tags, citable_set } → { validated_prose, references[] }
```

`citationApply` is deterministic, so fixtures run identically in JS / Python / Rust / LangChain and diff exactly. The drafting (LLM) step is non-deterministic and is NOT conformance-tested — only the format + validation contract is.

Fixture coverage must include every §11 edge case.

---

## 11. Edge cases (defined behavior)

- Handle not in citable set → strip tag markup, keep inner text. (hallucination guard)
- Malformed / unclosed tag → strip markup, keep text.
- Nested tags → not allowed; inner markup stripped.
- No citable set → all `<citation>` tags stripped (model shouldn't emit any).
- Same claim cited N times → one `references[]` entry, N in-text markers, same `uuid`/`seq`.
- `ref="cit_1 cit_2"` → validated independently; one invalid → keep the valid one.
- Verdict `refuted` → kept and cited; rendering shows "contradicts".
- Citable but never referenced in prose → omitted from `references[]` (only used citations appear).

---

## 12. ClaimReview interop ("lite" projection)

The native IRG citation (§4) is the **full** format. We additionally project each verified citation into **schema.org `ClaimReview`** JSON-LD — the W3C-adopted standard consumed by Google Fact Check Tools and the broader fact-checking ecosystem.

**Positioning:** ClaimReview is the *lite, interoperable* view. It plays nice with external tooling but is lossy. Consumers who want the full capabilities — durable `uuid`, display `seq`, `verification_confidence`, span-level grounding, memory provenance, the governed reasoning trace — use the native format. ClaimReview is what you publish for interop; the native record is what powers the product.

### 12.1 Verdict → reviewRating mapping

`reviewRating` uses a 1–5 scale (`bestRating: 5`, `worstRating: 1`):

| IRG verdict | ratingValue | alternateName |
|---|---|---|
| `supported` | 5 | `"True"` |
| `refuted` | 1 | `"False"` |
| `inconclusive` | 3 | `"Unproven"` |

### 12.2 Field mapping

| ClaimReview field | Source |
|---|---|
| `@type` | `"ClaimReview"` |
| `claimReviewed` | `claim_text` |
| `reviewRating` | per §12.1 |
| `author` | `{ "@type": "Organization", "name": "Arcus Labs — IRG" }` |
| `itemReviewed.appearance[]` | `sources[].url` as `CreativeWork`s |
| `datePublished` | citation `created_at` / `verified_at` |
| `url` | `citation_path` (or omitted if no public URL) |

### 12.3 What's lost in the projection

`uuid`, `seq`, `verification_confidence`, `supporting_span`/`span_offset`, `claim_key`, memory provenance, and the EIE governance trace have no ClaimReview equivalent and are dropped. The lossy direction is one-way: native → ClaimReview. We never re-import ClaimReview as the source of truth.

### 12.4 Export surface

- **Only verified citations** are exported by default (provisional citations are not real fact-checks). `--include-provisional` opts them in (mapped to `inconclusive`/Unproven).
- A collection is wrapped as JSON-LD:
  ```json
  { "@context": "https://schema.org", "@graph": [ { …ClaimReview… }, … ] }
  ```
- Surfaced via the `fact-store` CLI: `fact-store export --format claimreview [--out file] [--include-provisional]`.
- The mapping (`citation → ClaimReview`) is a pure function and part of the conformance corpus, so every polyglot port emits byte-comparable ClaimReview.

---

## 13. Quality metrics (next milestone)

We will need numbers that *defend* the framework's accuracy. The established benchmark is **ALCE** (Automatic LLM Citation Evaluation), which scores two things:

- **Citation recall** — is every claim-bearing sentence in the response backed by at least one citation?
- **Citation precision** — does each cited source actually support the sentence it's attached to?

Plan (built after the core citation feature lands):
- A post-response evaluation module computes recall + precision over the validated prose + `references[]`. We already have the verified claims and the supporting spans, so precision can reuse the `citationVerify` NLI judgment (supported = entailment) rather than a fresh model call.
- Surface the scores in the trace (an `assessor` EIE dimension or a dedicated `citation_quality` node) and in the API response metadata.
- These become the headline accuracy numbers for the public launch — and they're the metric a skeptical ML audience will ask for first.

This is tracked as the next step, not part of the v0.1 citation contract.
