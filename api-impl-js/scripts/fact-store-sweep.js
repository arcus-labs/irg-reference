#!/usr/bin/env node

/**
 * fact-store-sweep — backward-compatible shim around `fact-store prune`.
 *
 * Original CLI shipped with item #5. The full multi-command CLI in
 * `fact-store.js` supersedes it; this file forwards the same flags so
 * any existing automation keeps working.
 *
 * Equivalent invocations:
 *   node scripts/fact-store-sweep.js               → fact-store prune --expired
 *   node scripts/fact-store-sweep.js --dry-run     → fact-store prune --expired --dry-run
 *   node scripts/fact-store-sweep.js --verbose     → DEBUG=1 fact-store prune --expired
 *   node scripts/fact-store-sweep.js --help        → fact-store prune --help
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const forwarded = ['prune', '--expired'];
let printHelp = false;

for (const arg of argv) {
  switch (arg) {
    case '--dry-run': forwarded.push('--dry-run'); break;
    case '--verbose': case '-v': process.env.DEBUG = '1'; break;
    case '--help': case '-h': printHelp = true; break;
    default:
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
  }
}

if (printHelp) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fact-store.js'), 'prune', '--help'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

const result = spawnSync(process.execPath, [path.join(__dirname, 'fact-store.js'), ...forwarded], { stdio: 'inherit' });
process.exit(result.status ?? 0);
