'use strict';

/**
 * JS-LSH ClaimIndex backend — banded random-hyperplane (SimHash) LSH for
 * cosine similarity.
 *
 * This is the "good enough" approximate retrieval backend: instead of scoring
 * the query against every stored claim (exact backend), it hashes each vector
 * into buckets such that vectors pointing in similar directions tend to share
 * a bucket. A query only reranks the candidates that collide with it in at
 * least one band — sub-linear in the common case, at the cost of occasionally
 * missing a true neighbor (approximate recall).
 *
 * It is the same family of technique (banded LSH "resonance") that SS4 uses
 * over HRR vectors; this JS version is the accessible default and the seam an
 * SS4 sidecar would slot behind (see ss4-sidecar-index.js).
 *
 * Design notes:
 *   - Random hyperplanes are drawn from a SEEDED PRNG, so the index is
 *     deterministic and reproducible (same corpus + seed → same buckets).
 *   - The final rerank uses exact cosine (shared scoring.js), so any neighbor
 *     LSH *does* surface is scored identically to the exact backend. LSH only
 *     affects which candidates get scored — i.e. recall/speed, not precision.
 *   - One signature dimension is fixed at build time (the dominant vector
 *     length). Vectors of other dimensions are skipped (a store normally has a
 *     single embedding model → single dimension).
 *
 * PURE given its corpus (no I/O).
 */

const { scoreNeighbors } = require('./scoring');

// Deterministic PRNG (mulberry32) + standard-normal sampler (Box–Muller).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

class LshIndex {
  constructor(corpus = [], opts = {}) {
    this.backend = 'lsh';
    this.numBands = Math.max(1, opts.numBands || 12);
    this.hyperplanesPerBand = Math.max(1, opts.hyperplanesPerBand || 8);
    // Fixed default seed → deterministic, reproducible hyperplanes/buckets.
    this.seed = Number.isFinite(opts.seed) ? opts.seed : 1337;

    const rows = (Array.isArray(corpus) ? corpus : []).filter((r) => Array.isArray(r.embedding_vector));
    // Dominant dimension = the most common vector length in the corpus.
    this.dim = dominantDim(rows);
    this.corpus = rows.filter((r) => r.embedding_vector.length === this.dim);

    this.hyperplanes = this._buildHyperplanes();   // numBands × hyperplanesPerBand × dim
    this.bands = this.hyperplanes.map(() => new Map()); // per-band: signature → rows[]

    for (const row of this.corpus) {
      const sigs = this._signatures(row.embedding_vector);
      for (let b = 0; b < this.numBands; b++) {
        const bucket = this.bands[b];
        const key = sigs[b];
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(row);
      }
    }
  }

  size() {
    return this.corpus.length;
  }

  _buildHyperplanes() {
    if (!this.dim) return [];
    const rng = mulberry32(this.seed);
    const bands = [];
    for (let b = 0; b < this.numBands; b++) {
      const planes = [];
      for (let h = 0; h < this.hyperplanesPerBand; h++) {
        const plane = new Array(this.dim);
        for (let d = 0; d < this.dim; d++) plane[d] = gaussian(rng);
        planes.push(plane);
      }
      bands.push(planes);
    }
    return bands;
  }

  _signatures(vector) {
    const sigs = new Array(this.numBands);
    for (let b = 0; b < this.numBands; b++) {
      const planes = this.hyperplanes[b];
      let bits = '';
      for (let h = 0; h < planes.length; h++) {
        bits += dot(vector, planes[h]) >= 0 ? '1' : '0';
      }
      sigs[b] = bits;
    }
    return sigs;
  }

  /**
   * Gather candidate rows colliding with the query in any band, then exact-
   * rerank. Falls back to scoring nothing when the query dimension doesn't
   * match the index dimension.
   */
  query(queryVector, opts = {}) {
    if (!Array.isArray(queryVector) || queryVector.length !== this.dim || this.dim === 0) {
      return [];
    }
    const sigs = this._signatures(queryVector);
    const candidates = new Map(); // claim_key → row (dedupe across bands)
    for (let b = 0; b < this.numBands; b++) {
      const bucket = this.bands[b].get(sigs[b]);
      if (!bucket) continue;
      for (const row of bucket) {
        if (!candidates.has(row.claim_key)) candidates.set(row.claim_key, row);
      }
    }
    return scoreNeighbors(queryVector, [...candidates.values()], opts);
  }
}

function dominantDim(rows) {
  const counts = new Map();
  for (const r of rows) {
    const d = r.embedding_vector.length;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [d, n] of counts) {
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

module.exports = { LshIndex };
