'use strict';

/**
 * ClaimIndex — pluggable semantic retrieval for the fact-store memory layer.
 *
 * The fact-store does two kinds of lookup:
 *   1. EXACT, by claim_key (a SHA-256) — trivial, stays in DuckDB/filesystem.
 *   2. SEMANTIC, "claims pointing in a similar direction to this one" — this is
 *      the part that benefits from a real index and that varies by backend.
 *
 * ClaimIndex abstracts (2) so memoryRecall doesn't care HOW neighbors are
 * found. Backends:
 *   - 'exact' (default): brute-force cosine over every stored embedding. The
 *     correctness reference; no extra dependencies.
 *   - 'lsh': banded random-hyperplane LSH — sub-linear, approximate, pure JS.
 *   - 'ss4': delegate to an external SS4 sidecar service (HRR + resonance).
 *
 * Select via opts.backend or the CLAIM_INDEX_BACKEND env var (default 'exact').
 * Every backend exposes the same contract:
 *     index.size() -> number
 *     index.query(vector, { topK, threshold, excludeKey }) -> neighbor[]   (may be async)
 *     neighbor = { claim_key, claim_text, domain, similarity, embedding_model }
 *
 * The factory loads the corpus once (from the DuckDB-backed claim embeddings)
 * and hands it to the backend. Callers reuse one index across many queries.
 */

const { ExactCosineIndex } = require('./exact-cosine-index');
const { LshIndex } = require('./lsh-index');
const { Ss4SidecarIndex } = require('./ss4-sidecar-index');

const DEFAULT_BACKEND = 'exact';

function resolveBackend(opts = {}) {
  return opts.backend || process.env.CLAIM_INDEX_BACKEND || DEFAULT_BACKEND;
}

/**
 * Load the claim-embedding corpus from the fact-store. Best-effort: returns []
 * if the DuckDB layer is unavailable or the store is empty.
 */
async function loadCorpus(opts = {}) {
  const db = require('../external-fact-check/db');
  try {
    return await db.listClaimEmbeddings({ domain: opts.domain });
  } catch (err) {
    console.warn('[claim-index] failed to load embedding corpus:', err.message);
    return [];
  }
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.backend]   'exact' | 'lsh' | 'ss4'
 * @param {Object[]} [opts.corpus]  pre-loaded corpus (skips the DuckDB load)
 * @param {string} [opts.endpoint]  SS4 sidecar URL (ss4 backend)
 * @param {number} [opts.numBands] / [opts.hyperplanesPerBand] / [opts.seed]  (lsh tuning)
 * @returns {Promise<Object>} a ClaimIndex
 */
async function createClaimIndex(opts = {}) {
  const backend = resolveBackend(opts);

  // SS4 owns its own index — it does not need the local corpus.
  if (backend === 'ss4') {
    return new Ss4SidecarIndex({
      endpoint: opts.endpoint || process.env.SS4_SIDECAR_URL,
      corpus: opts.corpus || [],
    });
  }

  const corpus = opts.corpus || await loadCorpus(opts);

  switch (backend) {
    case 'exact':
      return new ExactCosineIndex(corpus);
    case 'lsh':
      return new LshIndex(corpus, opts);
    default:
      throw new Error(`Unknown CLAIM_INDEX_BACKEND: "${backend}" (expected: exact, lsh, ss4)`);
  }
}

module.exports = {
  createClaimIndex,
  loadCorpus,
  resolveBackend,
  DEFAULT_BACKEND,
  // re-export backends for direct/testing use
  ExactCosineIndex,
  LshIndex,
  Ss4SidecarIndex,
};
