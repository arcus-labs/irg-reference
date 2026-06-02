/**
 * Tests for the ClaimReview projection (core/external-fact-check/claimreview.js)
 * and the `fact-store export` CLI subcommand.
 *
 * The projection is PURE (no I/O) and part of the cross-language conformance
 * corpus, so the unit tests pin down the exact JSON-LD shape. The CLI test
 * spawns the real binary against a tmp store to exercise arg-parsing,
 * file walking, stdout/stderr separation, and exit codes.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  verdictToRating,
  toClaimReview,
  toClaimReviewCollection,
  REVIEW_RATING,
} = require('../core/external-fact-check/claimreview');

const CLI = path.resolve(__dirname, '..', 'scripts', 'fact-store.js');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCitation(over = {}) {
  return {
    claim_key: 'abc123',
    created_at: '2026-04-01T12:00:00.000Z',
    verified_at: '2026-04-02T08:30:00.000Z',
    claim: { raw_text: 'Saturn has rings.' },
    verdict: 'supported',
    verification_level: 'verified',
    confidence: 0.9,
    sources: [
      { url: 'https://nasa.gov/saturn', title: 'NASA' },
      { url: 'https://example.com/rings' },
    ],
    citation_path: 'citations/2026-04/abc123-xyz.json',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

function unitTests() {
  console.log('\n--- verdictToRating ---');
  const sup = verdictToRating('supported');
  ok('supported → ratingValue 5', sup.ratingValue === 5);
  ok('supported → alternateName True', sup.alternateName === 'True');
  ok('supported → @type Rating', sup['@type'] === 'Rating');
  ok('bestRating 5 / worstRating 1', sup.bestRating === 5 && sup.worstRating === 1);

  const ref = verdictToRating('refuted');
  ok('refuted → ratingValue 1', ref.ratingValue === 1);
  ok('refuted → alternateName False', ref.alternateName === 'False');

  const inc = verdictToRating('inconclusive');
  ok('inconclusive → ratingValue 3', inc.ratingValue === 3);
  ok('inconclusive → alternateName Unproven', inc.alternateName === 'Unproven');

  const unknown = verdictToRating('banana');
  ok('unknown verdict falls back to Unproven', unknown.alternateName === 'Unproven' && unknown.ratingValue === 3);

  ok('REVIEW_RATING export present', REVIEW_RATING && REVIEW_RATING.supported.ratingValue === 5);

  console.log('\n--- toClaimReview ---');
  const cr = toClaimReview(makeCitation());
  ok('@type ClaimReview', cr['@type'] === 'ClaimReview');
  ok('claimReviewed from claim.raw_text', cr.claimReviewed === 'Saturn has rings.');
  ok('reviewRating present', cr.reviewRating.ratingValue === 5);
  ok('default author Organization', cr.author['@type'] === 'Organization');
  ok('itemReviewed @type Claim', cr.itemReviewed['@type'] === 'Claim');
  ok('appearance has 2 CreativeWorks', cr.itemReviewed.appearance.length === 2);
  ok('appearance entries typed', cr.itemReviewed.appearance[0]['@type'] === 'CreativeWork');
  ok('appearance url preserved', cr.itemReviewed.appearance[0].url === 'https://nasa.gov/saturn');
  ok('datePublished prefers verified_at, sliced to date', cr.datePublished === '2026-04-02');
  ok('url from citation_path', cr.url === 'citations/2026-04/abc123-xyz.json');

  // Fallbacks
  const cr2 = toClaimReview({ claim_text: 'flat text claim', verdict: 'refuted', created_at: '2026-01-05T00:00:00Z' });
  ok('claim_text fallback used', cr2.claimReviewed === 'flat text claim');
  ok('datePublished falls back to created_at', cr2.datePublished === '2026-01-05');
  ok('no sources → no appearance key', !('appearance' in cr2.itemReviewed));
  ok('refuted rating 1', cr2.reviewRating.ratingValue === 1);

  const cr3 = toClaimReview({});
  ok('empty citation → empty claimReviewed string', cr3.claimReviewed === '');
  ok('empty citation → no datePublished', !('datePublished' in cr3));
  ok('empty citation → no url', !('url' in cr3));

  // Author override
  const cr4 = toClaimReview(makeCitation(), { author: { '@type': 'Organization', name: 'Custom' } });
  ok('author override applied', cr4.author.name === 'Custom');

  // Filters out non-string / empty source urls
  const cr5 = toClaimReview(makeCitation({ sources: [{ url: '' }, { url: null }, { title: 'no url' }, { url: 'https://ok.test' }] }));
  ok('only valid source urls become appearances', cr5.itemReviewed.appearance.length === 1 && cr5.itemReviewed.appearance[0].url === 'https://ok.test');

  console.log('\n--- toClaimReviewCollection ---');
  const verified = makeCitation();
  const provisional = makeCitation({ verification_level: 'provisional', verdict: 'inconclusive', claim: { raw_text: 'Maybe true.' } });

  const docDefault = toClaimReviewCollection([verified, provisional]);
  ok('@context schema.org', docDefault['@context'] === 'https://schema.org');
  ok('@graph is array', Array.isArray(docDefault['@graph']));
  ok('default excludes provisional', docDefault['@graph'].length === 1);
  ok('verified one survives', docDefault['@graph'][0].claimReviewed === 'Saturn has rings.');

  const docInclusive = toClaimReviewCollection([verified, provisional], { includeProvisional: true });
  ok('include-provisional yields 2', docInclusive['@graph'].length === 2);

  const docEmpty = toClaimReviewCollection([]);
  ok('empty input → empty @graph', docEmpty['@graph'].length === 0);

  const docNonArray = toClaimReviewCollection(null);
  ok('non-array input tolerated', Array.isArray(docNonArray['@graph']) && docNonArray['@graph'].length === 0);
}

// ---------------------------------------------------------------------------
// CLI test
// ---------------------------------------------------------------------------

function writeCitationFile(root, sub, citation) {
  const dir = path.join(root, 'citations', sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${(citation.claim_key || 'c').slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(citation, null, 2));
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, FACT_STORE_ROOT: root },
    encoding: 'utf8',
  });
}

function cliTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claimreview-cli-test-'));
  try {
    console.log('\n--- CLI: empty store ---');
    const rEmpty = runCli(tmpRoot, ['export']);
    ok('exit 0 on empty store', rEmpty.status === 0);
    const emptyDoc = (() => { try { return JSON.parse(rEmpty.stdout); } catch { return null; } })();
    ok('stdout is valid JSON-LD', emptyDoc !== null);
    ok('empty @graph', emptyDoc && Array.isArray(emptyDoc['@graph']) && emptyDoc['@graph'].length === 0);
    ok('summary went to stderr', rEmpty.stderr.includes('[export]'));

    console.log('\n--- CLI: seeded store ---');
    writeCitationFile(tmpRoot, '2026-04', makeCitation({ claim_key: 'sat1' }));
    writeCitationFile(tmpRoot, '2026-04', makeCitation({
      claim_key: 'prov1',
      verification_level: 'provisional',
      verdict: 'inconclusive',
      claim: { raw_text: 'Provisional claim.' },
    }));

    const rDefault = runCli(tmpRoot, ['export']);
    ok('exit 0', rDefault.status === 0);
    const doc = JSON.parse(rDefault.stdout);
    ok('verified-only by default → 1 entry', doc['@graph'].length === 1);
    ok('stdout contains no summary noise', !rDefault.stdout.includes('[export]'));

    console.log('\n--- CLI: --include-provisional ---');
    const rIncl = runCli(tmpRoot, ['export', '--include-provisional']);
    const docIncl = JSON.parse(rIncl.stdout);
    ok('exit 0', rIncl.status === 0);
    ok('2 entries with provisional', docIncl['@graph'].length === 2);

    console.log('\n--- CLI: --out file ---');
    const outFile = path.join(tmpRoot, 'out.jsonld');
    const rOut = runCli(tmpRoot, ['export', '--out', outFile]);
    ok('exit 0', rOut.status === 0);
    ok('stdout empty when --out used', rOut.stdout.trim() === '');
    ok('file written', fs.existsSync(outFile));
    const fileDoc = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    ok('file is valid JSON-LD', fileDoc['@context'] === 'https://schema.org');
    ok('summary mentions out path', rOut.stderr.includes('out.jsonld'));

    console.log('\n--- CLI: bad --format ---');
    const rBad = runCli(tmpRoot, ['export', '--format', 'rdf']);
    ok('exit 2 usage error', rBad.status === 2);
    ok('mentions invalid format', rBad.stderr.toLowerCase().includes('format'));

    console.log('\n--- CLI: --help ---');
    const rHelp = runCli(tmpRoot, ['export', '--help']);
    ok('exit 0', rHelp.status === 0);
    ok('help mentions claimreview', rHelp.stdout.toLowerCase().includes('claimreview'));

    console.log('\n--- CLI: root help lists export ---');
    const rRoot = runCli(tmpRoot, ['--help']);
    ok('root help mentions export', rRoot.stdout.includes('export'));

    console.log('\n--- CLI: --json summary ---');
    const rJson = runCli(tmpRoot, ['export', '--json']);
    ok('exit 0', rJson.status === 0);
    const summary = (() => { try { return JSON.parse(rJson.stderr); } catch { return null; } })();
    ok('json summary on stderr', summary !== null);
    ok('summary.exported = 1', summary && summary.exported === 1);
    ok('summary.scanned = 2', summary && summary.scanned === 2);

    console.log('\n--- CLI: tolerates a corrupt citation file ---');
    fs.writeFileSync(path.join(tmpRoot, 'citations', '2026-04', 'broken.json'), '{ not valid json');
    const rCorrupt = runCli(tmpRoot, ['export', '--json']);
    ok('exit 0 despite corrupt file', rCorrupt.status === 0);
    const corruptSummary = (() => { try { return JSON.parse(rCorrupt.stderr); } catch { return null; } })();
    ok('parse_errors counted', corruptSummary && corruptSummary.parse_errors === 1);
    ok('still exports the good one', corruptSummary && corruptSummary.exported === 1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

function main() {
  console.log('========================================');
  console.log('ClaimReview projection + export CLI test');
  console.log('========================================');

  unitTests();
  cliTests();

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
