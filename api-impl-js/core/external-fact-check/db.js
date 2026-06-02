'use strict';

/**
 * Fact-Store Query Layer (DuckDB)
 *
 * An in-memory DuckDB instance that exposes the filesystem fact-store
 * as queryable tables. The filesystem remains the source of truth; this
 * module only reads. Views over the JSON files under _fact-store/ are
 * created lazily on the first query and re-evaluated on subsequent
 * queries (so newly-written artifacts show up automatically).
 *
 * Design notes:
 *   - Singleton connection per process. Initialized lazily.
 *   - In-memory only — no persistent .duckdb file to manage.
 *   - Graceful degradation: every query returns `null` (or an empty
 *     result) if DuckDB or the fact-store can't be initialized. The
 *     calling code should fall back to its prior behavior.
 *   - Each artifact JSON contains multiple claims, so views use UNNEST
 *     to flatten one row per claim.
 */

const fs = require('fs');
const path = require('path');
const { getFactStorePaths, EXPIRY_DEFAULTS } = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;

let duckdbModule = null;
let initPromise = null;
let connection = null;
let initFailed = false;
let viewsReady = false;
let hasClaimsView = false;
let hasCitationsView = false;

/**
 * Fact-store query failure. Thrown when DuckDB itself fails — i.e. the
 * native binding can't load, the in-memory database can't be created,
 * a view can't be built, or a query errors out.
 *
 * NOT thrown for "the fact-store has no data yet" — that's a normal
 * state that returns empty results.
 */
class FactStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FactStoreError';
    if (cause) this.cause = cause;
  }
}

function loadDuckDb() {
  if (duckdbModule) return duckdbModule;
  try {
    duckdbModule = require('@duckdb/node-api');
    return duckdbModule;
  } catch (err) {
    initFailed = true;
    throw new FactStoreError(
      `@duckdb/node-api is required for fact-store queries but failed to load: ${err.message}. ` +
      `Run \`npm install\` in api-impl-js/, or set LLM_PROVIDERS_ENABLED/graph choices that do not use the fact-store.`,
      err
    );
  }
}

async function init() {
  if (connection) return connection;
  if (initFailed) {
    throw new FactStoreError('Fact-store DB previously failed to initialize.');
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const duckdb = loadDuckDb();
    try {
      const instance = await duckdb.DuckDBInstance.create(':memory:');
      connection = await instance.connect();
      return connection;
    } catch (err) {
      initFailed = true;
      throw new FactStoreError(`DuckDB initialization failed: ${err.message}`, err);
    }
  })();

  return initPromise;
}

/**
 * Create (or recreate) the views over the JSON files. Called lazily by
 * each query so that newly-added artifacts are picked up without
 * requiring a process restart.
 *
 * The views are cheap to create — DuckDB does not materialize them.
 */
