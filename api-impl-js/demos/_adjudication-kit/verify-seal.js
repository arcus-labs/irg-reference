#!/usr/bin/env node
'use strict';

/**
 * Verify (and tamper-test) the I/O seal on an adjudication trace.
 *
 * The seal is a hash chain over every LLM call: chain_hash[n] =
 * sha256(chain_hash[n-1] + prompt_sha256[n] + response_sha256[n]), seeded at a
 * fixed genesis. Recomputing the chain from genesis and comparing every link +
 * the chain_root proves the model-call log was not edited or reordered after
 * sealing.
 *
 * Usage:
 *   node demos/_adjudication-kit/verify-seal.js <trace.json>
 *   node demos/_adjudication-kit/verify-seal.js <trace.json> --tamper [seq]
 *   node demos/_adjudication-kit/verify-seal.js <trace.json> --reorder
 *
 * --tamper edits one recorded response hash (simulating an altered model
 * response) and re-verifies, to show the chain catches it.
 * --reorder swaps two entries to show order is bound into the chain.
 * Exit code 0 = behaved as expected (clean verifies / tamper detected).
 */

const fs = require('fs');
const path = require('path');
const { verifySeal } = require('./io-seal');

function loadSeal(tracePath) {
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  const seal = trace && trace.provenance && trace.provenance.io_seal;
  if (!seal) throw new Error(`no provenance.io_seal found in ${tracePath}`);
  return seal;
}

function fmt(res) {
  return res.ok
    ? 'OK ✓  chain intact'
    : `BROKEN ✗  at seq ${res.brokenAt} (${res.reason})`;
}

function main() {
  const args = process.argv.slice(2);
  const tamper = args.includes('--tamper');
  const reorder = args.includes('--reorder');
  const tIdx = args.indexOf('--tamper');
  const seqArg = tamper && /^\d+$/.test(args[tIdx + 1] || '') ? parseInt(args[tIdx + 1], 10) : null;
  const tracePath = args.find((a, i) => !a.startsWith('--') && !(tamper && i === tIdx + 1 && seqArg !== null));

  if (!tracePath) {
    console.error('usage: node verify-seal.js <trace.json> [--tamper [seq]] [--reorder]');
    process.exit(2);
  }

  const seal = loadSeal(path.resolve(tracePath));
  const entries = seal.entries || [];
  console.log(`trace : ${tracePath}`);
  console.log(`seal  : ${seal.algorithm} · ${entries.length} entries · genesis ${(seal.genesis || '').slice(0, 20)}…`);
  console.log(`root  : ${(seal.chain_root || '').slice(0, 28)}…`);

  const clean = verifySeal(seal);
  console.log(`\nverify (as sealed): ${fmt(clean)}`);

  if (!tamper && !reorder) {
    process.exit(clean.ok ? 0 : 1);
  }

  // Work on a deep copy so the file is never modified.
  const copy = JSON.parse(JSON.stringify(seal));
  const ce = copy.entries;

  if (reorder) {
    if (ce.length < 2) { console.error('need ≥2 entries to reorder'); process.exit(2); }
    [ce[0], ce[1]] = [ce[1], ce[0]];
    const res = verifySeal(copy);
    console.log(`\nreorder test: swapped the first two log entries`);
    console.log(`verify (reordered): ${res.ok ? 'OK  (!! reorder NOT detected — bug)' : fmt(res) + ' — detected ✓'}`);
    process.exit(res.ok ? 1 : 0);
  }

  // --tamper: flip one hex char of a recorded response hash.
  const i = seqArg !== null ? ce.findIndex((e) => e.seq === seqArg) : Math.floor(ce.length / 2);
  if (i < 0 || !ce[i]) { console.error(`no entry with seq ${seqArg}`); process.exit(2); }
  const before = ce[i].response_sha256;
  ce[i].response_sha256 = before.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  const res = verifySeal(copy);
  console.log(`\ntamper test: edited recorded response hash on entry seq=${ce[i].seq} (${ce[i].node || 'node'})`);
  console.log(`  ${before.slice(0, 38)}… → ${ce[i].response_sha256.slice(0, 38)}…`);
  console.log(`verify (tampered): ${res.ok ? 'OK  (!! tamper NOT detected — bug)' : fmt(res) + ' — detected ✓'}`);
  process.exit(res.ok ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error('verify-seal error:', err.message);
  process.exit(2);
}
