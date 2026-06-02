//! Citation tag format — parse / sanitize / serialize / strip.
//!
//! Port of `api-impl-js/core/citations/citation-format.js`. The regex flavours
//! mirror the JS/Python ones: case-insensitive, dot-all, non-greedy inner.

use regex::Regex;
use std::sync::OnceLock;

/// Well-formed tag: `<citation ref="...">inner</citation>`.
pub fn well_formed_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?is)<citation\s+ref="([^"]*)"\s*>(.*?)</citation>"#).unwrap())
}

/// Any citation open/close markup — used to scrub leftovers.
pub fn any_citation_markup_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?i)</?citation\b[^>]*>"#).unwrap())
}

/// Split a `ref` attribute into individual handles.
pub fn parse_handles(ref_attr: &str) -> Vec<String> {
    ref_attr.split_whitespace().map(str::to_string).collect()
}

/// Remove any nested citation markup from an inner span, keeping its text.
pub fn sanitize_inner(inner: &str) -> String {
    any_citation_markup_re().replace_all(inner, "").into_owned()
}

/// Strip ALL citation markup from a string, keeping inner text.
pub fn strip_all_citation_markup(text: &str) -> String {
    any_citation_markup_re().replace_all(text, "").into_owned()
}

/// Serialize a resolved citation tag: `<citation ref="u1 u2" seq="1 2">inner</citation>`.
pub fn serialize_resolved_tag(uuids: &[String], seqs: &[u32], inner: &str) -> String {
    let seq_str = seqs
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        r#"<citation ref="{}" seq="{}">{}</citation>"#,
        uuids.join(" "),
        seq_str,
        inner
    )
}