async function ensureViews() {
  const conn = await init();

  const paths = getFactStorePaths();

  // "No data yet" is NOT an error — return false so callers can treat
  // it as an empty store. Real errors (DuckDB failure, broken JSON,
  // bad SQL) throw via init() and runQuery().
  const claimsExists = directoryHasJson(paths.claimsDir);
  const citationsExists = directoryHasJson(paths.citationDir);
  if (!claimsExists && !citationsExists) return false;

  // Always (re)create the views so newly-written files are seen.
  // We do this even when viewsReady is true — DROP+CREATE on views is
  // cheap because they're not materialized.
  try {
    hasClaimsView = false;
    hasCitationsView = false;

    if (claimsExists) {
      const claimsGlob = path.join(paths.claimsDir, '**', '*.json').replace(/\\/g, '/');
      await conn.run(`
        CREATE OR REPLACE VIEW claim_artifacts AS
        SELECT
          generated_at,
          source_node,
          iteration,
          original_query,
          summary,
          confidence,
          critical_claim_count,
          critical_claims
        FROM read_json_auto('${claimsGlob}',
                            ignore_errors = true,
                            union_by_name = true);
      `);

      // Flatten: one row per claim. Each artifact has critical_claims[]
      // where each entry has claim_key, claim_text, importance, etc.
      // The `embedding.*` fields are exposed for semantic recall;
      // older claim artifacts (pre-item-#11) lack them and surface as
      // NULL via union_by_name.
      await conn.run(`
        CREATE OR REPLACE VIEW claims AS
        SELECT
          ca.generated_at,
          ca.source_node,
          ca.iteration,
          ca.original_query,
          c.claim_key                                  AS claim_key,
          c.claim_text                                 AS claim_text,
          c.importance                                 AS importance,
          c.assessment                                 AS assessment,
          c.structured_claim.domain                    AS domain,
          c.structured_claim.claim_kind                AS claim_kind,
          c.structured_claim.subject                   AS subject,
          c.structured_claim.predicate                 AS predicate,
          c.structured_claim.object                    AS object,
          c.structured_claim.domain_confidence         AS domain_confidence,
          c.structured_claim.claim_kind_confidence     AS claim_kind_confidence,
          c.embedding.model                            AS embedding_model,
          c.embedding.dim                              AS embedding_dim,
          c.embedding.vector                           AS embedding_vector,
          -- Explicit CAST so DuckDB does not infer these as JSON type
          -- when every input artifact has inferred_domain set to null
          -- (e.g. claims written by the sync writer or before item #12).
          CAST(c.inferred_domain.domain AS VARCHAR)     AS inferred_domain,
          CAST(c.inferred_domain.confidence AS DOUBLE)  AS inferred_domain_confidence,
          CAST(c.inferred_domain.source AS VARCHAR)     AS inferred_domain_source,
          CAST(c.inferred_domain.model AS VARCHAR)      AS inferred_domain_model
        FROM claim_artifacts ca,
             UNNEST(ca.critical_claims) AS t(c);
      `);
      hasClaimsView = true;
    }

    if (citationsExists) {
      const citationsGlob = path.join(paths.citationDir, '**', '*.json').replace(/\\/g, '/');
      await conn.run(`
        CREATE OR REPLACE VIEW citations AS
        SELECT
          claim_key,
          created_at,
          expires_at,
          verdict,
          verification_level,
          verification_status,
          retrieval_mode,
          retrieval_deferred,
          confidence,
          length(sources)                            AS source_count,
          claim.domain                               AS domain,
          claim.subject                              AS subject,
          claim.predicate                            AS predicate,
          claim.object                               AS object,
          claim.raw_text                             AS claim_text,
          filename                                   AS source_file
        FROM read_json_auto('${citationsGlob}',
                            ignore_errors = true,
                            union_by_name = true,
                            filename = true);
      `);
      hasCitationsView = true;
    }

    viewsReady = true;
    return true;
  } catch (err) {
    initFailed = true;
    throw new FactStoreError(`DuckDB view creation failed: ${err.message}`, err);
  }
}

