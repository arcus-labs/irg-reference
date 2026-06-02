//! Shared types for the citation core.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A claim the drafting model is allowed to cite. Deserialized straight from
/// the conformance fixtures' `citable_set` entries. Opaque pass-through fields
/// (`sources`, `verification_confidence`) are kept as-is so a Reference can
/// reproduce them byte-for-byte.
#[derive(Debug, Clone, Deserialize)]
pub struct CitableClaim {
    pub handle: String,
    pub uuid: String,
    #[serde(default)]
    pub claim_key: Option<String>,
    #[serde(default)]
    pub claim_text: Option<String>,
    #[serde(default)]
    pub verdict: Option<String>,
    #[serde(default)]
    pub verification_level: Option<String>,
    #[serde(default)]
    pub verification_confidence: Option<Value>,
    #[serde(default)]
    pub sources: Vec<Value>,
    #[serde(default)]
    pub citation_path: Option<String>,
}

/// A resolved citation in the response's `references[]`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Reference {
    pub uuid: String,
    pub seq: u32,
    pub claim_key: Option<String>,
    pub claim_text: Option<String>,
    pub verdict: Option<String>,
    pub verification_level: Option<String>,
    pub verification_confidence: Value,
    pub sources: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citation_path: Option<String>,
}
