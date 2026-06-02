'use strict';

/**
 * SS4 sidecar ClaimIndex backend — the seam for delegating semantic retrieval
 * to an external SS4 service (HRR + banded LSH "resonance" over a Rust core).
 *
 * We do NOT reimplement SS4 in JS. This backend is the integration contract:
 * it forwards a query vector to an SS4 HTTP service and returns neighbors in
 * the canonical ClaimIndex shape. It is intentionally strict — if no endpoint
 * is configured it throws rather than silently degrading, so an operator who
 * selects the SS4 backend must wire it up explicitly.
 *
 * Expected sidecar protocol (POST {endpoint}/query):
 *   request:  { vector: number[], top_k: number, threshold: number, exclude_key?: string }
 *   response: { neighbors: [ { claim_key, claim_text, domain, similarity, embedding_model } ] }
 *
 * The corpus is NOT sent per-query — the SS4 service owns its own index,
 * populated out-of-band. `corpus` here is only used for size() reporting.
 */

class Ss4SidecarIndex {
  constructor({ endpoint, corpus = [] } = {}) {
    this.backend = 'ss4';
    this.endpoint = endpoint || null;
    this._corpusSize = Array.isArray(corpus) ? corpus.length : 0;
  }

  size() {
    return this._corpusSize;
  }

  async query(queryVector, opts = {}) {
    if (!this.endpoint) {
      throw new Error('SS4 sidecar backend selected but no endpoint configured (set SS4_SIDECAR_URL).');
    }
    if (!Array.isArray(queryVector) || queryVector.length === 0) return [];

    const { topK = 3, threshold = 0, excludeKey } = opts;
    let res;
    try {
      res = await fetch(`${this.endpoint.replace(/\/$/, '')}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vector: queryVector, top_k: topK, threshold, exclude_key: excludeKey || null }),
      });
    } catch (err) {
      throw new Error(`SS4 sidecar request failed: ${err.message}`);
    }
    if (!res.ok) {
      throw new Error(`SS4 sidecar returned ${res.status}`);
    }
    const data = await res.json();
    const neighbors = Array.isArray(data?.neighbors) ? data.neighbors : [];
    return neighbors.map((n) => ({
      claim_key: n.claim_key,
      claim_text: n.claim_text,
      domain: n.domain || null,
      similarity: typeof n.similarity === 'number' ? n.similarity : 0,
      embedding_model: n.embedding_model || null,
    }));
  }
}

module.exports = { Ss4SidecarIndex };
