/**
 * Tests for the embeddings module.
 *
 * Covers:
 *   - hashEmbed: deterministic, L2-normalized, sensible similarity
 *   - cosineSimilarity: edge cases
 *   - selectProvider: env-driven dispatch
 *   - getEmbedding: hash path works without network
 *   - graceful fallback when OpenAI fails (no API key)
 *
 * Does NOT make real OpenAI calls (no API key in CI).
 */

'use strict';

const {
  getEmbedding,
  cosineSimilarity,
  selectProvider,
  hashEmbed,
  suggestedNeighborThreshold,
  HASH_DIM,
} = require('../core/llm/embeddings');

let passed = 0, failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

function approxEq(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

async function main() {
  console.log('========================================');
  console.log('Embeddings test');
  console.log('========================================');

  // 1. hashEmbed shape
  console.log('\n1. hashEmbed shape');
  const e1 = hashEmbed('Saturn has rings made of ice.');
  ok('returns vector of HASH_DIM',       e1.vector.length === HASH_DIM);
  ok('model is hash/feature-256-v1',     e1.model === 'hash/feature-256-v1');
  ok('dim matches HASH_DIM',             e1.dim === HASH_DIM);
  ok('provider is hash',                 e1.provider === 'hash');

  // 2. L2-normalized
  console.log('\n2. L2-normalized');
  let normSquared = 0;
  for (const v of e1.vector) normSquared += v * v;
  ok('||v||² ≈ 1', approxEq(normSquared, 1, 1e-3), `got ${normSquared}`);

  // 3. Determinism
  console.log('\n3. Determinism');
  const e1b = hashEmbed('Saturn has rings made of ice.');
  ok('same text → same vector', e1.vector.every((v, i) => v === e1b.vector[i]));

  // 4. Identical text → cosine 1
  console.log('\n4. Identical text → cosine 1');
  ok('cosine(a, a) = 1', approxEq(cosineSimilarity(e1.vector, e1.vector), 1));

  // 5. Topical overlap should produce higher similarity than unrelated text
  console.log('\n5. Topical overlap signal');
  const eRingsA = hashEmbed('Saturn has rings made of ice and rock particles.');
  const eRingsB = hashEmbed("The rings of Saturn are composed mostly of ice.");
  const eUnrelated = hashEmbed('Antibiotics kill bacterial cells by disrupting their walls.');
  const simRelated = cosineSimilarity(eRingsA.vector, eRingsB.vector);
  const simUnrelated = cosineSimilarity(eRingsA.vector, eUnrelated.vector);
  ok('topical pair more similar than unrelated', simRelated > simUnrelated,
      `related=${simRelated.toFixed(3)} unrelated=${simUnrelated.toFixed(3)}`);
  ok('related > 0.3 (loose floor)', simRelated > 0.3, `got ${simRelated.toFixed(3)}`);
  ok('unrelated < 0.4 (loose ceiling)', simUnrelated < 0.4, `got ${simUnrelated.toFixed(3)}`);

  // 6. cosineSimilarity edge cases
  console.log('\n6. cosineSimilarity edges');
  ok('mismatched lengths → 0',  cosineSimilarity([1, 2], [1, 2, 3]) === 0);
  ok('empty arrays → 0',        cosineSimilarity([], []) === 0);
  ok('non-arrays → 0',           cosineSimilarity(null, null) === 0);
  ok('zero vector → 0',          cosineSimilarity([0, 0, 0], [1, 1, 1]) === 0);
  ok('opposite vectors → -1',    approxEq(cosineSimilarity([1, 0], [-1, 0]), -1));
  ok('orthogonal → 0',           approxEq(cosineSimilarity([1, 0], [0, 1]), 0));

  // 7. selectProvider dispatch
  console.log('\n7. selectProvider dispatch');
  ok('explicit prefer wins',         selectProvider({}, 'openai') === 'openai');
  ok('explicit prefer wins (hash)',  selectProvider({ API_KEY_OPENAI: 'x' }, 'hash') === 'hash');
  ok('env override (openai)',         selectProvider({ EMBEDDINGS_PROVIDER: 'openai', API_KEY_OPENAI: 'x' }) === 'openai');
  ok('env override (hash) beats key', selectProvider({ EMBEDDINGS_PROVIDER: 'hash', API_KEY_OPENAI: 'x' }) === 'hash');
  ok('key present → openai',          selectProvider({ API_KEY_OPENAI: 'x' }) === 'openai');
  ok('no key → hash',                  selectProvider({}) === 'hash');

  // 8. getEmbedding with hash provider (default in clean env)
  console.log('\n8. getEmbedding (hash path)');
  const e8 = await getEmbedding('Mars is the fourth planet.', { env: {} });
  ok('provider = hash',  e8.provider === 'hash');
  ok('has vector',       Array.isArray(e8.vector) && e8.vector.length === HASH_DIM);

  // 9. getEmbedding with openai preference but no key → falls back gracefully
  console.log('\n9. OpenAI preference without key falls back');
  const e9 = await getEmbedding('test', { env: {}, preferProvider: 'openai' });
  ok('fell back to hash', e9.provider === 'hash');
  ok('fallback_reason set', typeof e9.fallback_reason === 'string');
  ok('fallback_reason mentions openai',
      String(e9.fallback_reason).toLowerCase().includes('openai'));

  // 10. suggestedNeighborThreshold
  console.log('\n10. suggestedNeighborThreshold');
  ok('hash model = 0.30',     suggestedNeighborThreshold('hash/feature-256-v1') === 0.30);
  ok('openai model = 0.75',   suggestedNeighborThreshold('openai/text-embedding-3-small') === 0.75);
  ok('unknown defaults to 0.75', suggestedNeighborThreshold('mistral/foo') === 0.75);

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
