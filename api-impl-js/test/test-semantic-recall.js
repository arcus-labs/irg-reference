/**
 * End-to-end test for semantic episodic recall (item #11).
 *
 * Drives the real flow:
 *   1. Persist claims via the async writer — embeddings are inlined
 *   2. Verify DuckDB sees them in the claims view
 *   3. Run memoryRecall against a NEW (related) claim → expect
 *      semantic neighbors to surface
 *
 * Uses the hash embedder throughout (no network, deterministic).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-recall-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;
process.env.EMBEDDINGS_PROVIDER = 'hash'; // force offline embedder

const { writeFactCheckClaimsArtifact } = require('../core/external-fact-check/claim-store');
const memoryRecallNode = require('../core/nodes/memory-recall-node');
const db = require('../core/external-fact-check/db');

let passed = 0, failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

async function runNode(state) {
  const prepared = memoryRecallNode.prepare(state, {});
  const result = await memoryRecallNode.llmCall(prepared);
  return memoryRecallNode.process(prepared, result);
}

function makeState(claims) {
  return {
    originalQuery: 'test query',
    context: {},
    iteration: 0,
    factCheckResult: { critical_claims: claims },
  };
}

async function main() {
  console.log('========================================');
  console.log('Semantic episodic recall test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. Seed the store with a few claims via the real async writer.
  //    Embeddings should be generated and inlined automatically.
  console.log('\n1. Seed store via async writer (embeddings generated)');
  const seedResult = await writeFactCheckClaimsArtifact({
    criticalClaims: [
      { claim: 'Saturn has rings made of ice and rock particles.', importance: 'astronomy', assessment: 'true' },
      { claim: 'Antibiotics kill bacterial cells by disrupting their walls.', importance: 'health', assessment: 'true' },
      { claim: 'Photosynthesis converts light energy into chemical energy in plants.', importance: 'biology', assessment: 'true' },
    ],
    summary: 'seed',
    confidence: 0.9,
    originalQuery: 'seed',
    context: {},
    iteration: 0,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  ok('write succeeded',                  !!seedResult?.artifact_path);
  ok('embeddings_attached = 3',          seedResult?.embeddings_attached === 3);

  // 2. Confirm DuckDB sees the embeddings
  console.log('\n2. DuckDB exposes embedding rows');
  const embRows = await db.listClaimEmbeddings({});
  ok('3 embedding rows',                 embRows.length === 3);
  ok('first row has vector array',       Array.isArray(embRows[0].embedding_vector) && embRows[0].embedding_vector.length > 0);
  ok('first row has model = hash',       String(embRows[0].embedding_model).startsWith('hash/'));

  // 3. Ask about something related to "Saturn rings" with different wording.
  //    Exact claim_key won't match; semantic neighbor should fire.
  console.log('\n3. Related-but-not-identical query → semantic neighbor');
  const state3 = makeState([
    { claim: 'The rings of Saturn are composed of ice particles.', importance: 'astronomy', assessment: 'true' },
  ]);
  const s3 = await runNode(state3);
  const r3 = s3.memoryRecallResult;
  ok('result shape',                       !!r3);
  ok('claims_checked = 1',                  r3.claims_checked === 1);
  ok('exact recalled = 0 (different wording)', r3.recalled === 0);
  ok('semantic_neighbors_found >= 1',       r3.semantic_neighbors_found >= 1, `got ${r3.semantic_neighbors_found}`);
  ok('embedding_provider reported',         typeof r3.embedding_provider === 'string' && r3.embedding_provider.length > 0);

  const neighbors3 = r3.results[0].semantic_neighbors;
  ok('first claim has neighbors array',     Array.isArray(neighbors3));
  ok('at least one neighbor',                neighbors3.length >= 1);
  // The top neighbor should be the Saturn claim, not the antibiotics or photosynthesis one
  const topClaim = neighbors3[0]?.claim_text || '';
  ok('top neighbor is about Saturn',         topClaim.toLowerCase().includes('saturn'),
      `top neighbor was: "${topClaim}"`);
  ok('similarity is a number',                typeof neighbors3[0].similarity === 'number');

  // 4. Unrelated claim → no semantic neighbors above threshold
  console.log('\n4. Unrelated query → no neighbors');
  const state4 = makeState([
    { claim: 'Mount Everest is the tallest mountain on Earth.', importance: 'geography', assessment: 'true' },
  ]);
  const s4 = await runNode(state4);
  const r4 = s4.memoryRecallResult;
  ok('exact recalled = 0',                       r4.recalled === 0);
  ok('semantic_neighbors_found = 0 (unrelated)', r4.semantic_neighbors_found === 0,
      `got ${r4.semantic_neighbors_found}: ${JSON.stringify(r4.results[0].semantic_neighbors)}`);

  // 5. Exact-match claim still surfaces as a hit AND skips itself in neighbor search
  console.log('\n5. Exact match: hit, and self is excluded from neighbors');
  const state5 = makeState([
    { claim: 'Saturn has rings made of ice and rock particles.', importance: 'astronomy', assessment: 'true' },
  ]);
  const s5 = await runNode(state5);
  const r5 = s5.memoryRecallResult;
  // Note: exact-match recall requires a CITATION (not just a claim). Since we
  // only seeded claims here without citations, exact recall stays 0. But the
  // semantic neighbor search MUST exclude the self-claim by claim_key.
  const neighbors5 = r5.results[0].semantic_neighbors;
  const selfText = 'Saturn has rings made of ice and rock particles.';
  const selfInNeighbors = neighbors5.some((n) => n.claim_text === selfText);
  ok('self-claim NOT in semantic neighbors', !selfInNeighbors);

  // 6. With many semantic neighbors, top-K cap applies
  console.log('\n6. Top-K cap');
  await writeFactCheckClaimsArtifact({
    criticalClaims: [
      { claim: 'Saturn ring system mass and composition.',  importance: 'astronomy', assessment: 'true' },
      { claim: 'The Saturnian rings extend across vast distances.',  importance: 'astronomy', assessment: 'true' },
      { claim: 'Saturn ring formation theories discussed.',  importance: 'astronomy', assessment: 'true' },
      { claim: 'Saturn rings appear as a flat plane.',       importance: 'astronomy', assessment: 'true' },
    ],
    summary: 'more saturn', confidence: 0.9, originalQuery: 'more',
    context: {}, iteration: 0, sourceNode: 'factCheck', rawOutput: '',
  });
  const state6 = makeState([
    { claim: 'How are the rings of Saturn structured?', importance: 'astronomy', assessment: 'true' },
  ]);
  const s6 = await runNode(state6);
  const neighbors6 = s6.memoryRecallResult.results[0].semantic_neighbors;
  ok('top-K cap applied (<=3 neighbors)', neighbors6.length <= 3, `got ${neighbors6.length}`);

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
});
