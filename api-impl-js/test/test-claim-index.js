/**
 * Tests for the pluggable ClaimIndex semantic-retrieval layer:
 *   - ExactCosineIndex  (brute-force; the correctness reference)
 *   - LshIndex          (approximate; results must be a subset of exact, same scores)
 *   - Ss4SidecarIndex   (HTTP seam; strict when unconfigured)
 *   - createClaimIndex  (factory / backend selection)
 *
 * All backends operate on a hand-built corpus (no DuckDB, no LLM).
 */

'use strict';

const {
  createClaimIndex,
  ExactCosineIndex,
  LshIndex,
  Ss4SidecarIndex,
} = require('../core/retrieval/claim-index');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

// Corpus (dim 6). k1 & k2 point almost the same direction; k3/k4 orthogonal;
// k5 opposite. The query q is closest to k1, then k2.
const corpus = [
  { claim_key: 'k1', claim_text: 'one',   domain: 'sci', embedding_model: 'test/m', embedding_vector: [1, 0, 0, 0, 0, 0] },
  { claim_key: 'k2', claim_text: 'two',   domain: 'sci', embedding_model: 'test/m', embedding_vector: [0.99, 0.1, 0, 0, 0, 0] },
  { claim_key: 'k3', claim_text: 'three', domain: 'geo', embedding_model: 'test/m', embedding_vector: [0, 1, 0, 0, 0, 0] },
  { claim_key: 'k4', claim_text: 'four',  domain: 'geo', embedding_model: 'test/m', embedding_vector: [0, 0, 1, 0, 0, 0] },
  { claim_key: 'k5', claim_text: 'five',  domain: 'sci', embedding_model: 'test/m', embedding_vector: [-1, 0, 0, 0, 0, 0] },
];
const q = [1, 0.05, 0, 0, 0, 0];
const THRESH = 0.3;

function exactTests() {
  console.log('\n--- ExactCosineIndex ---');
  const idx = new ExactCosineIndex(corpus);
  ok('size = 5', idx.size() === 5);
  const r = idx.query(q, { topK: 3, threshold: THRESH });
  ok('finds k1 then k2', r.map((x) => x.claim_key).join(',') === 'k1,k2', r);
  ok('orthogonal/opposite excluded by threshold', !r.find((x) => ['k3', 'k4', 'k5'].includes(x.claim_key)));
  ok('similarity descending', r[0].similarity >= r[1].similarity);
  ok('neighbor shape carries domain + model', r[0].domain === 'sci' && r[0].embedding_model === 'test/m');

  const ex = idx.query(q, { topK: 3, threshold: THRESH, excludeKey: 'k1' });
  ok('excludeKey drops k1', !ex.find((x) => x.claim_key === 'k1') && ex[0].claim_key === 'k2', ex);

  ok('topK limits results', idx.query(q, { topK: 1, threshold: 0 }).length === 1);
  ok('dim mismatch → no match', idx.query([1, 0], { threshold: 0 }).length === 0);
  ok('empty corpus → []', new ExactCosineIndex([]).query(q, { threshold: 0 }).length === 0);
}

function lshTests() {
  console.log('\n--- LshIndex (approximate) ---');
  const exact = new ExactCosineIndex(corpus);
  const lsh = new LshIndex(corpus, { seed: 42 });
  ok('size = 5', lsh.size() === 5);

  const exactRes = exact.query(q, { topK: 5, threshold: THRESH });
  const lshRes = lsh.query(q, { topK: 5, threshold: THRESH });

  ok('LSH finds the top neighbor (k1)', lshRes.length > 0 && lshRes[0].claim_key === 'k1', lshRes);
  // LSH must never invent a neighbor or score differently — its results are a
  // subset of exact's, with identical similarities.
  const exactMap = new Map(exactRes.map((x) => [x.claim_key, x.similarity]));
  ok('LSH results ⊆ exact results', lshRes.every((x) => exactMap.has(x.claim_key)), lshRes);
  ok('LSH scores match exact scores', lshRes.every((x) => exactMap.get(x.claim_key) === x.similarity));

  // Determinism: same corpus + seed → identical buckets → identical results.
  const lsh2 = new LshIndex(corpus, { seed: 42 });
  ok('deterministic across builds', JSON.stringify(lsh2.query(q, { topK: 5, threshold: THRESH })) === JSON.stringify(lshRes));

  ok('dim mismatch → []', lsh.query([1, 0, 0], { threshold: 0 }).length === 0);
  ok('empty corpus → size 0 + []', new LshIndex([]).size() === 0 && new LshIndex([]).query(q, { threshold: 0 }).length === 0);
}

async function ss4Tests() {
  console.log('\n--- Ss4SidecarIndex (seam) ---');
  const noEndpoint = new Ss4SidecarIndex({ corpus });
  ok('size reflects corpus', noEndpoint.size() === 5);
  let threw = false;
  try { await noEndpoint.query(q, { topK: 3, threshold: 0 }); } catch (e) { threw = /endpoint|SS4_SIDECAR_URL/.test(e.message); }
  ok('throws without endpoint (strict)', threw);

  // Stub fetch to exercise the request/response mapping.
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ neighbors: [{ claim_key: 'kx', claim_text: 'x', domain: 'd', similarity: 0.91, embedding_model: 'm' }] }) };
  };
  try {
    const idx = new Ss4SidecarIndex({ endpoint: 'http://ss4.local/', corpus });
    const res = await idx.query(q, { topK: 2, threshold: 0.5, excludeKey: 'k1' });
    ok('POSTs to {endpoint}/query', captured.url === 'http://ss4.local/query', captured.url);
    ok('forwards vector + top_k + threshold + exclude_key', captured.body.top_k === 2 && captured.body.threshold === 0.5 && captured.body.exclude_key === 'k1' && Array.isArray(captured.body.vector));
    ok('maps neighbor response shape', res.length === 1 && res[0].claim_key === 'kx' && res[0].similarity === 0.91);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function factoryTests() {
  console.log('\n--- createClaimIndex factory ---');
  ok('default → exact', (await createClaimIndex({ corpus })).backend === 'exact');
  ok('backend:lsh → lsh', (await createClaimIndex({ backend: 'lsh', corpus })).backend === 'lsh');
  ok('backend:ss4 → ss4 (no corpus load)', (await createClaimIndex({ backend: 'ss4', endpoint: 'http://x/' })).backend === 'ss4');
  ok('env CLAIM_INDEX_BACKEND respected', await (async () => {
    process.env.CLAIM_INDEX_BACKEND = 'lsh';
    const idx = await createClaimIndex({ corpus });
    delete process.env.CLAIM_INDEX_BACKEND;
    return idx.backend === 'lsh';
  })());
  let threw = false;
  try { await createClaimIndex({ backend: 'nope', corpus }); } catch { threw = true; }
  ok('unknown backend throws', threw);
}

async function main() {
  console.log('========================================');
  console.log('ClaimIndex retrieval test');
  console.log('========================================');
  exactTests();
  lshTests();
  await ss4Tests();
  await factoryTests();
  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
