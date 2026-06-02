/**
 * Tests for the pure citation core:
 *   - core/citations/citation-id.js     (deterministic uuid)
 *   - core/citations/citation-format.js (tag grammar helpers)
 *   - core/citations/apply.js           (validate → resolve → renumber → references)
 *   - core/citations/build-citable-set.js
 *
 * Covers every §11 edge case from Citation_Application.md.
 */

'use strict';

const { deriveClaimUuid } = require('../core/citations/citation-id');
const { applyCitations } = require('../core/citations/apply');
const { buildCitableSet } = require('../core/citations/build-citable-set');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function citable(handle, claimKey, over = {}) {
  return {
    handle,
    uuid: deriveClaimUuid(claimKey),
    claim_key: claimKey,
    claim_text: over.claim_text || `claim ${handle}`,
    verdict: over.verdict || 'supported',
    verification_level: over.verification_level || 'verified',
    verification_confidence: over.verification_confidence ?? 0.8,
    sources: over.sources || [{ url: 'https://example.com', title: 'Ex', supporting_span: 'span', span_offset: null, excerpt: null }],
    ...(over.citation_path ? { citation_path: over.citation_path } : {}),
  };
}

// ---------------------------------------------------------------------------

function idTests() {
  console.log('\n--- citation-id ---');
  const a = deriveClaimUuid('abc');
  const b = deriveClaimUuid('abc');
  const c = deriveClaimUuid('xyz');
  ok('deterministic: same key → same uuid', a === b);
  ok('different key → different uuid', a !== c);
  ok('canonical UUID shape', /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), a);
  ok('empty key → empty string', deriveClaimUuid('') === '');
}

