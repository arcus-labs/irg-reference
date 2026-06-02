//! Cross-language conformance: the Rust port must reproduce the shared,
//! language-neutral golden corpus at `conformance/fixtures/` exactly — the
//! same fixtures that pin the JS and Python ports.

use std::fs;
use std::path::PathBuf;

use irg::citations::apply::references_to_value;
use irg::{apply_citations, derive_claim_uuid, CitableClaim, IRG_CLAIM_NAMESPACE};
use serde_json::Value;

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
}

#[test]
fn citation_id_fixture() {
    let path = corpus_dir().join("citation-id").join("cases.json");
    let doc: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

    assert_eq!(
        doc["namespace"].as_str().unwrap(),
        IRG_CLAIM_NAMESPACE,
        "namespace must match the shared fixture"
    );

    let cases = doc["cases"].as_array().unwrap();
    assert!(!cases.is_empty(), "expected citation-id cases");
    for c in cases {
        let key = c["claim_key"].as_str().unwrap();
        let expected = c["uuid"].as_str().unwrap();
        assert_eq!(
            derive_claim_uuid(key),
            expected,
            "derived uuid mismatch for claim_key {:?}",
            key
        );
    }
}

#[test]
fn citation_apply_golden_fixtures() {
    let dir = corpus_dir().join("citation-apply");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "expected citation-apply fixtures");

    for path in files {
        let fixture: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let name = fixture["name"].as_str().unwrap_or("");
        let draft = fixture["draft_with_tags"].as_str().unwrap_or("");
        let citable: Vec<CitableClaim> =
            serde_json::from_value(fixture["citable_set"].clone()).unwrap();

        let result = apply_citations(draft, &citable);
        let expected = &fixture["expected"];

        assert_eq!(
            result.prose,
            expected["validated_prose"].as_str().unwrap(),
            "[{:?}] {} — validated_prose mismatch",
            path.file_name().unwrap(),
            name
        );
        assert_eq!(
            references_to_value(&result.references),
            expected["references"],
            "[{:?}] {} — references mismatch",
            path.file_name().unwrap(),
            name
        );
        assert_eq!(
            serde_json::to_value(&result.stats).unwrap(),
            expected["stats"],
            "[{:?}] {} — stats mismatch",
            path.file_name().unwrap(),
            name
        );
    }
}
