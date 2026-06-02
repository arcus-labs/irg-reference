/**
 * Tests for the citation fetcher.
 *
 * Spins up a localhost HTTP server that serves fixture responses, then
 * exercises the full fetcher pipeline: fetch → save HTML → extract
 * markdown → update citation JSON in place.
 *
 * Covers:
 *   - successful fetch + Readability extraction
 *   - HTTP 404 → error captured on source
 *   - timeout → error captured
 *   - max-bytes cap → error captured
 *   - redirects followed
 *   - citation JSON updated with retrieval metadata
 *   - HTML and markdown files written to expected locations
 */

'use strict';

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-store-fetcher-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const {
  fetchUrl,
  fetchCitationSources,
  fetchManyCitations,
} = require('../core/external-fact-check/fetcher');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');

let passed = 0;
let failed = 0;

function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

// ---------------------------------------------------------------------------
// Local HTTP fixture server
// ---------------------------------------------------------------------------

const ARTICLE_HTML = `<!doctype html>
<html><head><title>Saturn's Rings: A Brief Overview</title></head>
<body>
  <nav>Skip me</nav>
  <article>
    <h1>Saturn's Rings: A Brief Overview</h1>
    <p>Saturn's rings are one of the most spectacular features in the solar system. They are composed primarily of ice particles ranging from tiny grains to chunks several meters across.</p>
    <p>Astronomers have studied them since Galileo first observed them in 1610, though he initially thought they were moons.</p>
    <p>The rings are remarkably thin — only about 10 meters thick in places — and extend over 280,000 kilometers from the planet.</p>
  </article>
  <footer>Skip me</footer>
</body></html>`;