function applyTests() {
  console.log('\n--- apply: happy path ---');
  const set = [citable('cit_1', 'k1'), citable('cit_2', 'k2')];

  const r1 = applyCitations('Foo <citation ref="cit_1">bar</citation> baz.', set);
  ok('one tag → one reference', r1.references.length === 1);
  ok('seq starts at 1', r1.references[0].seq === 1);
  ok('ref rewritten to uuid', r1.prose.includes(`ref="${set[0].uuid}"`), r1.prose);
  ok('seq attribute present', r1.prose.includes('seq="1"'), r1.prose);
  ok('inner text preserved', r1.prose.includes('>bar</citation>'), r1.prose);
  ok('spacing preserved around tag', r1.prose.startsWith('Foo <citation') && r1.prose.endsWith('</citation> baz.'), r1.prose);
  ok('stats tags_found=1', r1.stats.tags_found === 1);
  ok('stats tags_validated=1', r1.stats.tags_validated === 1);

  console.log('\n--- §11: handle not in citable set → strip markup, keep text ---');
  const r2 = applyCitations('A <citation ref="cit_9">claimy text</citation> B', set);
  ok('invalid handle dropped', r2.references.length === 0);
  ok('inner text kept', r2.prose === 'A claimy text B', r2.prose);
  ok('refs_dropped counted', r2.stats.refs_dropped === 1);

  console.log('\n--- §11: malformed / unclosed tag → strip markup, keep text ---');
  const r3 = applyCitations('X <citation ref="cit_1">no close here and more', set);
  ok('unclosed tag markup stripped', !r3.prose.includes('<citation'), r3.prose);
  ok('text after open tag kept', r3.prose.includes('no close here and more'), r3.prose);
  ok('no reference built for unclosed', r3.references.length === 0);

  console.log('\n--- §11: nested tags → inner markup stripped ---');
  const r4 = applyCitations('<citation ref="cit_1">outer <citation ref="cit_2">inner</citation></citation>', set);
  ok('exactly one reference (outer wins)', r4.references.length === 1, r4.references);
  ok('no leftover nested open markup', (r4.prose.match(/<citation/g) || []).length === 1, r4.prose);
  ok('inner text retained', r4.prose.includes('outer') && r4.prose.includes('inner'), r4.prose);

  console.log('\n--- §11: no citable set → all tags stripped ---');
  const r5 = applyCitations('Hello <citation ref="cit_1">world</citation>!', []);
  ok('prose has no citation markup', r5.prose === 'Hello world!', r5.prose);
  ok('no references', r5.references.length === 0);

  console.log('\n--- §11: same claim cited N times → one reference, N markers, same uuid/seq ---');
  const r6 = applyCitations(
    'First <citation ref="cit_1">a</citation> then <citation ref="cit_1">b</citation>.',
    set
  );
  ok('single reference for repeated claim', r6.references.length === 1);
  ok('two in-text markers', (r6.prose.match(/<citation/g) || []).length === 2, r6.prose);
  ok('both markers same seq=1', (r6.prose.match(/seq="1"/g) || []).length === 2, r6.prose);

  console.log('\n--- §11: ref="cit_1 cit_2" multi-source, one invalid → keep valid ---');
  const r7 = applyCitations('<citation ref="cit_1 cit_99">multi</citation>', set);
  ok('one valid uuid kept', r7.prose.includes(`ref="${set[0].uuid}"`), r7.prose);
  ok('invalid sibling dropped (single ref)', !r7.prose.includes(' cit_99'), r7.prose);
  ok('one reference', r7.references.length === 1);
  ok('refs_dropped=1', r7.stats.refs_dropped === 1);

  const r7b = applyCitations('<citation ref="cit_1 cit_2">both</citation>', set);
  ok('two-source tag → two uuids in ref', r7b.prose.includes(`ref="${set[0].uuid} ${set[1].uuid}"`), r7b.prose);
  ok('two-source tag → seq "1 2"', r7b.prose.includes('seq="1 2"'), r7b.prose);
  ok('two references', r7b.references.length === 2);

  console.log('\n--- §11: refuted is citable, rendered as contradiction ---');
  const refutedSet = [citable('cit_1', 'kr', { verdict: 'refuted' })];
  const r8 = applyCitations('Contrary to belief, <citation ref="cit_1">X is false</citation>.', refutedSet);
  ok('refuted reference kept', r8.references.length === 1 && r8.references[0].verdict === 'refuted');

  console.log('\n--- robustness: private-use sentinel chars in prose do not corrupt output ---');
  const SENT = String.fromCharCode(0xe000) + '0' + String.fromCharCode(0xe001);
  const rSent = applyCitations(`Pre ${SENT} mid <citation ref="cit_1">bar</citation> end`, set);
  ok('stray sentinel stripped from output', !rSent.prose.includes(String.fromCharCode(0xe000)), JSON.stringify(rSent.prose));
  ok('citation still resolved correctly', rSent.prose.includes(`ref="${set[0].uuid}"`) && rSent.references.length === 1, rSent.prose);
  ok('surrounding text preserved', rSent.prose.includes('Pre') && rSent.prose.includes('mid') && rSent.prose.includes('end'));

  console.log('\n--- §11: citable but never referenced → omitted from references ---');
  const r9 = applyCitations('No citations at all here.', set);
  ok('unused citables omitted', r9.references.length === 0);
  ok('prose unchanged', r9.prose === 'No citations at all here.');

  console.log('\n--- dense renumber by first appearance ---');
  const set3 = [citable('cit_1', 'k1'), citable('cit_2', 'k2'), citable('cit_3', 'k3')];
  // Reference cit_2 first, then cit_1 — seq should be assigned by appearance.
  const r10 = applyCitations('<citation ref="cit_2">two</citation> <citation ref="cit_1">one</citation>', set3);
  ok('first-appearing claim gets seq 1', r10.references.find((x) => x.claim_key === 'k2').seq === 1, r10.references);
  ok('second-appearing claim gets seq 2', r10.references.find((x) => x.claim_key === 'k1').seq === 2, r10.references);
  ok('seqs dense (1,2) with no gap', r10.references.map((x) => x.seq).sort().join(',') === '1,2');

  console.log('\n--- reference record carries full schema ---');
  const ref = r1.references[0];
  ok('has uuid', typeof ref.uuid === 'string' && ref.uuid.length === 36);
  ok('has claim_key', ref.claim_key === 'k1');
  ok('has claim_text', !!ref.claim_text);
  ok('has verdict', ref.verdict === 'supported');
  ok('has verification_level', ref.verification_level === 'verified');
  ok('has verification_confidence', typeof ref.verification_confidence === 'number');
  ok('has sources array', Array.isArray(ref.sources) && ref.sources[0].url === 'https://example.com');
  ok('source carries supporting_span', ref.sources[0].supporting_span === 'span');
}