function directoryHasJson(dir) {
  if (!fs.existsSync(dir)) return false;
  // Check at the top level for any subdirectory or .json — full glob is
  // checked by DuckDB. We only need to know whether to bother.
  try {
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * @returns {boolean} true if DuckDB is loaded AND at least one fact-store
 *   directory has content. Synchronous so callers can decide quickly
 *   whether to await full init.
 */
function isAvailable() {
  if (initFailed) return false;
  const paths = getFactStorePaths();
  return directoryHasJson(paths.claimsDir) || directoryHasJson(paths.citationDir);
}

async function runQuery(sql, paramsOrName) {
  if (!await ensureViews()) return null; // no data — caller treats as empty
  try {
    const result = paramsOrName !== undefined
      ? await connection.run(sql, paramsOrName)
      : await connection.run(sql);
    return await result.getRowObjects();
  } catch (err) {
    throw new FactStoreError(`DuckDB query failed: ${err.message}`, err);
  }
}

/**
 * Exact match by claim_key. Returns the most recently created matching
 * citation row, or null.
 */
async function lookupCitationByClaimKey(claimKey) {
  if (!claimKey) return null;
  if (!await ensureViews()) return null;
  if (!hasCitationsView) return null;
  const rows = await runQuery(`
    SELECT * FROM citations
    WHERE claim_key = ?
    ORDER BY created_at DESC
    LIMIT 1;
  `, [claimKey]);
  return rows && rows.length ? rows[0] : null;
}

/**
 * Narrow the candidate set for partial / fuzzy matching to citations
 * in the same domain. Returns at most `limit` rows ordered by recency.
 * Caller does its own scoring in JS.
 */
async function listCitationCandidatesByDomain(domain, limit = 200) {
  if (!domain) return [];
  if (!await ensureViews()) return [];
  if (!hasCitationsView) return [];
  const rows = await runQuery(`
    SELECT * FROM citations
    WHERE domain = ?
    ORDER BY created_at DESC
    LIMIT ?;
  `, [domain, limit]);
  return rows || [];
}

/**
 * All citations whose expires_at is older than `now`. Used by the
 * expiry sweep (item #5).
 *
 * Note: DuckDB auto-detects `expires_at` (an ISO-8601 string in the
 * source JSON) as TIMESTAMP, so we compare against a TIMESTAMP literal.
 */
async function listExpiredCitations(now = new Date().toISOString()) {
  if (!await ensureViews()) return [];
  if (!hasCitationsView) return [];
  const rows = await runQuery(`
    SELECT claim_key, source_file, expires_at, domain
    FROM citations
    WHERE expires_at IS NOT NULL AND expires_at < CAST(? AS TIMESTAMP);
  `, [now]);
  return rows || [];
}

/**
 * Given a list of candidate claim_keys, return the subset that are
 * already present in the fact-store AND not expired (per the
 * per-domain `EXPIRY_DEFAULTS`).
 *
 * Used by the write-path dedup logic to decide whether a new claim
 * artifact is worth persisting.
 *
 * Returns an empty Set if the fact-store has no claims yet.
 *
 * @param {string[]} claimKeys
 * @param {number}   [now]    epoch ms used as the "now" anchor for freshness
 * @returns {Promise<Set<string>>}
 */
async function findFreshClaimKeys(claimKeys, now = Date.now()) {
  if (!claimKeys || claimKeys.length === 0) return new Set();
  if (!await ensureViews()) return new Set();
  if (!hasClaimsView) return new Set();

  const placeholders = claimKeys.map(() => '?').join(', ');
  // Cast the TIMESTAMP back to VARCHAR so we get a stable ISO-ish
  // string regardless of which DuckDB JS binding version is in use.
  // (Some versions return Date, some return BigInt microseconds.
  // VARCHAR via STRFTIME is parseable everywhere.)
  const rows = await runQuery(`
    SELECT claim_key, domain,
           STRFTIME(MAX(generated_at), '%Y-%m-%dT%H:%M:%S.%gZ') AS generated_at_str
    FROM claims
    WHERE claim_key IN (${placeholders})
    GROUP BY claim_key, domain;
  `, claimKeys);

  if (!rows) return new Set();

  const fresh = new Set();
  for (const row of rows) {
    const expiryDays = EXPIRY_DEFAULTS[row.domain] || EXPIRY_DEFAULTS.other;
    const generatedAtMs = Date.parse(String(row.generated_at_str || ''));
    if (Number.isFinite(generatedAtMs) && (generatedAtMs + expiryDays * DAY_MS) > now) {
      fresh.add(row.claim_key);
    }
  }
  return fresh;
}

/**
 * General-purpose claim listing for CLI / inspection use.
 *
 * Filters are AND'd together. Returns at most `limit` rows ordered by
 * `generated_at` DESC.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.domain]   filter to a single domain
 * @param {string}  [opts.since]    ISO-8601; only claims generated >= this
 * @param {number}  [opts.limit=50]
 */
async function listClaims({ domain, since, limit = 50 } = {}) {
  if (!await ensureViews()) return [];
  if (!hasClaimsView) return [];

  const where = [];
  const params = [];
  if (domain) { where.push('domain = ?'); params.push(domain); }
  if (since)  { where.push('generated_at >= CAST(? AS TIMESTAMP)'); params.push(since); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const rows = await runQuery(`
    SELECT generated_at, domain, claim_kind, claim_text, claim_key, source_node, iteration
    FROM claims
    ${whereSql}
    ORDER BY generated_at DESC
    LIMIT ?;
  `, params);
  return rows || [];
}

/**
 * General-purpose citation listing for CLI / inspection use.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.domain]
 * @param {boolean} [opts.expired]      include only expired (default: include all)
 * @param {boolean} [opts.provisional]  include only verification_level='provisional'
 * @param {string}  [opts.since]        ISO-8601; only created_at >= this
 * @param {number}  [opts.limit=50]
 */
async function listCitations({ domain, expired, provisional, since, limit = 50 } = {}) {
  if (!await ensureViews()) return [];
  if (!hasCitationsView) return [];

  const where = [];
  const params = [];
  if (domain) { where.push('domain = ?'); params.push(domain); }
  if (since)  { where.push('created_at >= CAST(? AS TIMESTAMP)'); params.push(since); }
  if (expired) {
    where.push('expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP');
  }
  if (provisional) {
    where.push("verification_level = 'provisional'");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const rows = await runQuery(`
    SELECT created_at, expires_at, domain, verification_level, verification_status,
           source_count, claim_key, claim_text, source_file
    FROM citations
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?;
  `, params);
  return rows || [];
}

/**
 * Return all claims (or domain-filtered subset) that have an
 * embedding vector attached. Used by the memory-recall semantic
 * neighbor search. Latest entry per claim_key is returned.
 *
 * Each row carries `claim_key`, `claim_text`, `domain`, `embedding_model`,
 * `embedding_dim`, `embedding_vector`. Callers should treat
 * `embedding_vector` as a JS array (DuckDB's binding returns LIST
 * columns as arrays already).
 */
async function listClaimEmbeddings({ domain, limit = 5000 } = {}) {
  if (!await ensureViews()) return [];
  if (!hasClaimsView) return [];

  const where = ['embedding_vector IS NOT NULL'];
  const params = [];
  if (domain) { where.push('domain = ?'); params.push(domain); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  params.push(limit);

  // De-dup by claim_key: pick the most recently generated row.
  const rows = await runQuery(`
    SELECT claim_key, claim_text, domain,
           embedding_model, embedding_dim, embedding_vector,
           MAX(generated_at) AS generated_at
    FROM claims
    ${whereSql}
    GROUP BY claim_key, claim_text, domain, embedding_model, embedding_dim, embedding_vector
    ORDER BY generated_at DESC
    LIMIT ?;
  `, params);
  if (!rows) return [];

  // DuckDB returns LIST columns as DuckDBListValue wrappers; the JS
  // array is on `.items`. Normalize so downstream code can treat
  // `embedding_vector` as a plain number[].
  return rows.map((row) => ({
    ...row,
    embedding_dim: typeof row.embedding_dim === 'bigint' ? Number(row.embedding_dim) : row.embedding_dim,
    embedding_vector: unwrapListValue(row.embedding_vector),
  }));
}

function unwrapListValue(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.items)) return v.items;
  return null;
}

/**
 * Of the given claim_keys, return the subset that have at least one
 * entry in the claims store written STRICTLY BEFORE `cutoffIso`.
 *
 * Used by `memoryRecall` to surface "this claim was seen in a prior
 * session" without false-positiving on the write the current
 * factCheck node just performed. Callers typically pass
 * `state.factCheckResult.generated_at` as the cutoff so the current
 * session's own write is excluded.
 *
 * Returns an empty Set if the claims view isn't available or no rows
 * match.
 */
async function findPriorClaimWrites(claimKeys, cutoffIso) {
  if (!claimKeys || claimKeys.length === 0) return new Set();
  if (!cutoffIso) return new Set();
  if (!await ensureViews()) return new Set();
  if (!hasClaimsView) return new Set();

  const placeholders = claimKeys.map(() => '?').join(', ');
  const rows = await runQuery(`
    SELECT claim_key,
           STRFTIME(MIN(generated_at), '%Y-%m-%dT%H:%M:%S.%gZ') AS first_seen_str,
           COUNT(*) AS write_count
    FROM claims
    WHERE claim_key IN (${placeholders})
    GROUP BY claim_key;
  `, claimKeys);

  if (!rows) return new Set();

  const cutoffMs = Date.parse(cutoffIso);
  const seen = new Set();
  for (const row of rows) {
    const firstSeenMs = Date.parse(String(row.first_seen_str || ''));
    if (Number.isFinite(firstSeenMs) && Number.isFinite(cutoffMs) && firstSeenMs < cutoffMs) {
      seen.add(row.claim_key);
    }
  }
  return seen;
}

/**
 * Aggregate stats for /fact-store/stats and the trace-navigator Memory
 * tab. Returns null if neither view is available.
 */
// DuckDB returns COUNT(*) as BigInt. JSON.stringify (used by both
// Express's res.json() and the trace-navigator client) throws on
// BigInt, so coerce to plain Number before returning anything from
// getStats. Counts will never overflow Number.MAX_SAFE_INTEGER in
// practice for this workload.
function toPlainCount(n) {
  if (typeof n === 'bigint') return Number(n);
  return typeof n === 'number' ? n : 0;
}

function coerceDomainRows(rows) {
  return (rows || []).map((r) => ({ domain: r.domain, n: toPlainCount(r.n) }));
}

async function getStats() {
  if (!isAvailable()) return null;
  if (!await ensureViews()) return null;

  const result = { claims: null, citations: null };

  if (hasClaimsView) {
    const claimCount = await runQuery(`SELECT COUNT(*) AS n FROM claims;`);
    if (claimCount && claimCount.length) {
      // by_domain is the legacy hand-tuned classifier; by_inferred_domain
      // is the new embedding-based classifier output (item #12). Both
      // are exposed so operators can see how they differ. Claims
      // persisted before #12 have NULL inferred_domain and are bucketed
      // under '(unclassified)' so they show up in the UI.
      result.claims = {
        total: toPlainCount(claimCount[0].n),
        by_domain: coerceDomainRows(await runQuery(`
          SELECT domain, COUNT(*) AS n
          FROM claims
          WHERE domain IS NOT NULL
          GROUP BY domain
          ORDER BY n DESC;
        `)),
        by_inferred_domain: coerceDomainRows(await runQuery(`
          SELECT COALESCE(inferred_domain, '(unclassified)') AS domain, COUNT(*) AS n
          FROM claims
          GROUP BY 1
          ORDER BY n DESC;
        `)),
      };
    }
  }

  if (hasCitationsView) {
    const citationCount = await runQuery(`SELECT COUNT(*) AS n FROM citations;`);
    if (citationCount && citationCount.length) {
      const expired = await runQuery(`
        SELECT COUNT(*) AS n
        FROM citations
        WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
      `);
      const provisional = await runQuery(`
        SELECT COUNT(*) AS n
        FROM citations
        WHERE verification_level = 'provisional';
      `);
      result.citations = {
        total: toPlainCount(citationCount[0].n),
        provisional: provisional && provisional.length ? toPlainCount(provisional[0].n) : 0,
        expired: expired && expired.length ? toPlainCount(expired[0].n) : 0,
        by_domain: coerceDomainRows(await runQuery(`
          SELECT domain, COUNT(*) AS n
          FROM citations
          WHERE domain IS NOT NULL
          GROUP BY domain
          ORDER BY n DESC;
        `)),
      };
    }
  }

  return result;
}

/**
 * Force reinitialization of the DuckDB connection. Useful for tests.
 */
function _resetForTests() {
  connection = null;
  initPromise = null;
  initFailed = false;
  viewsReady = false;
  duckdbModule = null;
}

module.exports = {
  FactStoreError,
  isAvailable,
  lookupCitationByClaimKey,
  listCitationCandidatesByDomain,
  listExpiredCitations,
  listClaims,
  listCitations,
  listClaimEmbeddings,
  findFreshClaimKeys,
  findPriorClaimWrites,
  getStats,
  _resetForTests,
};
