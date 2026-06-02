//! Unit tests mirroring the JS / Python suites: §11 apply edge cases plus the
//! build_citable_set / quality_metrics / claimreview / citation_id modules.

use irg::citations::quality_metrics::{compute_citation_quality, SentenceJudgment};
use irg::external_fact_check::claimreview::{
    to_claim_review, to_claim_review_collection, verdict_to_rating,
};
use irg::{apply_citations, build_citable_set, derive_claim_uuid, CitableClaim};
use serde_json::json;

fn citable(handle: &str, claim_key: &str, verdict: &str) -> CitableClaim {
    serde_json::from_value(json!({
        "handle": handle,
        "uuid": derive_claim_uuid(claim_key),
        "claim_key": claim_key,
        "claim_text": format!("claim {handle}"),
        "verdict": verdict,
        "verification_level": "verified",
        "verification_confidence": 0.8,
        "sources": [],
    }))
    .unwrap()
}

// ---------------------------------------------------------------------------
// citation_id
// ---------------------------------------------------------------------------

#[test]
fn citation_id_deterministic_and_shaped() {
    assert_eq!(derive_claim_uuid("abc"), derive_claim_uuid("abc"));
    assert_ne!(derive_claim_uuid("abc"), derive_claim_uuid("xyz"));
    assert_eq!(derive_claim_uuid(""), "");
    let u = derive_claim_uuid("abc");
    // canonical v5 shape: 8-4-4-4-12, version nibble 5, variant 8/9/a/b
    let parts: Vec<&str> = u.split('-').collect();
    assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12]);
    assert!(parts[2].starts_with('5'));
    assert!(matches!(parts[3].chars().next().unwrap(), '8' | '9' | 'a' | 'b'));
}

// ---------------------------------------------------------------------------
// apply §11 edge cases
// ---------------------------------------------------------------------------

#[test]
fn apply_happy_path() {
    let set = vec![citable("cit_1", "k1", "supported")];
    let r = apply_citations("Foo <citation ref=\"cit_1\">bar</citation> baz.", &set);
    assert_eq!(r.references.len(), 1);
    assert_eq!(r.references[0].seq, 1);
    assert!(r.prose.contains(&format!("ref=\"{}\"", set[0].uuid)));
    assert!(r.prose.contains("seq=\"1\""));
    assert!(r.prose.starts_with("Foo <citation") && r.prose.ends_with("</citation> baz."));
}

#[test]
fn apply_hallucinated_handle_stripped() {
    let set = vec![citable("cit_1", "k1", "supported")];
    let r = apply_citations("A <citation ref=\"cit_9\">claimy text</citation> B", &set);
    assert_eq!(r.references.len(), 0);
    assert_eq!(r.prose, "A claimy text B");
    assert_eq!(r.stats.refs_dropped, 1);
}

#[test]
fn apply_unclosed_tag_stripped() {
    let set = vec![citable("cit_1", "k1", "supported")];
    let r = apply_citations("X <citation ref=\"cit_1\">no close here", &set);
    assert!(!r.prose.contains("<citation"));
    assert!(r.prose.contains("no close here"));
    assert_eq!(r.references.len(), 0);
}

#[test]
fn apply_nested_inner_markup_stripped() {
    let set = vec![citable("cit_1", "k1", "supported"), citable("cit_2", "k2", "supported")];
    let r = apply_citations(
        "<citation ref=\"cit_1\">outer <citation ref=\"cit_2\">inner</citation></citation>",
        &set,
    );
    assert_eq!(r.references.len(), 1);
    assert_eq!(r.prose.matches("<citation").count(), 1);
    assert!(r.prose.contains("outer") && r.prose.contains("inner"));
}

#[test]
fn apply_no_citable_set_strips_tags() {
    let r = apply_citations("Hello <citation ref=\"cit_1\">world</citation>!", &[]);
    assert_eq!(r.prose, "Hello world!");
    assert_eq!(r.references.len(), 0);
}