function startFixtureServer() {
  let timeoutPending = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/article') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ARTICLE_HTML);
      return;
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    if (req.url === '/slow') {
      // Hold the connection open until forcibly closed by the timeout.
      timeoutPending = true;
      // intentionally never call res.end()
      return;
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const chunk = Buffer.alloc(64 * 1024, 'x');
      // 1MB > our 256KB test cap below
      const total = 16;
      let sent = 0;
      const interval = setInterval(() => {
        if (sent >= total) { clearInterval(interval); res.end(); return; }
        res.write(chunk);
        sent++;
      }, 5);
      return;
    }
    if (req.url === '/redirect1') {
      res.writeHead(302, { Location: '/redirect2' });
      res.end();
      return;
    }
    if (req.url === '/redirect2') {
      res.writeHead(302, { Location: '/article' });
      res.end();
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Unexpected URL: ' + req.url);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, timeoutPending }));
  });
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function writeCitation(claimText, sources) {
  const structured = canonicalizeClaim(claimText);
  const citation = {
    claim_key: structured.claim_key,
    created_at: '2026-04-01T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    claim: structured,
    verdict: 'inconclusive',
    confidence: 0.5,
    sources,
    verification_level: 'provisional',
    verification_status: 'suggested_sources_unverified',
    retrieval_mode: 'llm_generated_source_candidates',
    retrieval_deferred: true,
  };
  const dir = path.join(tmpRoot, 'citations', '2026-04');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${structured.claim_key.slice(0, 12)}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(citation, null, 2));
  return { absolute: fullPath, relative: path.relative(tmpRoot, fullPath) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================');
  console.log('Citation fetcher test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  const { server, port } = await startFixtureServer();
  const BASE = `http://127.0.0.1:${port}`;

  try {
    // 1. fetchUrl happy path
    console.log('\n1. fetchUrl happy path');
    const r1 = await fetchUrl(`${BASE}/article`);
    ok('ok = true',                r1.ok === true);
    ok('status 200',                r1.status === 200);
    ok('content-type set',          r1.contentType.includes('text/html'));
    ok('body contains article',     r1.body.includes("Saturn's Rings"));

    // 2. fetchUrl 404
    console.log('\n2. fetchUrl 404');
    const r2 = await fetchUrl(`${BASE}/missing`);
    ok('ok = false',     r2.ok === false);
    ok('status 404',      r2.status === 404);
    ok('error mentions 404', String(r2.error).includes('404'));

    // 3. fetchUrl timeout
    console.log('\n3. fetchUrl timeout');
    const t0 = Date.now();
    const r3 = await fetchUrl(`${BASE}/slow`, { timeoutMs: 300 });
    const elapsed = Date.now() - t0;
    ok('ok = false',             r3.ok === false);
    ok('error mentions timeout',  String(r3.error).toLowerCase().includes('timeout'));
    ok('elapsed near timeout',    elapsed >= 250 && elapsed < 2000, `elapsed=${elapsed}ms`);

    // 4. fetchUrl size cap
    console.log('\n4. fetchUrl size cap');
    const r4 = await fetchUrl(`${BASE}/big`, { maxBytes: 256 * 1024 });
    ok('ok = false',                  r4.ok === false);
    ok('error mentions exceeded',     String(r4.error).toLowerCase().includes('exceeded'));

    // 5. fetchUrl follows redirects
    console.log('\n5. fetchUrl follows redirects');
    const r5 = await fetchUrl(`${BASE}/redirect1`);
    ok('ok = true',                 r5.ok === true);
    ok('redirects recorded',         r5.redirects.length === 2);
    ok('final URL is /article',      r5.finalUrl.endsWith('/article'));
    ok('body is the article',        r5.body.includes("Saturn's Rings"));

    // 6. fetchCitationSources: end-to-end
    console.log('\n6. fetchCitationSources end-to-end');
    const { absolute, relative } = writeCitation(
      "Saturn has rings made of ice.",
      [
        { url: `${BASE}/article`,  title: 'Article',  rank: 1, source_type: 'reference', why: 'authoritative', stance: 'candidate' },
        { url: `${BASE}/missing`,   title: 'Missing',  rank: 2, source_type: 'reference', why: 'maybe',         stance: 'candidate' },
      ]
    );
    const result = await fetchCitationSources(relative);
    ok('fetched = 1 (article)',    result.fetched === 1);
    ok('failed = 1 (missing)',     result.failed === 1);
    ok('skipped = 0',              result.skipped === 0);

    // Re-read the citation; it should now have updated metadata.
    const after = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    ok('retrieval_deferred = false', after.retrieval_deferred === false);
    ok('retrieval_mode updated',     after.retrieval_mode === 'fetched_unverified');
    ok('verification_status updated', after.verification_status === 'candidate_sources_fetched_unverified');
    ok('source 0 retrieved_at set',   typeof after.sources[0].retrieved_at === 'string');
    ok('source 0 source_file set',    typeof after.sources[0].source_file === 'string');
    ok('source 0 markdown_file set',  typeof after.sources[0].markdown_file === 'string');
    ok('source 0 has excerpt',        typeof after.sources[0].relevant_excerpt === 'string'
                                       && after.sources[0].relevant_excerpt.length > 0);
    ok('source 0 has title',          after.sources[0].extracted_title?.includes('Saturn'));
    ok('source 1 has error',          typeof after.sources[1].error === 'string');
    ok('source 1 source_file null',   !after.sources[1].source_file);

    // 7. HTML and markdown files exist on disk
    console.log('\n7. Source files on disk');
    const htmlPath = path.join(tmpRoot, after.sources[0].source_file);
    const mdPath   = path.join(tmpRoot, after.sources[0].markdown_file);
    ok('HTML file exists',     fs.existsSync(htmlPath));
    ok('Markdown file exists', fs.existsSync(mdPath));
    const md = fs.readFileSync(mdPath, 'utf8');
    ok('Markdown mentions Saturn', md.toLowerCase().includes('saturn'));
    ok('Markdown contains paragraph text', md.toLowerCase().includes('ice particles'));

    // 8. fetchManyCitations aggregates
    console.log('\n8. fetchManyCitations aggregates');
    const c2 = writeCitation('Galileo observed the rings in 1610.', [
      { url: `${BASE}/article`, title: 'Same article', rank: 1, source_type: 'reference', why: '', stance: 'candidate' },
    ]);
    const many = await fetchManyCitations([relative, c2.relative]);
    ok('two citations processed', many.citations_processed === 2);
    ok('aggregate fetched >= 2',  many.fetched >= 2);
    ok('duration_ms present',      typeof many.duration_ms === 'number');

    // 9. Empty-sources citation skipped
    console.log('\n9. Empty-sources citation skipped');
    const empty = writeCitation('Mars has two moons.', []);
    const r9 = await fetchCitationSources(empty.relative);
    ok('skipped = 1',  r9.skipped === 1);
    ok('fetched = 0',  r9.fetched === 0);
    ok('failed = 0',    r9.failed === 0);

    // 10. Missing citation file
    console.log('\n10. Missing citation file');
    const r10 = await fetchCitationSources('citations/2026-04/does-not-exist.json');
    ok('error reported',     typeof r10.error === 'string');
    ok('fetched/failed = 0', r10.fetched === 0 && r10.failed === 0);

  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

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
