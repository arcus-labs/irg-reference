//! IRG citation conformance core — Rust port.
//!
//! A from-scratch Rust implementation of the deterministic, I/O-free citation
//! modules from the JS reference (`api-impl-js/core/citations`). It targets the
//! shared, language-neutral conformance corpus at `conformance/fixtures/`, so
//! the same golden cases that pin the JS and Python ports also pin this one.
//!
//! Scope is intentionally the PURE core: tag parsing/validation, durable UUID
//! derivation, citable-set assembly, quality metrics, and the ClaimReview
//! projection. The graph executor, LLM layer, and fact-store (the
//! non-deterministic / I/O parts) are out of scope for the conformance core.

pub mod citations;
pub mod external_fact_check;

pub use citations::apply::{apply_citations, ApplyResult, Stats};
pub use citations::build_citable_set::build_citable_set;
pub use citations::citation_id::{derive_claim_uuid, IRG_CLAIM_NAMESPACE};
pub use citations::quality_metrics::{compute_citation_quality, QualityResult};
pub use citations::types::{CitableClaim, Reference};
