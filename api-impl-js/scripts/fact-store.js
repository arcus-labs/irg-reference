#!/usr/bin/env node

/**
 * fact-store CLI
 *
 * Inspect and maintain the local fact-store from the terminal. Reads
 * the same `_fact-store/` location the API server uses (override with
 * FACT_STORE_ROOT).
 *
 * Usage:
 *   fact-store stats [--json]
 *   fact-store ls [--type claims|citations] [--domain D] [--limit N]
 *                  [--since YYYY-MM-DD] [--expired] [--provisional]
 *                  [--json]
 *   fact-store prune [--expired] [--older-than DAYS] [--dry-run]
 *
 * Run `fact-store <subcommand> --help` for per-subcommand options.
 *
 * Exit codes:
 *   0   success
 *   1   runtime failure (DuckDB unavailable, sweep error, etc.)
 *   2   CLI usage error
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const factStoreDb = require('../core/external-fact-check/db');
const { sweepExpired } = require('../core/external-fact-check/sweeper');
const { toClaimReviewCollection } = require('../core/external-fact-check/claimreview');
const { getFactStorePaths } = require('../core/external-fact-check/config');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Arg parsing — small custom parser; no extra deps
// ---------------------------------------------------------------------------

function parseFlags(argv, schema) {
  // schema: { long: { type: 'string'|'number'|'boolean', alias?: 'short' } }
  const opts = {};
  const aliases = {};
  for (const [key, def] of Object.entries(schema)) {
    opts[key] = def.default ?? (def.type === 'boolean' ? false : undefined);
    if (def.alias) aliases[def.alias] = key;
  }

  for (let i = 0; i < argv.length; i++) {
    let tok = argv[i];
    if (!tok.startsWith('--') && !tok.startsWith('-')) {
      throw new Error(`Unexpected argument: ${tok}`);
    }
    let value;
    if (tok.includes('=')) {
      [tok, value] = tok.split(/=(.+)/);
    }
    const stripped = tok.replace(/^--?/, '');
    const key = aliases[stripped] || stripped;
    const def = schema[key];
    if (!def) throw new Error(`Unknown option: ${tok}`);

    if (def.type === 'boolean') {
      opts[key] = true;
    } else {
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new Error(`Missing value for ${tok}`);
        value = argv[++i];
      }
      opts[key] = def.type === 'number' ? Number(value) : value;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function formatTable(rows, columns) {
  // columns: [{ key, label, width, align?: 'left'|'right' }]
  const widths = columns.map((c) => c.width);
  const header = columns.map((c, i) => pad(c.label, widths[i], c.align)).join('  ');
  const sep = columns.map((_, i) => '─'.repeat(widths[i])).join('  ');
  const lines = rows.map((r) =>
    columns.map((c, i) => pad(truncate(r[c.key], widths[i]), widths[i], c.align)).join('  ')
  );
  return [header, sep, ...lines].join('\n');
}

function pad(s, width, align = 'left') {
  const str = String(s ?? '');
  if (str.length >= width) return str.slice(0, width);
  const padding = ' '.repeat(width - str.length);
  return align === 'right' ? padding + str : str + padding;
}

function emit(jsonMode, asJson, asText) {
  if (jsonMode) {
    console.log(JSON.stringify(asJson, null, 2));
  } else if (typeof asText === 'function') {
    asText();
  } else {
    console.log(asText);
  }
}

function asPlainNumber(n) {
  if (typeof n === 'bigint') return Number(n);
  return n;
}

/**
 * Recursively coerce BigInt → Number and Date → ISO string so
 * JSON.stringify can serialize DuckDB result rows without throwing.
 */
function jsonSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Subcommand: stats
// ---------------------------------------------------------------------------

