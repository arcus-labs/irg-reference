//! Citation quality metrics (ALCE-style recall / precision / f1).
//!
//! Port of `api-impl-js/core/citations/quality-metrics.js`. PURE — given the
//! per-sentence judgments (the non-deterministic LLM step happens elsewhere),
//! the metric math is deterministic. Denominators can be zero, in which case
//! the corresponding score is `null` (not 0 and not 1).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SentenceJudgment {
    #[serde(default)]
    pub claim_bearing: bool,
    #[serde(default)]
    pub has_citation: bool,
    #[serde(default)]
    pub citation_supports: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Counts {
    pub sentences: usize,
    pub claim_bearing: usize,
    pub claim_bearing_supported: usize,
    pub cited_sentences: usize,
    pub cited_supported: usize,
    pub uncited_claims: usize,
    pub misattributed_citations: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QualityResult {
    pub citation_recall: Option<f64>,
    pub citation_precision: Option<f64>,
    pub citation_f1: Option<f64>,
    pub counts: Counts,
}

fn round3(n: Option<f64>) -> Option<f64> {
    n.map(|x| format!("{:.3}", x).parse::<f64>().unwrap())
}

pub fn compute_citation_quality(judgments: &[SentenceJudgment]) -> QualityResult {
    let mut claim_bearing = 0usize;
    let mut claim_bearing_supported = 0usize;
    let mut cited_sentences = 0usize;
    let mut cited_supported = 0usize;
    let mut uncited_claims = 0usize;
    let mut misattributed = 0usize;

    for s in judgments {
        if s.claim_bearing {
            claim_bearing += 1;
            if s.has_citation && s.citation_supports {
                claim_bearing_supported += 1;
            }
            if !s.has_citation {
                uncited_claims += 1;
            }
        }
        if s.has_citation {
            cited_sentences += 1;
            if s.citation_supports {
                cited_supported += 1;
            } else {
                misattributed += 1;
            }
        }
    }

    let citation_recall = if claim_bearing > 0 {
        Some(claim_bearing_supported as f64 / claim_bearing as f64)
    } else {
        None
    };
    let citation_precision = if cited_sentences > 0 {
        Some(cited_supported as f64 / cited_sentences as f64)
    } else {
        None
    };
    let f1 = match (citation_recall, citation_precision) {
        (Some(r), Some(p)) if (r + p) > 0.0 => Some((2.0 * r * p) / (r + p)),
        _ => None,
    };

    QualityResult {
        citation_recall: round3(citation_recall),
        citation_precision: round3(citation_precision),
        citation_f1: round3(f1),
        counts: Counts {
            sentences: judgments.len(),
            claim_bearing,
            claim_bearing_supported,
            cited_sentences,
            cited_supported,
            uncited_claims,
            misattributed_citations: misattributed,
        },
    }
}
