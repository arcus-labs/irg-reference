"""Citation tag format (Python port of api-impl-js/core/citations/citation-format.js).

Parse / sanitize / serialize / strip the inline ``<citation>`` tag. PURE — no
I/O, no state. Conformance core: the tag grammar and edge-case handling must
match the JS reference byte-for-byte.
"""

import re

# Well-formed tag: <citation ref="...">inner</citation>. Non-greedy inner,
# case-insensitive, DOTALL so spans may cross newlines. Mirrors the JS
# WELL_FORMED_RE (which uses [\s\S]*? — equivalent to . with DOTALL).
WELL_FORMED_RE = re.compile(r'<citation\s+ref="([^"]*)"\s*>(.*?)</citation>', re.IGNORECASE | re.DOTALL)

# Any citation open/close markup — used to scrub leftovers.
ANY_CITATION_MARKUP_RE = re.compile(r'</?citation\b[^>]*>', re.IGNORECASE)


def parse_handles(ref_attr):
    """Split a ``ref`` attribute into individual handles."""
    if not ref_attr or not isinstance(ref_attr, str):
        return []
    return [h for h in re.split(r'\s+', ref_attr.strip()) if h]


def sanitize_inner(inner):
    """Remove any nested citation markup from an inner span, keeping its text."""
    if not inner:
        return ""
    return ANY_CITATION_MARKUP_RE.sub("", str(inner))


def strip_all_citation_markup(text):
    """Strip ALL citation markup from a string, keeping inner text."""
    if not text:
        return ""
    return ANY_CITATION_MARKUP_RE.sub("", str(text))


def serialize_resolved_tag(uuids, seqs, inner):
    """Serialize a resolved citation tag: <citation ref="u1 u2" seq="1 2">inner</citation>."""
    return f'<citation ref="{" ".join(uuids)}" seq="{" ".join(str(s) for s in seqs)}">{inner}</citation>'
