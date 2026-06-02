# IRG — Rust port (citation conformance core)

A Rust implementation of the **deterministic, I/O-free citation core** of IRG,
part of the polyglot "Rosetta-Stone" reference. It targets the shared,
language-neutral conformance corpus at [`../conformance/fixtures`](../conformance),
so the same golden cases that pin the JavaScript reference
([`api-impl-js`](../api-impl-js)) and the Python port ([`api-impl-py`](../api-impl-py))
also pin this one.

## Scope

Ported (the pure conformance contract — see [`_docs/Citation_Application.md`](../_docs/Citation_Application.md)):

| Module | Purpose |
| --- | --- |
| `citations::citation_id` | durable claim UUID — RFC-4122 v5 over `claim_key` (SHA-1 inlined, no crypto dep) |
| `citations::citation_format` | parse / sanitize / serialize / strip the `<citation>` tag |
| `citations::apply` | validate → resolve → renumber → build `references[]` |
| `citations::build_citable_set` | assemble the citable set from verify + recall results |
| `citations::quality_metrics` | ALCE-style citation recall / precision / f1 |
| `external_fact_check::claimreview` | schema.org ClaimReview projection |

**Not** ported: the reasoning-graph executor, the LLM layer, and the
fact-store. Those are the non-deterministic / I/O parts that fall outside the
conformance contract.

## Dependencies

`regex` (tag scanning), `serde` + `serde_json` (the citation records are
JSON-shaped). SHA-1 / UUID v5 are implemented inline so the durable-ID
derivation is explicit and matches the other ports exactly.

## Run the tests

```sh
cargo test
```

- `tests/conformance.rs` — runs the shared golden corpus (apply fixtures +
  the `claim_key → uuid` cases) and asserts equivalence with the reference.
- `tests/units.rs` — the §11 edge cases and per-module unit tests, mirroring
  the JS / Python suites.

## Conformance

`apply_citations` is deterministic, so its output (validated prose +
`references[]` + stats) must match the JS/Python ports exactly for every
fixture. The UUID derivation reproduces the shared `citation-id` fixture. The
LLM-driven steps (drafting, the quality judge) are non-deterministic and are
**not** conformance-tested — only the format + validation + projection
contract is.
