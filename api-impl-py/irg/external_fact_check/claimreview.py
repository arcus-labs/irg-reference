"""ClaimReview projection (Python port of api-impl-js/core/external-fact-check/claimreview.js).

Projects native IRG citation records into schema.org ``ClaimReview`` JSON-LD —
the lossy, interoperable "lite" view. One-way: native -> ClaimReview. PURE.
"""

REVIEW_RATING = {
    "supported": {"ratingValue": 5, "alternateName": "True"},
    "refuted": {"ratingValue": 1, "alternateName": "False"},
    "inconclusive": {"ratingValue": 3, "alternateName": "Unproven"},
}

DEFAULT_AUTHOR = {"@type": "Organization", "name": "Arcus Labs — IRG"}


def verdict_to_rating(verdict):
    """Map an IRG verdict to a schema.org Rating (1-5). Unknown -> Unproven."""
    r = REVIEW_RATING.get(verdict) or REVIEW_RATING["inconclusive"]
    return {
        "@type": "Rating",
        "ratingValue": r["ratingValue"],
        "bestRating": 5,
        "worstRating": 1,
        "alternateName": r["alternateName"],
    }


def to_claim_review(citation, author=None):
    """Project a single native citation record into a ClaimReview object."""
    citation = citation or {}
    claim = citation.get("claim") or {}
    claim_text = claim.get("raw_text") or citation.get("claim_text") or ""

    sources = citation.get("sources")
    sources = sources if isinstance(sources, list) else []
    appearance = [
        {"@type": "CreativeWork", "url": s.get("url")}
        for s in sources
        if isinstance(s, dict) and isinstance(s.get("url"), str) and s.get("url")
    ]

    date_published = citation.get("verified_at") or citation.get("created_at")

    item_reviewed = {"@type": "Claim"}
    if appearance:
        item_reviewed["appearance"] = appearance

    claim_review = {
        "@type": "ClaimReview",
        "claimReviewed": claim_text,
        "reviewRating": verdict_to_rating(citation.get("verdict")),
        "author": author or DEFAULT_AUTHOR,
        "itemReviewed": item_reviewed,
    }

    if date_published:
        claim_review["datePublished"] = str(date_published)[:10]
    if citation.get("citation_path"):
        claim_review["url"] = citation.get("citation_path")

    return claim_review


def to_claim_review_collection(citations, include_provisional=False, author=None):
    """Project a collection into a JSON-LD document with an @graph of ClaimReviews."""
    citations = citations if isinstance(citations, list) else []
    graph = [
        to_claim_review(c, author=author)
        for c in citations
        if include_provisional or (c or {}).get("verification_level") == "verified"
    ]
    return {"@context": "https://schema.org", "@graph": graph}
