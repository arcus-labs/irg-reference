'use strict';

/**
 * Citation Source Fetcher
 *
 * Materializes provisional citation candidate sources by HTTP-fetching
 * the candidate URLs, saving the raw HTML, and extracting readable
 * article content as markdown.
 *
 * Inputs:
 *   - A citation record on disk (under _fact-store/citations/YYYY-MM/*.json)
 *     produced by `citation-writer.js`. Each citation has `sources[]`
 *     with `url` populated and `retrieved_at: null`, `source_file: null`.
 *
 * Outputs (filesystem side-effects):
 *   - Raw HTML at      _fact-store/sources/html/<sha-of-url>.html
 *   - Readable markdown at  _fact-store/sources/markdown/<sha-of-url>.md
 *   - Each citation JSON updated in place:
 *       - retrieval_deferred  : false (once at least one source succeeded)
 *       - retrieval_mode      : 'fetched_unverified'
 *       - verification_status : 'candidate_sources_fetched_unverified'
 *       - sources[i].retrieved_at, .source_file, .markdown_file,
 *                    .status_code, .content_type, .redirects[],
 *                    .relevant_excerpt, .error?
 *
 * Verification of whether the source actually supports the claim is
 * deferred to the verifier node (item #9). This fetcher's job is purely
 * mechanical: pull the content, extract it, mark the citation as
 * no-longer-deferred.
 *
 * Safety:
 *   - Per-URL timeout (default 10s)
 *   - Max response size (default 5 MB)
 *   - Max redirects per request (default 5)
 *   - Global concurrency cap (default 4)
 *   - Custom User-Agent identifying the tool
 *
 * NOTE: this implementation does NOT honor robots.txt. Operators
 * deploying this publicly should sit it behind a fetch policy. See
 * SECURITY.md.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const { getFactStorePaths } = require('./config');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_USER_AGENT =
  'ArcusLabs-IRG-Reference/1.0 (+https://github.com/arcus-labs/irg-reference)';
const EXCERPT_LENGTH = 400;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Fetch a single URL with timeout, size cap, and redirect handling.
 * Returns `{ ok, status, contentType, body, redirects, error? }`. Does
 * not throw — failures are reported in the result.
 */
