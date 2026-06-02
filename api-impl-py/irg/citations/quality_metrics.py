"""Citation quality metrics (Python port of api-impl-js/core/citations/quality-metrics.js).

ALCE-style citation recall + precision over per-sentence judgments. Denominators
can be zero (no claim-bearing sentences / no citations); the corresponding score
is ``None`` (not 0, not 1) so a response with nothing to cite doesn't distort
aggregate accuracy numbers. PURE.
"""


def _round3(n):
    if n is None:
        return None
    # Match JS Number(n.toFixed(3)): format to 3 decimals then back to float.
    return float(f"{n:.3f}")


def compute_citation_quality(judgments):
    """Compute recall/precision/f1 + counts from per-sentence judgments.

    Each judgment: {claim_bearing, has_citation, citation_supports, cited_seqs?}.
    """
    sentences = judgments if isinstance(judgments, list) else []

    claim_bearing = 0
    claim_bearing_supported = 0
    cited_sentences = 0
    cited_supported = 0
    uncited_claims = 0
    misattributed = 0

    for s in sentences:
        is_claim = bool(s.get("claim_bearing"))
        has_cite = bool(s.get("has_citation"))
        supports = bool(s.get("citation_supports"))

        if is_claim:
            claim_bearing += 1
            if has_cite and supports:
                claim_bearing_supported += 1
            if not has_cite:
                uncited_claims += 1
        if has_cite:
            cited_sentences += 1
            if supports:
                cited_supported += 1
            else:
                misattributed += 1

    citation_recall = (claim_bearing_supported / claim_bearing) if claim_bearing > 0 else None
    citation_precision = (cited_supported / cited_sentences) if cited_sentences > 0 else None
    if citation_recall is not None and citation_precision is not None and (citation_recall + citation_precision) > 0:
        f1 = (2 * citation_recall * citation_precision) / (citation_recall + citation_precision)
    else:
        f1 = None

    return {
        "citation_recall": _round3(citation_recall),
        "citation_precision": _round3(citation_precision),
        "citation_f1": _round3(f1),
        "counts": {
            "sentences": len(sentences),
            "claim_bearing": claim_bearing,
            "claim_bearing_supported": claim_bearing_supported,
            "cited_sentences": cited_sentences,
            "cited_supported": cited_supported,
            "uncited_claims": uncited_claims,
            "misattributed_citations": misattributed,
        },
    }
