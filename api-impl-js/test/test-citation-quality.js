/**
 * Tests for the pure citation quality-metrics module
 * (core/citations/quality-metrics.js, Citation_Application.md §13).
 */

'use strict';

const { computeCitationQuality } = require('../core/citations/quality-metrics');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

function main() {
  console.log('========================================');
  console.log('citation quality-metrics test');
  console.log('========================================');

  // Perfect: every claim cited + supported
  console.log('\n1. perfect recall + precision');
  const perfect = computeCitationQuality([
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: false, has_citation: false, citation_supports: false }, // filler sentence
  ]);
  ok('recall = 1', perfect.citation_recall === 1);
  ok('precision = 1', perfect.citation_precision === 1);
  ok('f1 = 1', perfect.citation_f1 === 1);
  ok('claim_bearing counted', perfect.counts.claim_bearing === 2);
  ok('filler not counted as claim', perfect.counts.claim_bearing === 2 && perfect.counts.sentences === 3);

  // Recall gap: a claim-bearing sentence with no citation
  console.log('\n2. recall gap (uncited claim)');
  const recallGap = computeCitationQuality([
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: true, has_citation: false, citation_supports: false }, // missed
  ]);
  ok('recall = 0.5', recallGap.citation_recall === 0.5);
  ok('precision still 1 (the one citation is good)', recallGap.citation_precision === 1);
  ok('uncited_claims = 1', recallGap.counts.uncited_claims === 1);

  // Precision gap: a citation on a sentence it doesn't support (misattached)
  console.log('\n3. precision gap (misattributed citation)');
  const precisionGap = computeCitationQuality([
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: true, has_citation: true, citation_supports: false }, // wrong span
  ]);
  ok('precision = 0.5', precisionGap.citation_precision === 0.5);
  ok('recall = 0.5 (only the supported one counts)', precisionGap.citation_recall === 0.5);
  ok('misattributed_citations = 1', precisionGap.counts.misattributed_citations === 1);

  // No claims at all → recall N/A (null), not 0/1
  console.log('\n4. no claim-bearing sentences → recall null');
  const noClaims = computeCitationQuality([
    { claim_bearing: false, has_citation: false, citation_supports: false },
  ]);
  ok('recall is null', noClaims.citation_recall === null);
  ok('precision is null (no citations)', noClaims.citation_precision === null);
  ok('f1 is null', noClaims.citation_f1 === null);

  // No citations but claims present → recall 0, precision null
  console.log('\n5. claims present, zero citations → recall 0, precision null');
  const noCites = computeCitationQuality([
    { claim_bearing: true, has_citation: false, citation_supports: false },
    { claim_bearing: true, has_citation: false, citation_supports: false },
  ]);
  ok('recall = 0', noCites.citation_recall === 0);
  ok('precision null (no cited sentences)', noCites.citation_precision === null);
  ok('uncited_claims = 2', noCites.counts.uncited_claims === 2);

  // Empty input
  console.log('\n6. empty / non-array input');
  const empty = computeCitationQuality([]);
  ok('empty → recall null', empty.citation_recall === null);
  ok('empty → precision null', empty.citation_precision === null);
  ok('empty → sentences 0', empty.counts.sentences === 0);
  const nonArray = computeCitationQuality(null);
  ok('null input tolerated', nonArray.counts.sentences === 0);

  // Rounding to 3 dp
  console.log('\n7. rounding');
  const thirds = computeCitationQuality([
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: true, has_citation: true, citation_supports: true },
    { claim_bearing: true, has_citation: false, citation_supports: false },
  ]);
  ok('recall = 0.667', thirds.citation_recall === 0.667, thirds.citation_recall);

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
