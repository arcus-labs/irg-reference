/**
 * Confirms that the factCheck node persists claims to the fact-store
 * even when running in simple mode (enableFactCheckPipeline = false).
 *
 * This validates the silent-seeding behavior added in issue #3:
 * regardless of which graph the user runs, the memory layer accrues.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-mode-persist-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const factCheckNode = require('../core/nodes/fact-check-node');
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

async function runProcess(state, llmContent) {
  return factCheckNode.process(state, {
    content: llmContent,
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
}

const simpleClaimsJson = JSON.stringify({
  critical_claims: [
    { claim: 'Saturn has rings.', importance: 'core astronomy claim', assessment: 'true', reasoning: 'well established', source: null },
    { claim: 'Antibiotics target bacterial cells.', importance: 'medical fact', assessment: 'true', reasoning: 'pharmacology basics', source: null },
  ],
  summary: 'two simple verified facts',
  confidence: 0.92,
});

// Different claim set for the pipeline-mode call, so the second write
// is NOT deduplicated and we can verify pipeline-mode persistence.
const pipelineClaimsJson = JSON.stringify({
  critical_claims: [
    { claim: 'The Pacific Ocean is the largest ocean on Earth.', importance: 'geography fact', assessment: 'true', reasoning: 'measurable', source: null },
    { claim: 'Light travels faster than sound.', importance: 'physics basic', assessment: 'true', reasoning: 'measurable', source: null },
  ],
  summary: 'two more facts',
  confidence: 0.92,
});

async function main() {
  console.log('========================================');
  console.log('factCheck simple-mode persistence test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. Simple mode: claims should still hit disk
  console.log('\n1. Simple mode (enableFactCheckPipeline = false)');
  const simpleState = {
    originalQuery: 'What facts do we know?',
    context: {},
    iteration: 0,
    config: { enableFactCheckPipeline: false },
  };
  const after1 = await runProcess(simpleState, simpleClaimsJson);

  const filesAfter1 = listClaimFiles();
  ok('exactly one claim artifact written to disk', filesAfter1.length === 1);

  const recorded1 = after1.nodes?.[0];
  ok('node type is fact_check (clean simple-mode shape)', recorded1?.type === 'fact_check');
  ok('node content has critical_claims array', Array.isArray(recorded1?.content?.critical_claims));
  ok('node content has 2 claims', recorded1?.content?.critical_claims?.length === 2);
  ok('node content does NOT expose artifact_path', recorded1?.content?.artifact_path === undefined);
  ok('node content does NOT expose fact_store_root', recorded1?.content?.fact_store_root === undefined);

  // 2. Pipeline mode with *different* claims: same disk write path,
  //    but trace gets artifact metadata. Using a distinct claim set
  //    so dedup doesn't trigger.
  console.log('\n2. Pipeline mode (enableFactCheckPipeline = true), distinct claims');
  const pipelineState = {
    originalQuery: 'What facts do we know?',
    context: {},
    iteration: 0,
    config: { enableFactCheckPipeline: true },
  };
  const after2 = await runProcess(pipelineState, pipelineClaimsJson);

  const filesAfter2 = listClaimFiles();
  ok('a second claim artifact was written', filesAfter2.length === 2);

  const recorded2 = after2.nodes?.[0];
  ok('node type is fact_check_pipeline', recorded2?.type === 'fact_check_pipeline');
  ok('node content exposes artifact_path', typeof recorded2?.content?.artifact_path === 'string');
  ok('node content exposes fact_store_root', typeof recorded2?.content?.fact_store_root === 'string');

  // 3. DuckDB now sees the persisted simple-mode claims
  console.log('\n3. DuckDB sees the simple-mode claims');
  const stats = await db.getStats();
  ok('getStats() returns a result', stats !== null);
  ok('stats.claims.total = 4 (2 per call × 2 calls)', stats?.claims?.total === 4);

  // 4. Empty-claim guard: no artifact written when LLM returns zero claims
  console.log('\n4. Empty-claim guard');
  const beforeEmpty = listClaimFiles().length;
  const emptyState = {
    originalQuery: 'irrelevant',
    context: {},
    iteration: 0,
    config: { enableFactCheckPipeline: false },
  };
  await runProcess(emptyState, JSON.stringify({ critical_claims: [], summary: '', confidence: 0.5 }));
  const afterEmpty = listClaimFiles().length;
  ok('no new artifact when claims array is empty', afterEmpty === beforeEmpty);

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