async function cmdStats(rest) {
  const opts = parseFlags(rest, { json: { type: 'boolean' }, help: { type: 'boolean', alias: 'h' } });
  if (opts.help) return printStatsHelp();

  const stats = await factStoreDb.getStats();
  if (!stats) {
    emit(opts.json, { stats: null }, 'Fact-store is empty (no claims or citations on disk).');
    return;
  }

  if (opts.json) {
    // Convert bigints in the by_domain arrays for JSON safety
    const json = {
      claims: stats.claims && {
        total: asPlainNumber(stats.claims.total),
        by_domain: stats.claims.by_domain.map((r) => ({ domain: r.domain, n: asPlainNumber(r.n) })),
      },
      citations: stats.citations && {
        total: asPlainNumber(stats.citations.total),
        provisional: asPlainNumber(stats.citations.provisional),
        expired: asPlainNumber(stats.citations.expired),
        by_domain: stats.citations.by_domain.map((r) => ({ domain: r.domain, n: asPlainNumber(r.n) })),
      },
    };
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  if (stats.claims) {
    console.log('\nClaims');
    console.log('───────');
    console.log(`  total:     ${asPlainNumber(stats.claims.total)}`);
    if (stats.claims.by_domain.length) {
      console.log('  by domain:');
      for (const row of stats.claims.by_domain) {
        console.log(`    ${pad(row.domain, 18)} ${asPlainNumber(row.n)}`);
      }
    }
  }

  if (stats.citations) {
    console.log('\nCitations');
    console.log('──────────');
    console.log(`  total:       ${asPlainNumber(stats.citations.total)}`);
    console.log(`  provisional: ${asPlainNumber(stats.citations.provisional)}`);
    console.log(`  expired:     ${asPlainNumber(stats.citations.expired)}`);
    if (stats.citations.by_domain.length) {
      console.log('  by domain:');
      for (const row of stats.citations.by_domain) {
        console.log(`    ${pad(row.domain, 18)} ${asPlainNumber(row.n)}`);
      }
    }
  }
  console.log('');
}

function printStatsHelp() {
  console.log(`fact-store stats — show aggregate counts for claims and citations

Options:
  --json     Emit a machine-readable JSON object instead of formatted text
  -h, --help`);
}

// ---------------------------------------------------------------------------
// Subcommand: ls
// ---------------------------------------------------------------------------

async function cmdLs(rest) {
  const opts = parseFlags(rest, {
    type:        { type: 'string', default: 'both' },
    domain:      { type: 'string' },
    limit:       { type: 'number', default: 20 },
    since:       { type: 'string' },
    expired:     { type: 'boolean' },
    provisional: { type: 'boolean' },
    json:        { type: 'boolean' },
    help:        { type: 'boolean', alias: 'h' },
  });
  if (opts.help) return printLsHelp();

  if (!['both', 'claims', 'citations'].includes(opts.type)) {
    throw new Error(`Invalid --type: ${opts.type} (expected: claims, citations, both)`);
  }

  const wantClaims = opts.type === 'both' || opts.type === 'claims';
  const wantCitations = opts.type === 'both' || opts.type === 'citations';

  const claims = wantClaims
    ? await factStoreDb.listClaims({ domain: opts.domain, since: opts.since, limit: opts.limit })
    : [];

  const citations = wantCitations
    ? await factStoreDb.listCitations({
        domain: opts.domain,
        since: opts.since,
        expired: opts.expired,
        provisional: opts.provisional,
        limit: opts.limit,
      })
    : [];

  if (opts.json) {
    console.log(JSON.stringify(jsonSafe({ claims, citations }), null, 2));
    return;
  }

  if (wantClaims) {
    console.log(`\nClaims (${claims.length} of up to ${opts.limit})`);
    if (claims.length === 0) {
      console.log('  (none)');
    } else {
      console.log(formatTable(
        claims.map((r) => ({
          generated_at: shortIso(r.generated_at),
          domain: r.domain || '-',
          claim_kind: r.claim_kind || '-',
          claim_text: r.claim_text || '',
        })),
        [
          { key: 'generated_at', label: 'when',       width: 20 },
          { key: 'domain',       label: 'domain',     width: 12 },
          { key: 'claim_kind',   label: 'kind',       width: 18 },
          { key: 'claim_text',   label: 'claim',      width: 60 },
        ]
      ));
    }
  }

  if (wantCitations) {
    console.log(`\nCitations (${citations.length} of up to ${opts.limit})`);
    if (citations.length === 0) {
      console.log('  (none)');
    } else {
      console.log(formatTable(
        citations.map((r) => ({
          created_at: shortIso(r.created_at),
          expires_at: shortIso(r.expires_at) + (isExpired(r.expires_at) ? ' ⚠' : ''),
          domain: r.domain || '-',
          level: r.verification_level || '-',
          srcs: String(asPlainNumber(r.source_count) ?? 0),
          claim_text: r.claim_text || '',
        })),
        [
          { key: 'created_at', label: 'created',   width: 12 },
          { key: 'expires_at', label: 'expires',   width: 14 },
          { key: 'domain',     label: 'domain',    width: 12 },
          { key: 'level',      label: 'level',     width: 12 },
          { key: 'srcs',       label: 'srcs', width: 4, align: 'right' },
          { key: 'claim_text', label: 'claim',     width: 50 },
        ]
      ));
    }
  }
  console.log('');
}

function isExpired(expires) {
  if (!expires) return false;
  const t = expires instanceof Date ? expires.getTime() : Date.parse(String(expires));
  return Number.isFinite(t) && t < Date.now();
}

function shortIso(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function printLsHelp() {
  console.log(`fact-store ls — list claims and/or citations

Options:
  --type <claims|citations|both>   Default: both
  --domain <name>                  Filter to a single domain (e.g. finance)
  --limit <n>                      Default: 20
  --since <YYYY-MM-DD>             Only entries on/after this date
  --expired                        Citations only: show only expired
  --provisional                    Citations only: show only verification_level=provisional
  --json                           Emit JSON instead of formatted text
  -h, --help`);
}

// ---------------------------------------------------------------------------
// Subcommand: prune
// ---------------------------------------------------------------------------

async function cmdPrune(rest) {
  const opts = parseFlags(rest, {
    expired:       { type: 'boolean', default: false },
    'older-than':  { type: 'number' },
    'dry-run':     { type: 'boolean' },
    json:          { type: 'boolean' },
    help:          { type: 'boolean', alias: 'h' },
  });
  if (opts.help) return printPruneHelp();

  // Default to --expired if no mode flag was given.
  if (!opts.expired && opts['older-than'] === undefined) {
    opts.expired = true;
  }

  if (opts['older-than'] !== undefined) {
    await pruneOlderThan(opts['older-than'], { dryRun: opts['dry-run'], json: opts.json });
    return;
  }

  // Default path: sweep expired
  const result = await sweepExpired({ dryRun: opts['dry-run'] });
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const verb = opts['dry-run'] ? 'would remove' : 'removed';
  console.log(`[prune] ${verb} ${result.removed} of ${result.inspected} expired ` +
              `citation(s) in ${result.duration_ms}ms ` +
              `(already_gone=${result.alreadyGone}, errors=${result.errors.length}).`);
  if (result.errors.length) {
    for (const e of result.errors) {
      console.warn(`  error: ${e.file} — ${e.error}`);
    }
  }
}

async function pruneOlderThan(days, { dryRun, json }) {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--older-than requires a positive number of days');
  }
  const cutoff = new Date(Date.now() - days * 86400000);
  const targets = await factStoreDb.listCitations({
    since: undefined,
    limit: 100000, // effectively unbounded; CLI usage
  });
  const toRemove = targets.filter((r) => {
    const t = r.created_at instanceof Date ? r.created_at.getTime() : Date.parse(String(r.created_at));
    return Number.isFinite(t) && t < cutoff.getTime();
  });

  const { getFactStorePaths } = require('../core/external-fact-check/config');
  const { factStoreRoot } = getFactStorePaths();

  let removed = 0;
  let alreadyGone = 0;
  const errors = [];

  for (const row of toRemove) {
    if (dryRun) { removed++; continue; }
    const absolute = path.isAbsolute(row.source_file)
      ? row.source_file
      : path.join(factStoreRoot, row.source_file);
    try {
      fs.unlinkSync(absolute);
      removed++;
    } catch (err) {
      if (err.code === 'ENOENT') alreadyGone++;
      else errors.push({ file: absolute, error: err.message });
    }
  }

  const result = {
    mode: 'older_than',
    cutoff: cutoff.toISOString(),
    inspected: toRemove.length,
    removed,
    alreadyGone,
    errors,
    dryRun: !!dryRun,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const verb = dryRun ? 'would remove' : 'removed';
  console.log(`[prune] ${verb} ${removed} of ${result.inspected} citation(s) ` +
              `older than ${days}d (cutoff ${cutoff.toISOString().slice(0, 10)}).`);
}

function printPruneHelp() {
  console.log(`fact-store prune — remove citation artifacts

Options:
  --expired             Remove only entries whose expires_at has passed (default)
  --older-than DAYS     Remove citations created more than DAYS days ago
  --dry-run             Report what would be removed; don't touch disk
  --json                Emit JSON result
  -h, --help

Examples:
  fact-store prune                       # remove expired citations
  fact-store prune --dry-run             # preview
  fact-store prune --older-than 90       # remove citations older than 90 days
  fact-store prune --older-than 7 --dry-run`);
}

// ---------------------------------------------------------------------------
// Subcommand: export
// ---------------------------------------------------------------------------

/**
 * Recursively collect every *.json file under `dir`.
 * Returns absolute paths. Missing dir → empty array (empty store).
 */
function walkJsonFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

async function cmdExport(rest) {
  const opts = parseFlags(rest, {
    format:                { type: 'string', default: 'claimreview' },
    out:                   { type: 'string' },
    'include-provisional': { type: 'boolean' },
    json:                  { type: 'boolean' },
    help:                  { type: 'boolean', alias: 'h' },
  });
  if (opts.help) return printExportHelp();

  if (opts.format !== 'claimreview') {
    throw new Error(`Invalid --format: ${opts.format} (expected: claimreview)`);
  }

  const { citationDir, factStoreRoot } = getFactStorePaths();
  const files = walkJsonFiles(citationDir);

  const citations = [];
  const readErrors = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Attach a relative citation_path if the record doesn't carry one,
      // so the projection can populate ClaimReview.url.
      if (!parsed.citation_path) {
        parsed.citation_path = path.relative(factStoreRoot, file);
      }
      citations.push(parsed);
    } catch (err) {
      readErrors.push({ file: path.relative(factStoreRoot, file), error: err.message });
    }
  }

  const doc = toClaimReviewCollection(citations, {
    includeProvisional: !!opts['include-provisional'],
  });

  const serialized = JSON.stringify(doc, null, 2);

  if (opts.out) {
    fs.writeFileSync(opts.out, serialized + '\n');
  } else {
    console.log(serialized);
  }

  // Summary goes to stderr so it never pollutes piped JSON-LD on stdout.
  const summary = {
    scanned: files.length,
    parse_errors: readErrors.length,
    exported: doc['@graph'].length,
    include_provisional: !!opts['include-provisional'],
    out: opts.out || null,
  };
  if (opts.json) {
    console.error(JSON.stringify(summary, null, 2));
  } else {
    console.error(
      `[export] scanned ${summary.scanned} citation file(s), ` +
      `exported ${summary.exported} ClaimReview(s)` +
      (opts['include-provisional'] ? ' (incl. provisional)' : ' (verified only)') +
      (opts.out ? ` → ${opts.out}` : '') +
      (readErrors.length ? `; ${readErrors.length} parse error(s)` : '') + '.'
    );
    for (const e of readErrors) console.error(`  parse error: ${e.file} — ${e.error}`);
  }
}

