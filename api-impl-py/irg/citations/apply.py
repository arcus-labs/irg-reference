"""citationApply — deterministic validation pass.

Python port of api-impl-js/core/citations/apply.js. Given draft prose with
provisional ``<citation ref="cit_N">`` tags and the citable set, this:

  1. parses each well-formed tag
  2. drops any handle not in the citable set (hallucination guard)
  3. resolves surviving handles -> claim uuid
  4. renumbers used citations densely by first appearance (seq 1..K)
  5. rewrites tags with ref(uuid) + seq(int)
  6. strips malformed / unclosed / nested markup, keeping inner text
  7. builds references[] (only cited claims appear)

PURE — no I/O. This is the function the golden conformance fixtures target;
output must match the JS reference exactly.
"""

import re

from .citation_format import (
    WELL_FORMED_RE,
    parse_handles,
    sanitize_inner,
    strip_all_citation_markup,
    serialize_resolved_tag,
)

# Private-use sentinels wrap protected fragments after pass 1. They carry no
# citation markup (so pass-2 scrubbing leaves them intact) and add no
# surrounding whitespace (so prose spacing is preserved exactly). Same code
# points as the JS reference (U+E000 / U+E001).
_SENTINEL_OPEN = ""
_SENTINEL_CLOSE = ""
_RESTORE_RE = re.compile(_SENTINEL_OPEN + r"(\d+)" + _SENTINEL_CLOSE)


def apply_citations(prose, citable_set):
    """Apply citation validation/resolution.

    :param prose: draft text with provisional citation tags
    :param citable_set: list of dicts ({handle, uuid, claim_key, claim_text,
        verdict, verification_level, verification_confidence, sources,
        citation_path})
    :returns: dict with keys ``prose``, ``references``, ``stats``
    """
    # Strip pre-existing sentinel chars so prose containing U+E000/U+E001 cannot
    # collide with the protect/restore pass.
    text = prose if isinstance(prose, str) else ""
    text = text.replace(_SENTINEL_OPEN, "").replace(_SENTINEL_CLOSE, "")
    cset = citable_set if isinstance(citable_set, list) else []

    if not cset:
        # No citable set -> strip every citation tag, keep inner text.
        return {
            "prose": strip_all_citation_markup(text),
            "references": [],
            "stats": {"tags_found": 0, "tags_validated": 0, "refs_dropped": 0, "references_built": 0},
        }

    by_handle = {c.get("handle"): c for c in cset}
    seq_by_uuid = {}
    used_uuids = []

    counters = {"tags_found": 0, "tags_validated": 0, "refs_dropped": 0, "next_seq": 1}
    protected = []

    def replace_tag(match):
        ref_attr, inner = match.group(1), match.group(2)
        counters["tags_found"] += 1
        clean_inner = sanitize_inner(inner)
        handles = parse_handles(ref_attr)

        uuids = []
        seqs = []
        seen_in_tag = set()
        for h in handles:
            entry = by_handle.get(h)
            if entry is None:
                counters["refs_dropped"] += 1
                continue
            uid = entry.get("uuid")
            if uid in seen_in_tag:
                continue
            seen_in_tag.add(uid)
            seq = seq_by_uuid.get(uid)
            if seq is None:
                seq = counters["next_seq"]
                counters["next_seq"] += 1
                seq_by_uuid[uid] = seq
                used_uuids.append(uid)
            uuids.append(uid)
            seqs.append(seq)

        if not uuids:
            # Every handle invalid -> strip markup, keep inner text.
            return clean_inner

        counters["tags_validated"] += 1
        idx = len(protected)
        protected.append(serialize_resolved_tag(uuids, seqs, clean_inner))
        return f"{_SENTINEL_OPEN}{idx}{_SENTINEL_CLOSE}"

    after_pass1 = WELL_FORMED_RE.sub(replace_tag, text)
    scrubbed = strip_all_citation_markup(after_pass1)

    def restore(match):
        idx = int(match.group(1))
        return protected[idx] if 0 <= idx < len(protected) else ""

    final_prose = _RESTORE_RE.sub(restore, scrubbed)

    by_uuid = {c.get("uuid"): c for c in cset}
    references = []
    for uid in used_uuids:
        c = by_uuid.get(uid, {})
        vc = c.get("verification_confidence")
        ref = {
            "uuid": uid,
            "seq": seq_by_uuid.get(uid),
            "claim_key": c.get("claim_key"),
            "claim_text": c.get("claim_text"),
            "verdict": c.get("verdict"),
            "verification_level": c.get("verification_level"),
            "verification_confidence": 0 if vc is None else vc,
            "sources": c.get("sources") if isinstance(c.get("sources"), list) else [],
        }
        if c.get("citation_path"):
            ref["citation_path"] = c.get("citation_path")
        references.append(ref)

    return {
        "prose": final_prose,
        "references": references,
        "stats": {
            "tags_found": counters["tags_found"],
            "tags_validated": counters["tags_validated"],
            "refs_dropped": counters["refs_dropped"],
            "references_built": len(references),
        },
    }
