'use strict';

/**
 * Embedding-Based Domain Classifier
 *
 * Replacement for the hand-tuned keyword scoring in `claim-parser.js`'s
 * `analyzeDomain`. Each domain has a multi-sentence prototype that
 * describes its territory. At classification time we embed the query
 * claim and pick the domain whose prototype is closest in cosine space.
 *
 * Why coexist with the legacy classifier?
 *   - `claim_parser.js`'s `analyzeDomain` is sync and its output feeds
 *     into the `claim_key` hash. Changing it would invalidate every
 *     existing claim_key in deployed fact-stores.
 *   - This classifier is async (it does an embedding call) and is
 *     intended as the *new* canonical signal — surfaced as
 *     `inferred_domain` alongside the legacy `domain`.
 *
 * Performance:
 *   - Prototypes are embedded ONCE per process per provider and cached.
 *   - Per-claim classification cost = 1 embedding call + 8 cosine
 *     similarity comparisons on small (256–1536) vectors.
 *
 * Behavior is best-effort: if embedding generation fails, returns
 * `{ domain: 'other', confidence: 0, model: null, source: 'fallback' }`
 * rather than throwing. The hand-tuned classifier remains the safety
 * net for callers that need a synchronous answer.
 */

const { getEmbedding, cosineSimilarity, suggestedNeighborThreshold } = require('../llm/embeddings');
const { analyzeDomain: handTunedAnalyzeDomain } = require('./claim-parser');

// ---------------------------------------------------------------------------
// Prototypes — one descriptive paragraph per domain.
//
// Keep these stable. Changing a prototype shifts every classification
// result that's borderline against it. If you need a new domain,
// ADD it; don't restructure existing entries casually.
// ---------------------------------------------------------------------------
const DOMAIN_PROTOTYPES = {
  science:    'Scientific research and natural phenomena: physics, chemistry, biology, astronomy. Planets, stars, atoms, evolution, ecosystems, climate, peer-reviewed studies, the scientific method.',
  health:     'Medicine and biomedical topics: diseases, treatments, drugs, antibiotics, vaccines, clinical trials, patient care, doctors and physicians, symptoms, diagnoses, public health.',
  finance:    'Economics and financial markets: stocks, interest rates, inflation, GDP, monetary policy, central banks, investments, corporate earnings, bond yields, currencies.',
  law:        'Legal systems and jurisprudence: court rulings, statutes, regulations, constitutional law, lawsuits, judges and litigation, civil and criminal proceedings, legal precedent.',
  technology: 'Software and computing: programming, algorithms, databases, APIs, cloud computing, artificial intelligence, machine learning, neural networks, hardware, the internet.',
  history:    'Historical events and eras: ancient civilizations, wars, empires, dynasties, centuries past, medieval period, archaeological discoveries, the trajectory of human societies over time.',
  geography:  'Places and physical features of the earth: countries, cities, rivers, mountains, continents, climates, populations, capitals, regions, borders.',
  politics:   'Government and political processes: elections, presidents, senates, parliaments, political parties, campaigns, voting, foreign policy, public administration, democratic institutions.',
};

const DOMAIN_NAMES = Object.keys(DOMAIN_PROTOTYPES);

// Confidence floor below which the classifier returns 'other'.
// Tuned to match the two embedding providers we ship.
function otherThreshold(model) {
  if (typeof model === 'string' && model.startsWith('hash/')) return 0.30;
  return 0.40;
}

// Memoized prototype embeddings, keyed by model identifier.
// Allows multiple providers to coexist in the same process if needed.
const prototypeCacheByModel = new Map();
const prototypePromiseByModel = new Map();

async function getDomainPrototypes(opts = {}) {
  // We do one priming embedding call to learn which model we're using,
  // then cache prototypes under that model key.
  const probe = await getEmbedding('probe', opts);
  const model = probe.model;
  if (prototypeCacheByModel.has(model)) return prototypeCacheByModel.get(model);

  if (prototypePromiseByModel.has(model)) return prototypePromiseByModel.get(model);

  const p = (async () => {
    const out = {};
    for (const domain of DOMAIN_NAMES) {
      const emb = await getEmbedding(DOMAIN_PROTOTYPES[domain], opts);
      out[domain] = { vector: emb.vector, model: emb.model };
    }
    prototypeCacheByModel.set(model, out);
    return out;
  })();
  prototypePromiseByModel.set(model, p);
  try {
    return await p;
  } finally {
    prototypePromiseByModel.delete(model);
  }
}