function printExportHelp() {
  console.log(`fact-store export — project citations into an interop schema

Emits a schema.org ClaimReview JSON-LD document (the lossy, interoperable
"lite" view) on stdout, or to a file with --out. Progress/summary is written
to stderr so stdout stays clean for piping.

Options:
  --format <claimreview>     Output schema (default & only value: claimreview)
  --out <file>               Write JSON-LD to a file instead of stdout
  --include-provisional      Include provisional citations (default: verified only)
  --json                     Emit the summary as JSON (to stderr)
  -h, --help

Examples:
  fact-store export                              # verified citations → stdout
  fact-store export --out claims.jsonld          # write to a file
  fact-store export --include-provisional > all.jsonld`);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const COMMANDS = {
  stats: cmdStats,
  ls: cmdLs,
  prune: cmdPrune,
  export: cmdExport,
};

function printRootHelp() {
  console.log(`fact-store — inspect and maintain the local fact-store

Usage:
  fact-store <command> [options]

Commands:
  stats     Show aggregate counts for claims and citations
  ls        List claims and/or citations with filters
  prune     Remove expired (or older) citation artifacts
  export    Project citations into schema.org ClaimReview JSON-LD

Run 'fact-store <command> --help' for command-specific options.

Environment:
  FACT_STORE_ROOT   Override the default _fact-store/ location`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || ['--help', '-h', 'help'].includes(argv[0])) {
    printRootHelp();
    process.exit(0);
  }

  const [cmd, ...rest] = argv;
  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    console.error(`Run 'fact-store --help' for a list of commands.`);
    process.exit(2);
  }

  try {
    await handler(rest);
    process.exit(0);
  } catch (err) {
    if (err.message && err.message.startsWith('Unknown option') ||
        err.message?.startsWith('Missing value') ||
        err.message?.startsWith('Unexpected argument') ||
        err.message?.startsWith('Invalid --type') ||
        err.message?.startsWith('Invalid --format')) {
      console.error(`Usage error: ${err.message}`);
      process.exit(2);
    }
    console.error(`[fact-store ${cmd}] failed: ${err.message}`);
    if (process.env.DEBUG && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
