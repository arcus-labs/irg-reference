//! ClaimReview projection (schema.org interop "lite" view).
//!
//! Port of `api-impl-js/core/external-fact-check/claimreview.js`. Lossy,
//! one-way native -> ClaimReview. PURE.

use serde_json::{json, Map, Value};

fn default_author() -> Value {
    json!({ "@type": "Organization", "name": "Arcus Labs — IRG" })
}

/// Map an IRG verdict to a schema.org Rating (1–5). Unknown -> Unproven.
pub fn verdict_to_rating(verdict: Option<&str>) -> Value {
    let (rating_value, alternate_name) = match verdict {
        Some("supported") => (5, "True"),
        Some("refuted") => (1, "False"),
        _ => (3, "Unproven"),
    };
    json!({
        "@type": "Rating",
        "ratingValue": rating_value,
        "bestRating": 5,
        "worstRating": 1,
        "alternateName": alternate_name,
    })
}

fn first_10_chars(s: &str) -> String {
    s.chars().take(10).collect()
}

/// Project a single native citation into a ClaimReview object.
pub fn to_claim_review(citation: &Value, author: Option<&Value>) -> Value {
    let claim_text = citation
        .get("claim")
        .and_then(|c| c.get("raw_text"))
        .and_then(Value::as_str)
        .or_else(|| citation.get("claim_text").and_then(Value::as_str))
        .unwrap_or("");

    let appearance: Vec<Value> = citation
        .get("sources")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("url").and_then(Value::as_str))
                .filter(|u| !u.is_empty())
                .map(|u| json!({ "@type": "CreativeWork", "url": u }))
                .collect()
        })
        .unwrap_or_default();

    let date_published = citation
        .get("verified_at")
        .and_then(Value::as_str)
        .or_else(|| citation.get("created_at").and_then(Value::as_str));

    let mut item_reviewed = Map::new();
    item_reviewed.insert("@type".into(), json!("Claim"));
    if !appearance.is_empty() {
        item_reviewed.insert("appearance".into(), Value::Array(appearance));
    }

    let mut cr = Map::new();
    cr.insert("@type".into(), json!("ClaimReview"));
    cr.insert("claimReviewed".into(), json!(claim_text));
    cr.insert("reviewRating".into(), verdict_to_rating(citation.get("verdict").and_then(Value::as_str)));
    cr.insert("author".into(), author.cloned().unwrap_or_else(default_author));
    cr.insert("itemReviewed".into(), Value::Object(item_reviewed));
    if let Some(dp) = date_published {
        cr.insert("datePublished".into(), json!(first_10_chars(dp)));
    }
    if let Some(path) = citation.get("citation_path").and_then(Value::as_str) {
        cr.insert("url".into(), json!(path));
    }
    Value::Object(cr)
}

/// Project a collection into a single JSON-LD document with an @graph.
/// Only verified citations unless `include_provisional`.
pub fn to_claim_review_collection(
    citations: &[Value],
    include_provisional: bool,
    author: Option<&Value>,
) -> Value {
    let graph: Vec<Value> = citations
        .iter()
        .filter(|c| {
            include_provisional
                || c.get("verification_level").and_then(Value::as_str) == Some("verified")
        })
        .map(|c| to_claim_review(c, author))
        .collect();

    json!({
        "@context": "https://schema.org",
        "@graph": graph,
    })
}