function buildCitableSetTests() {
  console.log('\n--- build-citable-set: fresh verify ---');
  const verify = {
    results: [
      { claim_key: 'k1', claim_text: 'Saturn has rings.', verdict: 'supported', verification_status: 'verified_supported',
        sources: [{ url: 'https://nasa.gov', extracted_title: 'NASA', verification: { quoted_excerpt: 'rings exist' } }] },
      { claim_key: 'k2', claim_text: 'Maybe.', verdict: 'inconclusive', verification_status: 'verified_inconclusive', sources: [] },
      { claim_key: 'k3', claim_text: 'Common myth is false.', verdict: 'refuted', verification_status: 'verified_refuted', sources: [] },
    ],
  };
  const set = buildCitableSet({ citationVerifyResult: verify });
  ok('only citable verdicts included (supported+refuted)', set.length === 2, set.map((s) => s.claim_key));
  ok('handles assigned cit_1..', set[0].handle === 'cit_1' && set[1].handle === 'cit_2');
  ok('inconclusive excluded', !set.find((s) => s.claim_key === 'k2'));
  ok('uuid derived from claim_key', set[0].uuid === deriveClaimUuid('k1'));
  ok('verify span mapped from quoted_excerpt', set[0].sources[0].supporting_span === 'rings exist');
  ok('source title from extracted_title', set[0].sources[0].title === 'NASA');

  console.log('\n--- build-citable-set: recalled ---');
  const recall = {
    results: [
      { claim_text: 'Recalled fact.', claim_key: 'r1',
        recall: { hit: true, verdict: 'supported', verification_level: 'verified', verification_confidence: 0.9,
                  citation_path: 'citations/2026-05/r1.json',
                  sources: [{ url: 'https://src', title: 'Src', supporting_span: 's' }] } },
      { claim_text: 'Provisional miss.', claim_key: 'r2',
        recall: { hit: true, verdict: 'supported', verification_level: 'provisional' } },
      { claim_text: 'No hit.', claim_key: 'r3', recall: { hit: false } },
    ],
  };
  const rset = buildCitableSet({ memoryRecallResult: recall });
  ok('only verified recall hit included', rset.length === 1 && rset[0].claim_key === 'r1');
  ok('recall carries citation_path', rset[0].citation_path === 'citations/2026-05/r1.json');

  console.log('\n--- build-citable-set: dedupe fresh over recalled ---');
  const both = buildCitableSet({
    citationVerifyResult: { results: [{ claim_key: 'dup', claim_text: 'Fresh.', verdict: 'supported', verification_status: 'verified_supported', sources: [] }] },
    memoryRecallResult: { results: [{ claim_key: 'dup', claim_text: 'Recalled.', recall: { hit: true, verdict: 'supported', verification_level: 'verified' } }] },
  });
  ok('deduped to one entry', both.length === 1);
  ok('fresh wins', both[0].claim_text === 'Fresh.');

  console.log('\n--- build-citable-set: empty inputs ---');
  ok('no inputs → empty set', buildCitableSet().length === 0);
  ok('empty results → empty set', buildCitableSet({ citationVerifyResult: { results: [] } }).length === 0);
}

function main() {
  console.log('========================================');
  console.log('citation core (pure) test');
  console.log('========================================');
  idTests();
  applyTests();
  buildCitableSetTests();
  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
