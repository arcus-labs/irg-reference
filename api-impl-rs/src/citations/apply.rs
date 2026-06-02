//! citationApply — deterministic validation pass.
//!
//! Port of `api-impl-js/core/citations/apply.js` (and the Python port). Given
//! draft prose with provisional `<citation ref="cit_N">` tags and the citable
//! set, this validates handles, resolves them to durable uuids, renumbers used
//! citations densely by first appearance, rewrites the tags, scrubs malformed
//! markup, and builds `references[]`. PURE — the function the golden fixtures
//! target; output must match the JS reference.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};

use super::citation_format::{
    parse_handles, sanitize_inner, serialize_resolved_tag, strip_all_citation_markup,
    well_formed_re,
};
use super::types::{CitableClaim, Reference};

// Private-use sentinels wrap protected fragments after pass 1 — same code
// points as the JS/Python ports (U+E000 / U+E001).
const SENTINEL_OPEN: char = '\u{E000}';
const SENTINEL_CLOSE: char = '\u{E001}';

fn restore_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new("\u{E000}(\\d+)\u{E001}").unwrap())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Stats {
    pub tags_found: usize,
    pub tags_validated: usize,
    pub refs_dropped: usize,
    pub references_built: usize,
}

pub struct ApplyResult {
    pub prose: String,
    pub references: Vec<Reference>,
    pub stats: Stats,
}

pub fn apply_citations(prose: &str, citable_set: &[CitableClaim]) -> ApplyResult {
    // Strip pre-existing sentinel chars so prose containing U+E000/U+E001 can't
    // collide with the protect/restore pass.
    let text: String = prose
        .chars()
        .filter(|c| *c != SENTINEL_OPEN && *c != SENTINEL_CLOSE)
        .collect();

    if citable_set.is_empty() {
        return ApplyResult {
            prose: strip_all_citation_markup(&text),
            references: Vec::new(),
            stats: Stats {
                tags_found: 0,
                tags_validated: 0,
                refs_dropped: 0,
                references_built: 0,
            },
        };
    }

    let by_handle: HashMap<&str, &CitableClaim> =
        citable_set.iter().map(|c| (c.handle.as_str(), c)).collect();

    let mut seq_by_uuid: HashMap<String, u32> = HashMap::new();
    let mut used_uuids: Vec<String> = Vec::new();
    let mut protected: Vec<String> = Vec::new();
    let mut tags_found = 0usize;
    let mut tags_validated = 0usize;
    let mut refs_dropped = 0usize;
    let mut next_seq = 1u32;

    // --- Pass 1: replace well-formed tags with protected sentinels ---
    let after_pass1 = well_formed_re()
        .replace_all(&text, |caps: &regex::Captures| {
            tags_found += 1;
            let ref_attr = caps.get(1).map_or("", |m| m.as_str());
            let inner = caps.get(2).map_or("", |m| m.as_str());
            let clean_inner = sanitize_inner(inner);

            let mut uuids: Vec<String> = Vec::new();
            let mut seqs: Vec<u32> = Vec::new();
            let mut seen_in_tag: HashSet<String> = HashSet::new();

            for h in parse_handles(ref_attr) {
                match by_handle.get(h.as_str()) {
                    None => {
                        refs_dropped += 1;
                    }
                    Some(entry) => {
                        let uid = entry.uuid.clone();
                        if seen_in_tag.contains(&uid) {
                            continue;
                        }
                        seen_in_tag.insert(uid.clone());
                        let seq = match seq_by_uuid.get(&uid) {
                            Some(s) => *s,
                            None => {
                                let s = next_seq;
                                next_seq += 1;
                                seq_by_uuid.insert(uid.clone(), s);
                                used_uuids.push(uid.clone());
                                s
                            }
                        };
                        uuids.push(uid);
                        seqs.push(seq);
                    }
                }
            }

            if uuids.is_empty() {
                // Every handle invalid -> strip markup, keep inner text.
                return clean_inner;
            }

            tags_validated += 1;
            let idx = protected.len();
            protected.push(serialize_resolved_tag(&uuids, &seqs, &clean_inner));
            format!("{}{}{}", SENTINEL_OPEN, idx, SENTINEL_CLOSE)
        })
        .into_owned();

    // --- Pass 2: scrub leftover (malformed/unclosed/nested) markup ---
    let scrubbed = strip_all_citation_markup(&after_pass1);

    // --- Pass 3: restore protected resolved tags ---
    let final_prose = restore_re()
        .replace_all(&scrubbed, |caps: &regex::Captures| {
            let idx: usize = caps[1].parse().unwrap_or(usize::MAX);
            protected.get(idx).cloned().unwrap_or_default()
        })
        .into_owned();

    // --- Build references[] in seq order (only cited claims) ---
    let by_uuid: HashMap<&str, &CitableClaim> =
        citable_set.iter().map(|c| (c.uuid.as_str(), c)).collect();
    let mut references: Vec<Reference> = Vec::new();
    for uid in &used_uuids {
        let c = by_uuid.get(uid.as_str());
        let vc = c
            .and_then(|c| c.verification_confidence.clone())
            .unwrap_or_else(|| json!(0));
        references.push(Reference {
            uuid: uid.clone(),
            seq: *seq_by_uuid.get(uid).unwrap_or(&0),
            claim_key: c.and_then(|c| c.claim_key.clone()),
            claim_text: c.and_then(|c| c.claim_text.clone()),
            verdict: c.and_then(|c| c.verdict.clone()),
            verification_level: c.and_then(|c| c.verification_level.clone()),
            verification_confidence: vc,
            sources: c.map(|c| c.sources.clone()).unwrap_or_default(),
            citation_path: c.and_then(|c| {
                c.citation_path
                    .as_ref()
                    .filter(|p| !p.is_empty())
                    .cloned()
            }),
        });
    }

    let references_built = references.len();
    ApplyResult {
        prose: final_prose,
        references,
        stats: Stats {
            tags_found,
            tags_validated,
            refs_dropped,
            references_built,
        },
    }
}

/// Serialize an ApplyResult's references to a serde_json array (for conformance
/// comparison against the shared corpus).
pub fn references_to_value(refs: &[Reference]) -> Value {
    Value::Array(refs.iter().map(|r| serde_json::to_value(r).unwrap()).collect())
}
