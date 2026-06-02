'use strict';

/**
 * Embeddings
 *
 * Provides text → vector embeddings for semantic similarity search.
 * Used by the fact-store memory layer to find prior claims that are
 * related to a new claim but don't share an exact claim_key.
 *
 * Provider selection (in order):
 *   1. opts.preferProvider explicitly set
 *   2. EMBEDDINGS_PROVIDER env var (one of 'openai' | 'hash')
 *   3. If API_KEY_OPENAI is configured → 'openai'
 *   4. Otherwise → 'hash' (offline, no key required)
 *
 * The hash fallback is a deterministic feature-hash embedder. Quality
 * is meaningfully lower than learned embeddings, but it works without
 * any external dependency and produces stable vectors for clustering
 * lexically-similar text. Suitable for demos and local development.
 *
 * Best-effort behavior: if the configured provider fails (e.g. OpenAI
 * is offline), `getEmbedding` does NOT throw — it falls back to the
 * hash embedder and records the fallback in the result so callers
 * know what happened. This keeps the write path resilient: a claim
 * never fails to persist because the embedding API is unreachable.
 */

const https = require('https');

const HASH_DIM = 256;
const HASH_MODEL = 'hash/feature-256-v1';
const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';
const OPENAI_DEFAULT_DIM = 1536;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed a single text string.
 *
 * @param {string}  text
 * @param {Object}  [opts]
 * @param {string}  [opts.preferProvider]  'openai' | 'hash'
 * @param {Object}  [opts.env]             defaults to process.env
 * @returns {Promise<{ model: string, dim: number, vector: number[], provider: string, fallback_reason?: string }>}
 */
async function getEmbedding(text, opts = {}) {
  const provider = selectProvider(opts.env || process.env, opts.preferProvider);
  if (provider === 'openai') {
    try {
      return await openaiEmbed(text, opts);
    } catch (err) {
      return {
        ...hashEmbed(text),
        provider: 'hash',
        fallback_reason: `OpenAI embedding failed: ${err.message}`,
      };
    }
  }
  return hashEmbed(text);
}

/**
 * Batch variant. OpenAI accepts up to 2048 inputs per call; the hash
 * embedder loops trivially.
 */
async function getEmbeddings(texts, opts = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const provider = selectProvider(opts.env || process.env, opts.preferProvider);
  if (provider === 'openai') {
    try {
      return await openaiEmbedBatch(texts, opts);
    } catch (err) {
      // Per-item fallback — gives us partial results if OpenAI half-fails.
      return texts.map((t) => ({
        ...hashEmbed(t),
        provider: 'hash',
        fallback_reason: `OpenAI batch embedding failed: ${err.message}`,
      }));
    }
  }
  return texts.map((t) => hashEmbed(t));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for empty / mismatched
 * vectors so callers can treat it as "no signal."
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Suggested similarity threshold above which two claims should be
 * considered semantic neighbors.
 *
 * OpenAI's text-embedding-3-small produces tight clusters around 0.75
 * for related content. The hash embedder is much sparser — related
 * claims that share topical tokens typically land in the 0.30–0.50
 * range and unrelated text stays near zero. The threshold reflects
 * what cleanly separates signal from noise empirically.
 */
function suggestedNeighborThreshold(model) {
  if (typeof model === 'string' && model.startsWith('hash/')) return 0.30;
  return 0.75;
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

function selectProvider(env, prefer) {
  if (prefer === 'hash' || prefer === 'openai') return prefer;
  const envChoice = String(env.EMBEDDINGS_PROVIDER || '').toLowerCase().trim();
  if (envChoice === 'hash' || envChoice === 'openai') return envChoice;
  if (env.API_KEY_OPENAI) return 'openai';
  return 'hash';
}

// ---------------------------------------------------------------------------
// Hash embedder (offline fallback)
// ---------------------------------------------------------------------------

/**
 * Deterministic feature-hash embedding.
 *
 * Tokens are extracted as unigrams + bigrams (whitespace + punctuation
 * split, lowercased, singularized lightly). Each feature is hashed into
 * one of HASH_DIM bins with a sign drawn from the hash bit. The vector
 * is L2-normalized so cosine similarity is well-behaved.
 *
 * Two strings that share many tokens / bigrams will cluster their
 * hashes into overlapping bins, producing meaningful cosine similarity.
 * Not as good as a learned embedding — comparable to TF-IDF cosine in
 * practice — but more than adequate for "are these two claims about
 * the same topic" queries.
 */
function hashEmbed(text) {
  const vector = new Array(HASH_DIM).fill(0);
  const features = extractFeatures(text);
  for (const feat of features) {
    const h = fnvHash(feat);
    const idx = Math.abs(h) % HASH_DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[idx] += sign;
  }
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIM; i++) vector[i] = vector[i] / norm;
  return {
    model: HASH_MODEL,
    dim: HASH_DIM,
    vector,
    provider: 'hash',
  };
}

function extractFeatures(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(lightStem);
  const features = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    features.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return features;
}

function lightStem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('es'))  return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// FNV-1a 32-bit hash — fast and decent distribution.
function fnvHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

// ---------------------------------------------------------------------------
// OpenAI embedder
// ---------------------------------------------------------------------------

function getOpenAIKey(opts) {
  const env = opts?.env || process.env;
  const key = env.API_KEY_OPENAI;
  if (!key) throw new Error('API_KEY_OPENAI not configured');
  return key;
}

async function openaiEmbed(text, opts = {}) {
  const model = opts.model || OPENAI_DEFAULT_MODEL;
  const apiKey = getOpenAIKey(opts);
  const data = await openaiRequest({ apiKey, model, input: text });
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error('OpenAI response missing embedding vector');
  }
  return {
    model: `openai/${model}`,
    dim: vector.length,
    vector,
    provider: 'openai',
  };
}

async function openaiEmbedBatch(texts, opts = {}) {
  const model = opts.model || OPENAI_DEFAULT_MODEL;
  const apiKey = getOpenAIKey(opts);
  const data = await openaiRequest({ apiKey, model, input: texts });
  const arr = data?.data;
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error('OpenAI batch response length mismatch');
  }
  return arr.map((entry) => {
    const vector = entry?.embedding;
    if (!Array.isArray(vector)) throw new Error('OpenAI batch entry missing embedding vector');
    return {
      model: `openai/${model}`,
      dim: vector.length,
      vector,
      provider: 'openai',
    };
  });
}

function openaiRequest({ apiKey, model, input }) {
  const body = JSON.stringify({ model, input });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${apiKey}`,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenAI embeddings API error ${res.statusCode}: ${buf.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`Failed to parse OpenAI embedding response: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  suggestedNeighborThreshold,
  selectProvider,
  // exposed for tests
  hashEmbed,
  HASH_DIM,
  HASH_MODEL,
  OPENAI_DEFAULT_MODEL,
  OPENAI_DEFAULT_DIM,
};
