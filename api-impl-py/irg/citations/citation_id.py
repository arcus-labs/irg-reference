"""Citation identifiers (Python port of api-impl-js/core/citations/citation-id.js).

The durable citation handle is the claim's ``uuid`` — derived deterministically
from the ``claim_key`` as an RFC-4122 v5 (namespace + name) UUID. Deriving it
(rather than minting a random v4) makes it stable across sessions, store
rebuilds, and polyglot ports, and keeps the projection a pure, conformance-
testable function.

This is part of the cross-language conformance corpus: ``derive_claim_uuid``
MUST produce the same UUID as the JS reference for the same ``claim_key``
(verified against conformance/fixtures/citation-id/cases.json).
"""

import uuid

# Fixed namespace UUID for IRG claims. Every port MUST use this exact value.
IRG_CLAIM_NAMESPACE = "b1f7c0de-1c1a-5e2d-9a3b-1c1a0000c1a1"
_NAMESPACE = uuid.UUID(IRG_CLAIM_NAMESPACE)


def derive_claim_uuid(claim_key: str) -> str:
    """Derive a deterministic UUID v5 from a claim_key.

    Returns the canonical 8-4-4-4-12 string, or "" if no claim_key.
    ``uuid.uuid5`` computes SHA-1 over ``namespace.bytes + name`` and stamps the
    version/variant bits exactly as RFC 4122 v5 specifies — identical to the JS
    implementation.
    """
    if not claim_key or not isinstance(claim_key, str):
        return ""
    return str(uuid.uuid5(_NAMESPACE, claim_key))
