/**
 * Tests for the memoryRecall node.
 *
 * Drives the node directly (no graph executor). Covers:
 *   - empty fact-store → all-miss result, no crash
 *   - exact claim_key match → hit with citation metadata
 *   - mixed hits/misses → correct counts
 *   - verified vs provisional distinction → recalled_verified counts only verified
 *   - empty critical_claims input → no-op result
 *   - trace node carries the result shape we expect
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-recall-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const memoryRecallNode = require('../core/nodes/memory-recall-node');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeCitation({ claimText, verdict = 'supported', verification_level = 'verified', sources = 2, createdAt = '2026-04-01T00:00:00.000Z', expiresAt = '2099-12-31T00:00:00.000Z' }) {
  const structured = canonicalizeClaim(claimText);
  const citationDir = path.join(tmpRoot, 'citations', '2026-04');
  fs.mkdirSync(citationDir, { recursive: true });
  const filename = `${structured.claim_key.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}.json`;
  const citation = {
    claim_key: structured.claim_key,
    created_at: createdAt,
    expires_at: expiresAt,
    claim: structured,
    verdict,
    verification_level,
    verification_status: verification_level === 'verified' ? `verified_${verdict}` : 'candidate_sources_fetched_unverified',
    confidence: 0.8,
    sources: new Array(sources).fill(null).map((_, i) => ({ url: `https://example.com/${i}` })),
    retrieval_mode: 'fetched_unverified',
    retrieval_deferred: false,
  };
  fs.writeFileSync(path.join(citationDir, filename), JSON.stringify(citation, null, 2));
  return { structured, citationPath: path.relative(tmpRoot, path.join(citationDir, filename)) };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================');
  console.log('memoryRecall node test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. Empty store → all miss, no crash
  console.log('\n1. Empty fact-store');
  const state1 = makeState([
    { claim: 'Saturn has rings.', importance: 'astronomy', assessment: 'true' },
    { claim: 'Antibiotics treat bacteria.', importance: 'health', assessment: 'true' },
  ]);
  const s1 = await runNode(state1);
  const r1 = s1.memoryRecallResult;
  ok('result present', !!r1);
  ok('claims_checked = 2', r1.claims_checked === 2);
  ok('recalled = 0',       r1.recalled === 0);
  ok('recalled_verified = 0', r1.recalled_verified === 0);
  ok('recall_rate = 0',    r1.recall_rate === 0);
  ok('all results are misses', r1.results.every((r) => r.recall.hit === false));
  ok('reason mentions no fact-store data', r1.results[0].recall.reason?.includes('no fact-store'));

  // 2. One verified citation, one missing
  console.log('\n2. Mixed hit + miss');
  writeCitation({ claimText: 'Saturn has rings.' });
  const state2 = makeState([
    { claim: 'Saturn has rings.', importance: 'astronomy', assessment: 'true' },
    { claim: 'Pluto is a planet.', importance: 'astronomy', assessment: 'true' },
  ]);
  const s2 = await runNode(state2);
  const r2 = s2.memoryRecallResult;
  ok('claims_checked = 2',          r2.claims_checked === 2);
  ok('recalled = 1',                 r2.recalled === 1);
  ok('recalled_verified = 1',        r2.recalled_verified === 1);
  ok('recall_rate = 0.5',            r2.recall_rate === 0.5);
  ok('Saturn hit recorded',          r2.results[0].recall.hit === true);
  ok('Saturn verdict = supported',   r2.results[0].recall.verdict === 'supported');
  ok('Saturn verification = verified', r2.results[0].recall.verification_level === 'verified');
  ok('Saturn source_count = 2',      r2.results[0].recall.source_count === 2);
  ok('Saturn citation_path set',     typeof r2.results[0].recall.citation_path === 'string');
  ok('Pluto miss',                   r2.results[1].recall.hit === false);

  // 3. Provisional citation hits but doesn't count as verified
  console.log('\n3. Provisional citation distinguished from verified');
  writeCitation({ claimText: 'Mars has two moons.', verdict: 'inconclusive', verification_level: 'provisional' });
  const state3 = makeState([
    { claim: 'Mars has two moons.', importance: 'astronomy', assessment: 'true' },
  ]);
  const s3 = await runNode(state3);
  const r3 = s3.memoryRecallResult;
  ok('hit recorded',                          r3.recalled === 1);
  ok('NOT counted as verified',                r3.recalled_verified === 0);
  ok('verification_level = provisional',       r3.results[0].recall.verification_level === 'provisional');

  // 4. String-shaped claims also work
  console.log('\n4. String-shaped claims');
  writeCitation({ claimText: 'Light travels at finite speed.' });
  const state4 = makeState([
    'Light travels at finite speed.',
  ]);
  const s4 = await runNode(state4);
  const r4 = s4.memoryRecallResult;
  ok('string claim treated as text', r4.claims_checked === 1);
  ok('hit recorded',                  r4.results[0].recall.hit === true);

  // 5. Empty claims input
  console.log('\n5. Empty critical_claims');
  const s5 = await runNode(makeState([]));
  const r5 = s5.memoryRecallResult;
  ok('claims_checked = 0', r5.claims_checked === 0);
  ok('recalled = 0',        r5.recalled === 0);
  ok('results empty',       Array.isArray(r5.results) && r5.results.length === 0);

  // 6. Missing factCheckResult entirely
  console.log('\n6. Missing factCheckResult');
  const s6 = await runNode({ originalQuery: 'q', context: {}, iteration: 0 });
  const r6 = s6.memoryRecallResult;
  ok('claims_checked = 0',  r6.claims_checked === 0);
  ok('no error',             !r6.error);

  // 7. Trace node record shape
  console.log('\n7. Trace node record');
  const trace = s2.nodes;
  ok('s2 nodes array exists',  Array.isArray(trace));
  ok('one node recorded',       trace.length === 1);
  ok('type = memory_recall',    trace[0].type === 'memory_recall');
  ok('id starts with node_memory_recall', String(trace[0].id).startsWith('node_memory_recall'));
  ok('content has results',     Array.isArray(trace[0].content.results));
  ok('confidence is a number',   typeof trace[0].confidence === 'number');

  // 8. Idempotency: same call → same results
  console.log('\n8. Idempotent (re-reads from disk)');
  const s8 = await runNode(state2);
  ok('still 1 hit',  s8.memoryRecallResult.recalled === 1);

  // 9. previously_seen: detect a claim that was persisted in a PRIOR
  //    session (i.e. with generated_at < current session's cutoff)
  //    even when no citation exists for it.
  console.log('\n9. previously_seen via prior claim writes');
  const { writeFactCheckClaimsArtifactSync } = require('../core/external-fact-check/claim-store');
  // Simulate a PRIOR session that wrote a claim
  writeFactCheckClaimsArtifactSync({
    criticalClaims: [{ claim: 'The Pacific Ocean is the largest ocean on Earth.', importance: 'geography', assessment: 'true' }],
    summary: 'prior', confidence: 0.9, originalQuery: 'old', context: {},
    iteration: 0, sourceNode: 'factCheck', rawOutput: '',
  });
  // Wait a small amount to make timestamps differ
  await new Promise((r) => setTimeout(r, 50));
  // Now simulate the CURRENT session: same claim, fresh state with a
  // factCheckResult.generated_at AFTER the prior write.
  const currentSessionState = {
    originalQuery: 'new',
    context: {},
    iteration: 0,
    factCheckResult: {
      critical_claims: [{ claim: 'The Pacific Ocean is the largest ocean on Earth.', importance: 'geography', assessment: 'true' }],
      generated_at: new Date().toISOString(),
    },
  };
  const s9 = await runNode(currentSessionState);
  const r9 = s9.memoryRecallResult;
  ok('previously_seen = 1', r9.previously_seen === 1,
     `got previously_seen=${r9.previously_seen}, recalled=${r9.recalled}`);
  ok('per-result has previously_seen=true', r9.results[0].previously_seen === true);
  ok('recalled (citation) still 0 (no citation written)', r9.recalled === 0);

  // 10. previously_seen does NOT fire for current-session writes
  console.log('\n10. previously_seen excludes current-session writes');
  // factCheckResult.generated_at AT or BEFORE the prior write → cutoff
  // is older than what's in the store → nothing pre-dates it → 0
  const sameSessionState = {
    originalQuery: 'new',
    context: {},
    iteration: 0,
    factCheckResult: {
      critical_claims: [{ claim: 'The Pacific Ocean is the largest ocean on Earth.', importance: 'geography', assessment: 'true' }],
      // Cutoff in the past — nothing predates it
      generated_at: '2000-01-01T00:00:00.000Z',
    },
  };
  const s10 = await runNode(sameSessionState);
  ok('previously_seen = 0 with old cutoff', s10.memoryRecallResult.previously_seen === 0);

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
