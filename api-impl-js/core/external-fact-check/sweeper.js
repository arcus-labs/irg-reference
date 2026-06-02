'use strict';

/**
 * Expired-Citation Sweeper
 *
 * Removes citation artifacts whose `expires_at` has passed. Used by:
 *   - the API server's scheduled sweep (on startup + periodic timer)
 *   - the standalone CLI at `scripts/fact-store-sweep.js`
 *
 * Scope: citations only. Claims do not carry per-record expiry — their
 * freshness is consulted at lookup time by the dedup logic (#4). If
 * claim storage ever needs pruning, that should be a separate sweep.
 *
 * Failure model:
 *   - DuckDB failure throws (strict mode — see `db.js`). Callers that
 *     run the sweep periodically must catch.
 *   - Per-file unlink errors are collected in the result's `errors`
 *     array and reported, not thrown.
 *   - A missing-file (race condition with another sweep) is not an
 *     error; counted as `already_gone`.
 */

const fs = require('fs');
const path = require('path');
const { getFactStorePaths } = require('./config');
const db = require('./db');

/**
 * @typedef {Object} SweepResult
 * @property {number} inspected       Citations matched by the expiry query
 * @property {number} removed         Files actually unlinked
 * @property {number} alreadyGone     Files that were already missing
 * @property {{file: string, error: string}[]} errors
 * @property {boolean} dryRun
 * @property {number} duration_ms
 * @property {string} swept_at        ISO timestamp at start of sweep
 */

/**
 * Sweep expired citations.
 *
 * @param {Object}  [opts]
 * @param {boolean} [opts.dryRun=false]   Report what would be removed; don't touch disk
 * @param {Date}    [opts.now=new Date()] "Now" anchor for the expiry comparison
 * @returns {Promise<SweepResult>}
 */
async function sweepExpired({ dryRun = false, now = new Date() } = {}) {
  const startMs = Date.now();
  const sweptAt = now.toISOString();

  // Throws FactStoreError on DuckDB failure (strict mode).
  const expiredRows = await db.listExpiredCitations(sweptAt);

  const paths = getFactStorePaths();
  const result = {
    inspected: expiredRows.length,
    removed: 0,
    alreadyGone: 0,
    errors: [],
    dryRun,
    duration_ms: 0,
    swept_at: sweptAt,
  };

  for (const row of expiredRows) {
    if (!row.source_file) continue;
    const absolute = path.isAbsolute(row.source_file)
      ? row.source_file
      : path.join(paths.factStoreRoot, row.source_file);

    if (dryRun) {
      result.removed += 1; // dry-run reports what *would* be removed
      continue;
    }

    try {
      fs.unlinkSync(absolute);
      result.removed += 1;
    } catch (err) {
      if (err.code === 'ENOENT') {
        result.alreadyGone += 1;
      } else {
        result.errors.push({ file: absolute, error: err.message });
      }
    }
  }

  result.duration_ms = Date.now() - startMs;

  if (!dryRun) {
    appendSweepLog(result);
  }

  return result;
}

function appendSweepLog(result) {
  const paths = getFactStorePaths();
  try {
    fs.mkdirSync(paths.metadataDir, { recursive: true });
    const logPath = path.join(paths.metadataDir, 'sweep_log.jsonl');
    fs.appendFileSync(logPath, `${JSON.stringify(result)}\n`, 'utf8');
  } catch (err) {
    // Logging failures are non-fatal — the sweep itself succeeded.
    console.warn('[sweeper] failed to write sweep_log:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Scheduled sweep helpers (used by the API server)
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Start a background sweep loop. Runs once immediately, then on a
 * fixed interval. Caller can pass `0` for `intervalMs` to disable
 * scheduling (still runs once at startup).
 *
 * Errors thrown by `sweepExpired` are caught and logged so the API
 * server doesn't crash if DuckDB is temporarily unavailable.
 *
 * Returns an `{ stop() }` handle.
 */
function startScheduledSweep({
  intervalMs = DEFAULT_INTERVAL_MS,
  onResult = defaultLogResult,
  onError = defaultLogError,
} = {}) {
  let stopped = false;

  const runOnce = async () => {
    if (stopped) return;
    try {
      const result = await sweepExpired();
      onResult(result);
    } catch (err) {
      onError(err);
    }
  };

  // Fire once at startup.
  runOnce();

  let timer = null;
  if (intervalMs > 0) {
    timer = setInterval(runOnce, intervalMs);
    // Don't keep Node alive solely for the sweep timer.
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

function defaultLogResult(result) {
  const tag = result.dryRun ? '[sweeper:dry]' : '[sweeper]';
  console.log(
    `${tag} swept_at=${result.swept_at} ` +
    `inspected=${result.inspected} removed=${result.removed} ` +
    `already_gone=${result.alreadyGone} errors=${result.errors.length} ` +
    `duration_ms=${result.duration_ms}`
  );
  if (result.errors.length) {
    for (const e of result.errors) {
      console.warn(`${tag} error file=${e.file}: ${e.error}`);
    }
  }
}

function defaultLogError(err) {
  console.warn(`[sweeper] sweep failed: ${err.message}`);
}

module.exports = {
  sweepExpired,
  startScheduledSweep,
  DEFAULT_INTERVAL_MS,
};
