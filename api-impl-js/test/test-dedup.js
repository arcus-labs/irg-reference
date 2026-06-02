/**
 * Verifies write-path deduplication for the fact-store.
 *
 * Specifically:
 *   - identical claim batches don't bloat disk
 *   - mixed batches (some new, some dup) still get written
 *   - dedup respects the per-domain expiry window
 *   - expired entries don't dedupe (the new write wins)
 *   - the dedup result surfaces deduplicated_count to callers
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-store-dedup-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const {
  writeFactCheckClaimsArtifact,
  writeFactCheckClaimsArtifactSync,
} = require('../core/external-fact-check/claim-store');
const db = require('../core/external-fact-check/db');

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
}

function listClaimFiles() {
  const dir = path.join(tmpRoot, 'claims');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const month of fs.readdirSync(dir)) {
    const monthDir = path.join(dir, month);
    if (!fs.statSync(monthDir).isDirectory()) continue;
    for (const file of fs.readdirSync(monthDir)) {
      if (file.endsWith('.json')) out.push(path.join(monthDir, file));
    }
  }
  return out;
}

const batchA = [
  { claim: 'Mercury is the closest planet to the Sun.', importance: 'astronomy', assessment: 'true' },
  { claim: 'Venus rotates clockwise relative to other planets.', importance: 'astronomy', assessment: 'true' },
];

const batchB = [
  { claim: 'Mercury is the closest planet to the Sun.', importance: 'astronomy', assessment: 'true' },
  { claim: 'Mars has two small moons named Phobos and Deimos.', importance: 'astronomy', assessment: 'true' },
];

const batchC = batchA; // identical to batchA

async function main() {
  console.log('========================================');
  console.log('Fact-store write-path dedup test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. First write — baseline
  console.log('\n1. First write of batch A');
  const r1 = await writeFactCheckClaimsArtifact({
    criticalClaims: batchA,
    summary: 'baseline',
    confidence: 0.9,
    originalQuery: 'planet facts',
    context: {},
    iteration: 0,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  ok('artifact written', listClaimFiles().length === 1);
  ok('result has artifact_path', typeof r1?.artifact_path === 'string');
  ok('deduplicated_count = 0', r1?.deduplicated_count === 0);
  ok('write_skipped is not set', !r1?.write_skipped);

  // 2. Re-write identical batch C — should dedupe entirely
  console.log('\n2. Re-write identical batch C (same as A)');
  const filesBefore = listClaimFiles().length;
  const r2 = await writeFactCheckClaimsArtifact({
    criticalClaims: batchC,
    summary: 'dup check',
    confidence: 0.9,
    originalQuery: 'planet facts',
    context: {},
    iteration: 1,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  const filesAfter = listClaimFiles().length;
  ok('no new artifact written', filesAfter === filesBefore);
  ok('write_skipped = true', r2?.write_skipped === true);
  ok('deduplicated_count = 2 (matches input batch size)', r2?.deduplicated_count === 2);
  ok('critical_claim_count = 2', r2?.critical_claim_count === 2);
  ok('inline critical_claims preserved', Array.isArray(r2?.critical_claims) && r2.critical_claims.length === 2);
  ok('storage flagged as skipped', r2?.storage === 'filesystem_artifact_skipped');

  // 3. Mixed batch B (1 dup, 1 new) — full write expected
  console.log('\n3. Mixed batch B (1 dup, 1 new)');
  const filesBefore2 = listClaimFiles().length;
  const r3 = await writeFactCheckClaimsArtifact({
    criticalClaims: batchB,
    summary: 'mixed',
    confidence: 0.9,
    originalQuery: 'planet facts',
    context: {},
    iteration: 2,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  const filesAfter3 = listClaimFiles().length;
  ok('one new artifact written', filesAfter3 === filesBefore2 + 1);
  ok('write_skipped is not set', !r3?.write_skipped);
  ok('deduplicated_count = 1', r3?.deduplicated_count === 1);
  ok('result.critical_claim_count = 2 (full batch)', r3?.critical_claim_count === 2);

  // 4. Dedup respects expiry: write a claim with a domain whose expiry
  //    is short (finance: 30 days), then verify findFreshClaimKeys
  //    behavior with a far-future "now" argument that exceeds the window.
  console.log('\n4. Expiry-aware dedup');
  const financeBatch = [
    { claim: 'The US economy grew 2.1% last quarter.', importance: 'finance fact', assessment: 'true' },
  ];
  const r4 = await writeFactCheckClaimsArtifact({
    criticalClaims: financeBatch,
    summary: 'finance baseline',
    confidence: 0.9,
    originalQuery: 'economy',
    context: {},
    iteration: 0,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  ok('finance claim written initially', !r4?.write_skipped);

  // Look up freshness now (should be fresh)
  const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');
  const financeKey = canonicalizeClaim('The US economy grew 2.1% last quarter.').claim_key;
  const freshNow = await db.findFreshClaimKeys([financeKey]);
  ok('finance key fresh at now', freshNow.has(financeKey));

  // Look up 60 days in the future — should be expired (finance window is 30 days)
  const sixtyDaysAhead = Date.now() + 60 * 24 * 60 * 60 * 1000;
  const freshLater = await db.findFreshClaimKeys([financeKey], sixtyDaysAhead);
  ok('finance key NOT fresh 60 days from now (30d expiry)', !freshLater.has(financeKey));

  // 5. Dedup of unknown claim_keys = always-write
  console.log('\n5. Unknown claim_keys never marked fresh');
  const unknown = await db.findFreshClaimKeys(['0'.repeat(64)]);
  ok('unknown key not in fresh set', !unknown.has('0'.repeat(64)));

  // 6. Empty input to findFreshClaimKeys returns empty Set
  console.log('\n6. Edge cases');
  const emptyResult = await db.findFreshClaimKeys([]);
  ok('empty input returns empty set', emptyResult instanceof Set && emptyResult.size === 0);

  // 7. Async writer with empty batch returns null (no-op)
  const emptyWrite = await writeFactCheckClaimsArtifact({
    criticalClaims: [],
    summary: '',
    confidence: 0.5,
    originalQuery: '',
    context: {},
    iteration: 0,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  ok('empty-batch write returns null', emptyWrite === null);

  // 8. Sync writer still works untouched (no-dedup escape hatch)
  console.log('\n8. Sync writer still works without dedup');
  const beforeSync = listClaimFiles().length;
  const r8 = writeFactCheckClaimsArtifactSync({
    criticalClaims: batchA, // identical to what's already on disk
    summary: 'forced sync write',
    confidence: 0.9,
    originalQuery: 'planet facts',
    context: {},
    iteration: 99,
    sourceNode: 'factCheck',
    rawOutput: '',
  });
  const afterSync = listClaimFiles().length;
  ok('sync writer always writes (no dedup)', afterSync === beforeSync + 1);
  ok('sync writer result has artifact_path', typeof r8?.artifact_path === 'string');

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
