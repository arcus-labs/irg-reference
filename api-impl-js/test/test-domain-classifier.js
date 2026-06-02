/**
 * Tests for the embedding-based domain classifier.
 *
 * The classifier has two paths:
 *   1. Embedding path — used when a learned embedding provider is
 *      configured (e.g. OpenAI). Tested here with a stubbed
 *      embedder so the test is deterministic and offline.
 *   2. Hand-tuned fallback — used when only the hash embedder is
 *      available (because hash embeddings are too sparse for broad
 *      topical clustering). Tested here directly via the live
 *      hash embedder.
 *
 * Both paths return the same shape so callers don't have to branch.
 */

'use strict';

let passed = 0, failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

// ---------------------------------------------------------------------------
// 1. Hand-tuned fallback (live hash embedder)
// ---------------------------------------------------------------------------
async function testHandTunedPath() {
  console.log('\n=== Hand-tuned fallback (hash embedder) ===');

  // Force hash provider for this test block.
  process.env.EMBEDDINGS_PROVIDER = 'hash';
  // Clear require cache so modules pick up the env change cleanly.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('domain-classifier') || k.includes('embeddings') || k.includes('claim-parser')) {
      delete require.cache[k];
    }
  }

  const { classifyDomain, DOMAIN_NAMES } = require('../core/external-fact-check/domain-classifier');

  // Edge cases
  const eEmpty = await classifyDomain('');
  ok('empty → other',                     eEmpty.domain === 'other');
  ok('empty has source=fallback',         eEmpty.source === 'fallback');

  // Hand-tuned scorer DOES correctly classify well-keyworded text.
  const cases = [
    { text: 'Antibiotics target bacterial cells.',                expected: 'health' },
    { text: 'The stock market closed lower with falling interest rates.', expected: 'finance' },
    { text: 'The Supreme Court ruled on a constitutional statute.',  expected: 'law' },
    { text: 'Software algorithms and APIs underpin modern computing.', expected: 'technology' },
  ];
  for (const c of cases) {
    const r = await classifyDomain(c.text);
    ok(`"${c.text.slice(0, 40)}…" → ${c.expected}`, r.domain === c.expected,
       `got ${r.domain} (source=${r.source}, confidence=${r.confidence})`);
  }

  // Hand-tuned source label is correct
  const r = await classifyDomain('A clinical trial proved the drug effective.');
  ok('source = hand_tuned', r.source === 'hand_tuned');
  ok('has matched_terms array', Array.isArray(r.matched_terms));

  // Result shape
  ok('has .domain',     typeof r.domain === 'string');
  ok('has .confidence', typeof r.confidence === 'number');
  ok('has .matched',    typeof r.matched === 'object' && r.matched !== null);
  ok('matched is empty for hand-tuned', Object.keys(r.matched).length === 0);
}

