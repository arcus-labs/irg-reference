//! Build the citable set from verify + recall results.
//!
//! Port of `api-impl-js/core/citations/build-citable-set.js`. Citability:
//! verification_level == "verified" AND verdict in {supported, refuted}.
//! Dedupes by claim_key (fresh verify wins over recalled). Assigns cit_N
//! handles and derives the durable uuid from claim_key.

use std::collections::HashSet;

use serde_json::{json, Value};

use super::citation_id::derive_claim_uuid;
use super::types::CitableClaim;

fn is_citable(verdict: Option<&str>, level: Option<&str>) -> bool {
    level == Some("verified") && matches!(verdict, Some("supported") | Some("refuted"))
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn normalize_source(s: &Value) -> Option<Value> {
    let url = s.get("url").and_then(Value::as_str)?;
    if url.is_empty() {
        return None;
    }
    let span = s
        .get("supporting_span")
        .and_then(Value::as_str)
        .or_else(|| {
            s.get("verification")
                .and_then(|v| v.get("quoted_excerpt"))
                .and_then(Value::as_str)
        });
    let title = s
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| s.get("extracted_title").and_then(Value::as_str));
    let span_offset = match s.get("span_offset") {
        Some(Value::Number(n)) if n.is_i64() || n.is_u64() => s.get("span_offset").cloned().unwrap(),
        _ => Value::Null,
    };
    Some(json!({
        "url": url,
        "title": title,
        "supporting_span": span,
        "span_offset": span_offset,
        "excerpt": s.get("excerpt").and_then(Value::as_str),
    }))
}

fn normalize_sources(sources: Option<&Value>) -> Vec<Value> {
    match sources.and_then(Value::as_array) {
        Some(arr) => arr.iter().filter_map(normalize_source).collect(),
        None => Vec::new(),
    }
}

fn make_entry(
    claim_key: &str,
    claim_text: Option<&str>,
    verdict: Option<&str>,
    verification_level: Option<&str>,
    verification_confidence: Option<Value>,
    sources: Option<&Value>,
    citation_path: Option<&str>,
) -> CitableClaim {
    CitableClaim {
        handle: String::new(), // assigned after assembly
        uuid: derive_claim_uuid(claim_key),
        claim_key: Some(claim_key.to_string()),
        claim_text: claim_text.map(str::to_string),
        verdict: verdict.map(str::to_string),
        verification_level: verification_level.map(str::to_string),
        verification_confidence: Some(match verification_confidence {
            Some(Value::Number(n)) => Value::Number(n),
            _ => json!(0),
        }),
        sources: normalize_sources(sources),
        citation_path: citation_path.map(str::to_string),
    }
}

/// Assemble the citable set. Inputs are the loosely-shaped verify / recall
/// result objects (as JSON), matching the JS/Python signatures.
pub fn build_citable_set(
    citation_verify_result: Option<&Value>,
    memory_recall_result: Option<&Value>,
) -> Vec<CitableClaim> {
    let mut entries: Vec<CitableClaim> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Fresh verifications.
    if let Some(results) = citation_verify_result
        .and_then(|v| v.get("results"))
        .and_then(Value::as_array)
    {
        for r in results {
            let verdict = str_field(r, "verdict");
            let level_owned;
            let level = match str_field(r, "verification_level") {
                Some(l) => Some(l),
                None => {
                    let status = str_field(r, "verification_status").unwrap_or("");
                    level_owned = if status.starts_with("verified") {
                        "verified"
                    } else {
                        "provisional"
                    };
                    Some(level_owned)
                }
            };
            if !is_citable(verdict, level) {
                continue;
            }
            let (Some(ck), Some(text)) = (str_field(r, "claim_key"), str_field(r, "claim_text"))
            else {
                continue;
            };
            if seen.contains(ck) {
                continue;
            }
            seen.insert(ck.to_string());
            entries.push(make_entry(
                ck,
                Some(text),
                verdict,
                level,
                r.get("verification_confidence").cloned(),
                r.get("sources"),
                str_field(r, "citation_path"),
            ));
        }
    }

    // Recalled verifications.
    if let Some(results) = memory_recall_result
        .and_then(|v| v.get("results"))
        .and_then(Value::as_array)
    {
        for r in results {
            let rec = match r.get("recall") {
                Some(v) => v,
                None => continue,
            };
            if !rec.get("hit").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            let verdict = str_field(rec, "verdict");
            let level = str_field(rec, "verification_level");
            if !is_citable(verdict, level) {
                continue;
            }
            let (Some(ck), Some(text)) = (str_field(r, "claim_key"), str_field(r, "claim_text"))
            else {
                continue;
            };
            if seen.contains(ck) {
                continue;
            }
            seen.insert(ck.to_string());
            entries.push(make_entry(
                ck,
                Some(text),
                verdict,
                level,
                rec.get("verification_confidence").cloned(),
                rec.get("sources"),
                str_field(rec, "citation_path"),
            ));
        }
    }

    for (i, e) in entries.iter_mut().enumerate() {
        e.handle = format!("cit_{}", i + 1);
    }
    entries
}
