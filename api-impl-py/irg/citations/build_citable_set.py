"""Build Citable Set (Python port of api-impl-js/core/citations/build-citable-set.js).

Assembles the list of claims the drafting model may cite from fresh
(citationVerify) and recalled (memoryRecall) results. Citability: only
``verification_level == 'verified'`` AND verdict in {supported, refuted}.
Handles assigned cit_1..cit_K; durable uuid derived from claim_key; dedupe by
claim_key (fresh wins over recalled). PURE — no I/O.
"""

from .citation_id import derive_claim_uuid

CITABLE_VERDICTS = frozenset({"supported", "refuted"})


def is_citable(verdict, level):
    return level == "verified" and verdict in CITABLE_VERDICTS


def _normalize_source(s):
    if not isinstance(s, dict):
        return None
    url = s.get("url")
    if not isinstance(url, str) or not url:
        return None
    # citationVerify stores the supporting passage on verification.quoted_excerpt;
    # accept an already-mapped supporting_span too.
    span = s.get("supporting_span")
    if span is None:
        verification = s.get("verification") or {}
        span = verification.get("quoted_excerpt")
    span_offset = s.get("span_offset")
    return {
        "url": url,
        "title": s.get("title") or s.get("extracted_title") or None,
        "supporting_span": span or None,
        "span_offset": span_offset if isinstance(span_offset, (int, float)) and not isinstance(span_offset, bool) else None,
        "excerpt": s.get("excerpt") or None,
    }


def _normalize_sources(sources):
    if not isinstance(sources, list):
        return []
    return [n for n in (_normalize_source(s) for s in sources) if n is not None]


def _make_entry(claim_key, claim_text, verdict, verification_level, verification_confidence, sources, citation_path):
    vc = verification_confidence
    entry = {
        "uuid": derive_claim_uuid(claim_key),
        "claim_key": claim_key,
        "claim_text": claim_text,
        "verdict": verdict,
        "verification_level": verification_level,
        "verification_confidence": vc if isinstance(vc, (int, float)) and not isinstance(vc, bool) else 0,
        "sources": _normalize_sources(sources),
    }
    if citation_path:
        entry["citation_path"] = citation_path
    return entry


def build_citable_set(citation_verify_result=None, memory_recall_result=None):
    """Return the citable set (list of entries with cit_N handles)."""
    entries = []
    seen = set()

    verify_results = (citation_verify_result or {}).get("results") or []
    for r in verify_results:
        verdict = r.get("verdict")
        level = r.get("verification_level")
        if not level:
            level = "verified" if str(r.get("verification_status") or "").startswith("verified") else "provisional"
        if not is_citable(verdict, level):
            continue
        if not r.get("claim_text") or r.get("claim_key") in seen:
            continue
        seen.add(r.get("claim_key"))
        entries.append(_make_entry(
            r.get("claim_key"), r.get("claim_text"), verdict, level,
            r.get("verification_confidence"), r.get("sources"), r.get("citation_path"),
        ))

    recall_results = (memory_recall_result or {}).get("results") or []
    for r in recall_results:
        rec = r.get("recall") or {}
        if not rec.get("hit") or not is_citable(rec.get("verdict"), rec.get("verification_level")):
            continue
        if not r.get("claim_text") or r.get("claim_key") in seen:
            continue
        seen.add(r.get("claim_key"))
        entries.append(_make_entry(
            r.get("claim_key"), r.get("claim_text"), rec.get("verdict"), rec.get("verification_level"),
            rec.get("verification_confidence"), rec.get("sources"), rec.get("citation_path"),
        ))

    return [dict(handle=f"cit_{i + 1}", **e) for i, e in enumerate(entries)]