// ---------------------------------------------------------------------------
// 2. Embedding path (with mock embedder)
// ---------------------------------------------------------------------------
async function testEmbeddingPath() {
  console.log('\n=== Embedding path (mocked) ===');

  // Build the stub embeddings module. Each prototype paragraph gets a
  // one-hot vector by recognizing its leading signature phrase. Test
  // fixtures are explicit IDs.
  const prototypeSignals = {
    science:    ['scientific research', 'physics', 'astronomy'],
    health:     ['medicine', 'medical', 'antibiotic'],
    finance:    ['economics', 'financial markets', 'interest rates'],
    law:        ['legal systems', 'court rulings', 'jurisprudence'],
    technology: ['software', 'computing', 'algorithms'],
    history:    ['historical events', 'ancient civilizations', 'empires'],
    geography:  ['places and physical', 'countries, cities', 'rivers, mountains'],
    politics:   ['government and political', 'elections', 'parliaments'],
  };
  const oneHots = {
    science:    [1, 0, 0, 0, 0, 0, 0, 0],
    health:     [0, 1, 0, 0, 0, 0, 0, 0],
    finance:    [0, 0, 1, 0, 0, 0, 0, 0],
    law:        [0, 0, 0, 1, 0, 0, 0, 0],
    technology: [0, 0, 0, 0, 1, 0, 0, 0],
    history:    [0, 0, 0, 0, 0, 1, 0, 0],
    geography:  [0, 0, 0, 0, 0, 0, 1, 0],
    politics:   [0, 0, 0, 0, 0, 0, 0, 1],
  };

  const stubEmbeddings = {
    getEmbedding: async (text) => {
      const lower = String(text).toLowerCase();
      if (lower === 'probe') {
        // Probe is used to learn which model is in use; return a
        // benign mock vector (NOT hash/) so the classifier takes the
        // embedding path instead of falling back to hand-tuned.
        return { model: 'mock/test', dim: 8, vector: [0, 0, 0, 0, 0, 0, 0, 0], provider: 'mock' };
      }
      for (const [dom, signals] of Object.entries(prototypeSignals)) {
        if (signals.some((s) => lower.includes(s))) {
          return { model: 'mock/test', dim: 8, vector: oneHots[dom], provider: 'mock' };
        }
      }
      if (text === 'CLAIM_HEALTH')  return { model: 'mock/test', dim: 8, vector: [0.05, 0.99, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05], provider: 'mock' };
      if (text === 'CLAIM_FINANCE') return { model: 'mock/test', dim: 8, vector: [0.05, 0.05, 0.99, 0.05, 0.05, 0.05, 0.05, 0.05], provider: 'mock' };
      if (text === 'CLAIM_TECH')    return { model: 'mock/test', dim: 8, vector: [0.05, 0.05, 0.05, 0.05, 0.99, 0.05, 0.05, 0.05], provider: 'mock' };
      if (text === 'CLAIM_NOISE')   return { model: 'mock/test', dim: 8, vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], provider: 'mock' };
      return { model: 'mock/test', dim: 8, vector: [0, 0, 0, 0, 0, 0, 0, 0], provider: 'mock' };
    },
    cosineSimilarity: (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom === 0 ? 0 : dot / denom;
    },
    suggestedNeighborThreshold: () => 0.5,
  };

  // Inject the stub BEFORE requiring the classifier (the classifier
  // destructures function refs at require time, so we can't mutate
  // the stub after).
  for (const k of Object.keys(require.cache)) {
    if (k.includes('domain-classifier') || k.includes('embeddings')) delete require.cache[k];
  }
  const embeddingsModulePath = require.resolve('../core/llm/embeddings');
  require.cache[embeddingsModulePath] = {
    id: embeddingsModulePath,
    filename: embeddingsModulePath,
    loaded: true,
    exports: stubEmbeddings,
  };

  const { classifyDomain, _resetCacheForTests } = require('../core/external-fact-check/domain-classifier');
  _resetCacheForTests();

  // 1. Strong-signal claims classify correctly
  const rHealth = await classifyDomain('CLAIM_HEALTH');
  ok('strong-health claim → health', rHealth.domain === 'health',
     `got ${rHealth.domain}, matched=${JSON.stringify(rHealth.matched)}`);
  ok('source = embedding', rHealth.source === 'embedding');
  ok('has all 8 matched scores', Object.keys(rHealth.matched).length === 8);
  ok('confidence > 0.5', rHealth.confidence > 0.5);

  const rFinance = await classifyDomain('CLAIM_FINANCE');
  ok('strong-finance claim → finance', rFinance.domain === 'finance',
     `got ${rFinance.domain}, matched=${JSON.stringify(rFinance.matched)}`);

  const rTech = await classifyDomain('CLAIM_TECH');
  ok('strong-tech claim → technology', rTech.domain === 'technology');

  // 2. Noise below threshold → other
  const rNoise = await classifyDomain('CLAIM_NOISE');
  ok('uniform noise → other', rNoise.domain === 'other',
     `got ${rNoise.domain}, confidence=${rNoise.confidence}`);
  ok('has runner_up_domain', typeof rNoise.runner_up_domain === 'string');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================');
  console.log('Domain classifier test');
  console.log('========================================');

  await testHandTunedPath();
  await testEmbeddingPath();

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
