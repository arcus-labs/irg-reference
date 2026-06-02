/**
 * Tests for the citation benchmark harness:
 *   - pure aggregate()/stats() math (mean/stdev/min/max, null handling)
 *   - --mock end-to-end smoke (no LLM key needed): the harness should run the
 *     full node path against the eval set and report perfect scores, proving
 *     the plumbing works.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { aggregate, stats } = require('../bench/citation-bench');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

function statsTests() {
  console.log('\n--- stats() ---');
  const s = stats([1, 0.5, 0]);
  ok('mean of [1,0.5,0] = 0.5', s.mean === 0.5, s);
  ok('min/max', s.min === 0 && s.max === 1);
  ok('stdev positive', s.stdev > 0);
  ok('n counts numbers', s.n === 3);

  const withNulls = stats([1, null, undefined, 0]);
  ok('nulls excluded from n', withNulls.n === 2, withNulls);
  ok('mean ignores nulls', withNulls.mean === 0.5);

  const empty = stats([]);
  ok('empty → mean null', empty.mean === null);
  ok('empty → n 0', empty.n === 0);

  const single = stats([0.8]);
  ok('single value stdev 0', single.stdev === 0);
}

function aggregateTests() {
  console.log('\n--- aggregate() ---');
  const trials = [
    { case_id: 'a', recall: 1, precision: 1, f1: 1, counts: { claim_bearing: 2, cited_sentences: 2, uncited_claims: 0, misattributed_citations: 0 }, tags: { found: 2, validated: 2, dropped: 0 } },
    { case_id: 'a', recall: 0.5, precision: 1, f1: 0.667, counts: { claim_bearing: 2, cited_sentences: 1, uncited_claims: 1, misattributed_citations: 0 }, tags: { found: 1, validated: 1, dropped: 0 } },
    { case_id: 'b', recall: 0, precision: 0.5, f1: 0, counts: { claim_bearing: 3, cited_sentences: 2, uncited_claims: 3, misattributed_citations: 1 }, tags: { found: 3, validated: 2, dropped: 1 } },
    { case_id: 'c', recall: null, precision: null, f1: null, counts: {}, tags: { found: 0, validated: 0, dropped: 0 } }, // inert (no citations)
  ];
  const agg = aggregate(trials);

  ok('trials counted', agg.trials === 4);
  ok('recall mean over 3 non-null = 0.5', agg.recall.mean === 0.5, agg.recall);
  ok('recall n excludes inert case', agg.recall.n === 3);
  ok('precision mean = (1+1+0.5)/3 ≈ 0.833', agg.precision.mean === round3((1 + 1 + 0.5) / 3), agg.precision);
  ok('totals.uncited_claims summed', agg.totals.uncited_claims === 4);
  ok('totals.misattributed summed', agg.totals.misattributed === 1);
  ok('totals.tags found/validated/dropped', agg.totals.tags_found === 6 && agg.totals.tags_validated === 5 && agg.totals.tags_dropped === 1);

  ok('by_case a has 2 trials', agg.by_case.a.trials === 2);
  ok('by_case a recall mean 0.75', agg.by_case.a.recall.mean === 0.75, agg.by_case.a.recall);
  ok('by_case c recall null (inert)', agg.by_case.c.recall.mean === null);

  const empty = aggregate([]);
  ok('empty trials → recall null', empty.recall.mean === null);
  ok('empty trials → totals zero', empty.totals.claim_bearing === 0);
}

function round3(n) { return Number(n.toFixed(3)); }

function mockSmokeTest() {
  console.log('\n--- --mock smoke (full harness, no LLM) ---');
  const bench = path.resolve(__dirname, '..', 'bench', 'citation-bench.js');
  const res = spawnSync(process.execPath, [bench, '--mock', '--json', '--case', 'pluto-planet'], { encoding: 'utf8' });
  ok('exit 0', res.status === 0, res.stderr);
  let report = null;
  try { report = JSON.parse(res.stdout); } catch { /* leave null */ }
  ok('emits JSON report', report !== null);
  ok('ran the case', report && report.aggregate.by_case['pluto-planet']);
  // The mock model cites every available claim and judges them supported →
  // perfect precision and recall, proving the node plumbing end-to-end.
  ok('mock precision = 1', report && report.aggregate.precision.mean === 1, report && report.aggregate.precision);
  ok('mock recall = 1', report && report.aggregate.recall.mean === 1, report && report.aggregate.recall);
  ok('citation tags validated > 0', report && report.aggregate.totals.tags_validated > 0);
  // The mock should cite only the real handles from the citable block — no
  // phantom handles from the prompt's instructions, so nothing is dropped.
  ok('mock drops no tags (no phantom handles)', report && report.aggregate.totals.tags_dropped === 0, report && report.aggregate.totals);
}

function main() {
  console.log('========================================');
  console.log('citation benchmark harness test');
  console.log('========================================');
  statsTests();
  aggregateTests();
  mockSmokeTest();
  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