async function fetchUrl(url, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    userAgent = DEFAULT_USER_AGENT,
  } = opts;

  const redirects = [];
  let currentUrl = url;
  let response = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let i = 0; i <= maxRedirects; i++) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      // Handle 3xx redirects manually so we can record them.
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        if (!next) break;
        const resolved = new URL(next, currentUrl).toString();
        redirects.push({ from: currentUrl, to: resolved, status: response.status });
        currentUrl = resolved;
        if (i === maxRedirects) {
          return {
            ok: false,
            status: response.status,
            redirects,
            error: `Too many redirects (>${maxRedirects})`,
          };
        }
        continue;
      }

      break;
    }

    if (!response) {
      return { ok: false, error: 'No response', redirects };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        redirects,
        finalUrl: currentUrl,
        error: `HTTP ${response.status}`,
      };
    }

    // Read body with size cap.
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        ok: false,
        status: response.status,
        contentType,
        redirects,
        finalUrl: currentUrl,
        error: 'No response body',
      };
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return {
          ok: false,
          status: response.status,
          contentType,
          redirects,
          finalUrl: currentUrl,
          error: `Response exceeded ${maxBytes} bytes`,
        };
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks).toString('utf8');
    return {
      ok: true,
      status: response.status,
      contentType,
      finalUrl: currentUrl,
      redirects,
      body,
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      ok: false,
      redirects,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : (err.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract readable article markdown from raw HTML via Readability +
 * Turndown. Returns `{ title?, markdown?, excerpt?, error? }`. Failures
 * (e.g. JS-heavy SPA with no text in initial HTML) produce
 * `{ error: '...' }` and the caller should keep the raw HTML anyway.
 */
function extractMarkdown(html, sourceUrl) {
  try {
    const dom = new JSDOM(html, { url: sourceUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.content) {
      return { error: 'Readability returned no article content' };
    }
    const markdown = turndown.turndown(article.content);
    const text = (article.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      title: article.title || undefined,
      markdown,
      excerpt: text.slice(0, EXCERPT_LENGTH),
    };
  } catch (err) {
    return { error: `Extraction failed: ${err.message}` };
  }
}

function ensureSourceDirs() {
  const paths = getFactStorePaths();
  fs.mkdirSync(paths.htmlDir, { recursive: true });
  fs.mkdirSync(paths.markdownDir, { recursive: true });
  return paths;
}

/**
 * Fetch a single source and write artifacts to disk. Returns an
 * enriched source object (the input merged with retrieval metadata) —
 * caller writes the citation back to disk with the updated sources[].
 */
async function fetchOneSource(source, opts = {}) {
  if (!source?.url) {
    return { ...source, error: 'No URL', retrieved_at: new Date().toISOString() };
  }
  const paths = ensureSourceDirs();
  const hash = urlHash(source.url);
  const htmlPath = path.join(paths.htmlDir, `${hash}.html`);
  const mdPath = path.join(paths.markdownDir, `${hash}.md`);
  const htmlRel = path.relative(paths.factStoreRoot, htmlPath);
  const mdRel = path.relative(paths.factStoreRoot, mdPath);

  const fetchResult = await fetchUrl(source.url, opts);
  const retrievedAt = new Date().toISOString();

  if (!fetchResult.ok) {
    return {
      ...source,
      retrieved_at: retrievedAt,
      status_code: fetchResult.status || null,
      content_type: fetchResult.contentType || null,
      redirects: fetchResult.redirects || [],
      error: fetchResult.error,
    };
  }

  // Save raw HTML.
  try {
    fs.writeFileSync(htmlPath, fetchResult.body, 'utf8');
  } catch (err) {
    return {
      ...source,
      retrieved_at: retrievedAt,
      status_code: fetchResult.status,
      content_type: fetchResult.contentType,
      redirects: fetchResult.redirects,
      error: `Failed to write HTML: ${err.message}`,
    };
  }

  // Extract markdown. If extraction fails we still keep the HTML.
  const extracted = extractMarkdown(fetchResult.body, fetchResult.finalUrl || source.url);
  if (extracted.markdown) {
    try { fs.writeFileSync(mdPath, extracted.markdown, 'utf8'); }
    catch (err) { extracted.error = `Failed to write markdown: ${err.message}`; }
  }

  return {
    ...source,
    retrieved_at: retrievedAt,
    status_code: fetchResult.status,
    content_type: fetchResult.contentType,
    final_url: fetchResult.finalUrl !== source.url ? fetchResult.finalUrl : undefined,
    redirects: fetchResult.redirects,
    source_file: htmlRel,
    markdown_file: extracted.markdown ? mdRel : null,
    extracted_title: extracted.title,
    relevant_excerpt: extracted.excerpt,
    extraction_error: extracted.error,
  };
}

/**
 * Fetch all sources for one citation, update the citation in place on
 * disk, and return a summary for the trace.
 *
 * @param {string} citationPath  absolute or fact-store-relative path
 * @param {Object} [opts]
 * @returns {Promise<{ citation_path, fetched, failed, skipped, sources: Array }>}
 */
async function fetchCitationSources(citationPath, opts = {}) {
  const paths = getFactStorePaths();
  const absolutePath = path.isAbsolute(citationPath)
    ? citationPath
    : path.join(paths.factStoreRoot, citationPath);

  let citation;
  try {
    citation = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (err) {
    return {
      citation_path: citationPath,
      fetched: 0,
      failed: 0,
      skipped: 0,
      error: `Failed to read citation: ${err.message}`,
      sources: [],
    };
  }

  const sources = Array.isArray(citation.sources) ? citation.sources : [];
  if (sources.length === 0) {
    return { citation_path: citationPath, fetched: 0, failed: 0, skipped: 1, sources: [] };
  }

  // Fetch with concurrency limit.
  const updated = new Array(sources.length);
  const concurrency = Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= sources.length) return;
      updated[i] = await fetchOneSource(sources[i], opts);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const fetched = updated.filter((s) => !s.error && s.source_file).length;
  const failed = updated.filter((s) => s.error).length;

  // Write the citation back with updated sources + status fields.
  citation.sources = updated;
  if (fetched > 0) {
    citation.retrieval_deferred = false;
    citation.retrieval_mode = 'fetched_unverified';
    citation.verification_status = 'candidate_sources_fetched_unverified';
    citation.fetched_at = new Date().toISOString();
  }
  try {
    fs.writeFileSync(absolutePath, JSON.stringify(citation, null, 2), 'utf8');
  } catch (err) {
    return {
      citation_path: citationPath,
      fetched,
      failed,
      skipped: 0,
      error: `Failed to write updated citation: ${err.message}`,
      sources: updated,
    };
  }

  return {
    citation_path: citationPath,
    claim_key: citation.claim_key,
    fetched,
    failed,
    skipped: 0,
    sources: updated,
  };
}

/**
 * Fetch sources for many citations at once. Citations themselves run
 * sequentially (so per-citation writes don't race); fetches WITHIN a
 * citation run in parallel up to the concurrency cap.
 */
async function fetchManyCitations(citationPaths, opts = {}) {
  const startMs = Date.now();
  const results = [];
  for (const p of citationPaths) {
    results.push(await fetchCitationSources(p, opts));
  }
  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + (r.error ? 1 : 0),
    }),
    { fetched: 0, failed: 0, skipped: 0, errors: 0 }
  );
  return {
    citations_processed: results.length,
    ...totals,
    duration_ms: Date.now() - startMs,
    results,
  };
}

module.exports = {
  fetchUrl,
  extractMarkdown,
  fetchOneSource,
  fetchCitationSources,
  fetchManyCitations,
  urlHash,
  // exposed for tests
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_CONCURRENCY,
};