#[test]
fn apply_repeated_claim_one_reference_shared_seq() {
    let set = vec![citable("cit_1", "k1", "supported")];
    let r = apply_citations(
        "First <citation ref=\"cit_1\">a</citation> then <citation ref=\"cit_1\">b</citation>.",
        &set,
    );
    assert_eq!(r.references.len(), 1);
    assert_eq!(r.prose.matches("<citation").count(), 2);
    assert_eq!(r.prose.matches("seq=\"1\"").count(), 2);
}

#[test]
fn apply_multisource_one_invalid_keeps_valid() {
    let set = vec![citable("cit_1", "k1", "supported"), citable("cit_2", "k2", "supported")];
    let r = apply_citations("<citation ref=\"cit_1 cit_99\">multi</citation>", &set);
    assert!(r.prose.contains(&format!("ref=\"{}\"", set[0].uuid)));
    assert!(!r.prose.contains("cit_99"));
    assert_eq!(r.references.len(), 1);
    assert_eq!(r.stats.refs_dropped, 1);

    let r2 = apply_citations("<citation ref=\"cit_1 cit_2\">both</citation>", &set);
    assert!(r2.prose.contains(&format!("ref=\"{} {}\"", set[0].uuid, set[1].uuid)));
    assert!(r2.prose.contains("seq=\"1 2\""));
    assert_eq!(r2.references.len(), 2);
}

#[test]
fn apply_dense_renumber_by_first_appearance() {
    let set = vec![
        citable("cit_1", "k1", "supported"),
        citable("cit_2", "k2", "supported"),
    ];
    // reference cit_2 first
    let r = apply_citations(
        "<citation ref=\"cit_2\">two</citation> <citation ref=\"cit_1\">one</citation>",
        &set,
    );
    let by_key = |k: &str| r.references.iter().find(|x| x.claim_key.as_deref() == Some(k)).unwrap().seq;
    assert_eq!(by_key("k2"), 1);
    assert_eq!(by_key("k1"), 2);
}

#[test]
fn apply_sentinel_chars_in_prose_do_not_corrupt() {
    let set = vec![citable("cit_1", "k1", "supported")];
    let prose = format!("Pre {}0{} mid <citation ref=\"cit_1\">bar</citation> end", '\u{E000}', '\u{E001}');
    let r = apply_citations(&prose, &set);
    assert!(!r.prose.contains('\u{E000}'));
    assert!(r.prose.contains(&format!("ref=\"{}\"", set[0].uuid)));
    assert_eq!(r.references.len(), 1);
    assert!(r.prose.contains("Pre") && r.prose.contains("mid") && r.prose.contains("end"));
}

// ---------------------------------------------------------------------------
// build_citable_set
// ---------------------------------------------------------------------------

#[test]
fn build_citable_set_filters_and_dedupes() {
    let verify = json!({"results": [
        {"claim_key": "k1", "claim_text": "Saturn has rings.", "verdict": "supported", "verification_status": "verified_supported",
         "sources": [{"url": "https://nasa.gov", "extracted_title": "NASA", "verification": {"quoted_excerpt": "rings exist"}}]},
        {"claim_key": "k2", "claim_text": "Maybe.", "verdict": "inconclusive", "verification_status": "verified_inconclusive", "sources": []},
        {"claim_key": "k3", "claim_text": "Myth.", "verdict": "refuted", "verification_status": "verified_refuted", "sources": []}
    ]});
    let set = build_citable_set(Some(&verify), None);
    assert_eq!(set.len(), 2, "supported + refuted only");
    assert_eq!(set[0].handle, "cit_1");
    assert_eq!(set[1].handle, "cit_2");
    assert_eq!(set[0].uuid, derive_claim_uuid("k1"));
    assert_eq!(set[0].sources[0]["supporting_span"], json!("rings exist"));
    assert_eq!(set[0].sources[0]["title"], json!("NASA"));

    // recall dedupes against fresh (fresh wins)
    let recall = json!({"results": [
        {"claim_key": "k1", "claim_text": "Recalled.", "recall": {"hit": true, "verdict": "supported", "verification_level": "verified"}}
    ]});
    let both = build_citable_set(Some(&verify), Some(&recall));
    assert_eq!(both.iter().filter(|c| c.claim_key.as_deref() == Some("k1")).count(), 1);

    assert_eq!(build_citable_set(None, None).len(), 0);
}

