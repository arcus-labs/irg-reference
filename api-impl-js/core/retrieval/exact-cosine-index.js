'use strict';

/**
 * Exact (brute-force) cosine ClaimIndex backend.
 *
 * Scores the query against every corpus vector. This is the baseline backend
 * and exactly reproduces the semantic-recall behaviour memoryRecall had before
 * the ClaimIndex abstraction — it is the correctness reference the approximate
 * backends (LSH) are measured against.
 *
 * PURE given its corpus (no I/O). The corpus is loaded by the factory.
 */

const { scoreNeighbors } = require('./scoring');

class ExactCosineIndex {
  constructor(corpus = []) {
    this.corpus = Array.isArray(corpus) ? corpus.filter((r) => Array.isArray(r.embedding_vector)) : [];
    this.backend = 'exact';
  }

  size() {
    return this.corpus.length;
  }

  /**
   * @param {number[]} queryVector
   * @param {Object} [opts] { topK, threshold, excludeKey }
   * @returns {Object[]} neighbors
   */
  query(queryVector, opts = {}) {
    return scoreNeighbors(queryVector, this.corpus, opts);
  }
}

module.exports = { ExactCosineIndex };
