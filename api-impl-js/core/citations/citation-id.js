'use strict';

/**
 * Citation Identifiers
 *
 * The durable citation handle is the claim's `uuid` (Citation_Application.md §2).
 *
 * Implementation choice: rather than mint a random UUID v4 and plumb a
 * read-back through every persistence/recall path, we DERIVE the uuid
 * deterministically from the claim_key as a RFC-4122 v5 (namespace + name)
 * UUID. This satisfies the spec's intent more strongly than v4:
 *
 *   - "minted once … durable across sessions" — the same claim_key always
 *     maps to the same uuid, even across store wipes or polyglot ports.
 *   - "citing the same claim across responses yields the same uuid" — falls
 *     out for free, no lookup required.
 *   - conformance: the projection is a PURE deterministic function, so the
 *     golden fixtures diff byte-for-byte across JS / Python / Rust.
 *
 * claim_key is the SHA-256 of the canonical DSL, so it is itself stable and
 * collision-resistant; v5-over-claim_key inherits those properties.
 *
 * This module is part of the cross-language conformance corpus.
 */

const crypto = require('crypto');

// Fixed namespace UUID for IRG claims. Arbitrary but constant — every port
// MUST use this exact namespace so derived uuids match.
const IRG_CLAIM_NAMESPACE = 'b1f7c0de-1c1a-5e2d-9a3b-1c1a0000c1a1';
const NAMESPACE_BYTES = Buffer.from(IRG_CLAIM_NAMESPACE.replace(/-/g, ''), 'hex');

/**
 * Derive a deterministic UUID v5 from a claim_key.
 * @param {string} claimKey  SHA-256 hex of the canonical claim DSL
 * @returns {string} canonical 8-4-4-4-12 UUID, or '' if no claim_key
 */
function deriveClaimUuid(claimKey) {
  if (!claimKey || typeof claimKey !== 'string') return '';
  const hash = crypto.createHash('sha1')
    .update(NAMESPACE_BYTES)
    .update(Buffer.from(claimKey, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

module.exports = {
  deriveClaimUuid,
  IRG_CLAIM_NAMESPACE,
};