// ---------------------------------------------------------------------------
// quality_metrics
// ---------------------------------------------------------------------------

fn j(claim: bool, cite: bool, supp: bool) -> SentenceJudgment {
    serde_json::from_value(json!({"claim_bearing": claim, "has_citation": cite, "citation_supports": supp})).unwrap()
}

#[test]
fn quality_metrics_scores() {
    let perfect = compute_citation_quality(&[j(true, true, true), j(true, true, true), j(false, false, false)]);
    assert_eq!(perfect.citation_recall, Some(1.0));
    assert_eq!(perfect.citation_precision, Some(1.0));
    assert_eq!(perfect.citation_f1, Some(1.0));
    assert_eq!(perfect.counts.claim_bearing, 2);

    let recall_gap = compute_citation_quality(&[j(true, true, true), j(true, false, false)]);
    assert_eq!(recall_gap.citation_recall, Some(0.5));
    assert_eq!(recall_gap.citation_precision, Some(1.0));
    assert_eq!(recall_gap.counts.uncited_claims, 1);

    let prec_gap = compute_citation_quality(&[j(true, true, true), j(true, true, false)]);
    assert_eq!(prec_gap.citation_precision, Some(0.5));
    assert_eq!(prec_gap.counts.misattributed_citations, 1);

    let none = compute_citation_quality(&[j(false, false, false)]);
    assert_eq!(none.citation_recall, None);
    assert_eq!(none.citation_precision, None);
    assert_eq!(none.citation_f1, None);

    let thirds = compute_citation_quality(&[j(true, true, true), j(true, true, true), j(true, false, false)]);
    assert_eq!(thirds.citation_recall, Some(0.667));
}

// ---------------------------------------------------------------------------
// claimreview
// ---------------------------------------------------------------------------

#[test]
fn claimreview_rating_and_projection() {
    assert_eq!(verdict_to_rating(Some("supported"))["ratingValue"], json!(5));
    assert_eq!(verdict_to_rating(Some("refuted"))["alternateName"], json!("False"));
    assert_eq!(verdict_to_rating(Some("banana"))["alternateName"], json!("Unproven"));

    let citation = json!({
        "claim": {"raw_text": "Saturn has rings."},
        "verdict": "supported",
        "verification_level": "verified",
        "verified_at": "2026-04-02T08:30:00.000Z",
        "sources": [{"url": "https://nasa.gov/saturn"}, {"url": ""}],
        "citation_path": "citations/2026-04/x.json"
    });
    let cr = to_claim_review(&citation, None);
    assert_eq!(cr["@type"], json!("ClaimReview"));
    assert_eq!(cr["claimReviewed"], json!("Saturn has rings."));
    assert_eq!(cr["reviewRating"]["ratingValue"], json!(5));
    assert_eq!(cr["author"]["@type"], json!("Organization"));
    assert_eq!(cr["itemReviewed"]["appearance"].as_array().unwrap().len(), 1, "empty url filtered");
    assert_eq!(cr["datePublished"], json!("2026-04-02"));
    assert_eq!(cr["url"], json!("citations/2026-04/x.json"));

    let provisional = json!({"claim_text": "Maybe.", "verdict": "inconclusive", "verification_level": "provisional", "sources": []});
    let doc = to_claim_review_collection(&[citation.clone(), provisional.clone()], false, None);
    assert_eq!(doc["@context"], json!("https://schema.org"));
    assert_eq!(doc["@graph"].as_array().unwrap().len(), 1, "verified only by default");
    let doc2 = to_claim_review_collection(&[citation, provisional], true, None);
    assert_eq!(doc2["@graph"].as_array().unwrap().len(), 2, "include-provisional");
}