/**
 * Classify a claim text into a domain.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {string} [opts.preferProvider]  passthrough to getEmbedding
 * @param {Object} [opts.env]             passthrough to getEmbedding
 * @returns {Promise<{ domain: string, confidence: number, model: string|null, matched: Record<string, number>, source: 'embedding'|'fallback' }>}
 */
async function classifyDomain(text, opts = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { domain: 'other', confidence: 0, model: null, matched: {}, source: 'fallback' };
  }

  // Probe the embedding provider first so we know whether to delegate.
  let queryEmb;
  try {
    queryEmb = await getEmbedding(text, opts);
  } catch (err) {
    return handTunedResult(text, null, err.message);
  }

  // Hash embeddings are too sparse to reliably classify broad topical
  // domains (the prototype paragraphs are conceptually too wide to
  // produce clean argmax under feature-hashing). When the hash
  // embedder is in use, delegate to the legacy hand-tuned scorer —
  // which is exactly the classifier we used to ship pre-#12, so
  // behavior is unchanged for users who haven't configured a real
  // embedding provider.
  //
  // To upgrade to embedding-based classification, set API_KEY_OPENAI
  // or EMBEDDINGS_PROVIDER=openai (or any future learned provider).
  if (typeof queryEmb.model === 'string' && queryEmb.model.startsWith('hash/')) {
    return handTunedResult(text, queryEmb.model);
  }

  // Embedding path
  let prototypes;
  try {
    prototypes = await getDomainPrototypes(opts);
  } catch (err) {
    return handTunedResult(text, queryEmb.model, err.message);
  }

  const matched = {};
  let best = { domain: 'other', confidence: 0 };
  for (const domain of DOMAIN_NAMES) {
    const proto = prototypes[domain];
    if (!proto || proto.vector.length !== queryEmb.vector.length) continue;
    const sim = cosineSimilarity(queryEmb.vector, proto.vector);
    matched[domain] = Number(sim.toFixed(3));
    if (sim > best.confidence) {
      best = { domain, confidence: sim };
    }
  }

  const threshold = otherThreshold(queryEmb.model);
  if (best.confidence < threshold) {
    return {
      domain: 'other',
      confidence: Number(best.confidence.toFixed(3)),
      runner_up_domain: best.domain,
      model: queryEmb.model,
      matched,
      source: 'embedding',
    };
  }

  return {
    domain: best.domain,
    confidence: Number(best.confidence.toFixed(3)),
    model: queryEmb.model,
    matched,
    source: 'embedding',
  };
}

function handTunedResult(text, model, errMessage) {
  const r = handTunedAnalyzeDomain(text);
  return {
    domain: r.domain,
    confidence: Number((r.domain_confidence ?? 0).toFixed(3)),
    matched_terms: r.domain_match_terms || [],
    matched: {}, // empty — no per-prototype scores
    model: model || null,
    source: 'hand_tuned',
    ...(errMessage ? { fallback_reason: errMessage } : {}),
  };
}

/**
 * Batch variant. Reuses the same prototype set across all queries.
 */
async function classifyDomains(texts, opts = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  // Prime prototypes once.
  try { await getDomainPrototypes(opts); } catch { /* fall through to per-item handling */ }
  return Promise.all(texts.map((t) => classifyDomain(t, opts)));
}

/**
 * Exposed for tests so each test run starts with a clean slate.
 */
function _resetCacheForTests() {
  prototypeCacheByModel.clear();
  prototypePromiseByModel.clear();
}

module.exports = {
  classifyDomain,
  classifyDomains,
  getDomainPrototypes,
  DOMAIN_PROTOTYPES,
  DOMAIN_NAMES,
  _resetCacheForTests,
};
