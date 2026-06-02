'use strict';

/**
 * Shared neighbor scoring for ClaimIndex backends.
 *
 * Given a query vector and a set of corpus rows, compute cosine similarity,
 * drop the query's own claim, filter by threshold, and return the top-K as
 * the canonical neighbor record shape. Both the exact and LSH backends use
 * this for the final rerank — LSH only changes WHICH rows are scored, never
 * how they're scored, so its results are exact-quality on the candidates it
 * surfaces.
 */

const { cosineSimilarity } = require('../llm/embeddings');

/**
 * @param {number[]} queryVector
 * @param {Object[]} rows  corpus rows: { claim_key, claim_text, domain, embedding_model, embedding_vector }
 * @param {Object}   [opts]
 * @param {number}   [opts.topK=3]
 * @param {number}   [opts.threshold=0]   minimum cosine similarity (inclusive)
 * @param {string}   [opts.excludeKey]    claim_key to skip (the query's own claim)
 * @returns {Object[]} sorted neighbors: { claim_key, claim_text, domain, similarity, embedding_model }
 */
function scoreNeighbors(queryVector, rows, opts = {}) {
  const { topK = 3, threshold = 0, excludeKey } = opts;
  if (!Array.isArray(queryVector) || queryVector.length === 0) return [];

  const scored = [];
  for (const row of rows) {
    if (!row) continue;
    if (excludeKey && row.claim_key === excludeKey) continue;
    const vec = Array.isArray(row.embedding_vector) ? row.embedding_vector : null;
    if (!vec || vec.length !== queryVector.length) continue;
    const sim = cosineSimilarity(queryVector, vec);
    if (sim >= threshold) {
      scored.push({
        claim_key: row.claim_key,
        claim_text: row.claim_text,
        domain: row.domain || null,
        similarity: Number(sim.toFixed(3)),
        embedding_model: row.embedding_model || null,
      });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

module.exports = { scoreNeighbors };
