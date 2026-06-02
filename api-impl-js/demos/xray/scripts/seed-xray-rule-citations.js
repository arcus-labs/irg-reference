#!/usr/bin/env node
'use strict';

/**
 * Seed the radiology decision-support knowledge pack as fact-store citations.
 * Thin wrapper around the shared kit seeder — the same substrate machinery the
 * fintech IRGs use, now backing the medical (X-ray) IRG.
 *
 * Usage:
 *   node demos/xray/scripts/seed-xray-rule-citations.js [--fact-store <path>]
 *   FACT_STORE_ROOT=/path node demos/xray/scripts/seed-xray-rule-citations.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const argv = process.argv.slice(2);
const rootFlagIndex = argv.indexOf('--fact-store');
if (rootFlagIndex !== -1 && argv[rootFlagIndex + 1]) {
  process.env.FACT_STORE_ROOT = path.resolve(argv[rootFlagIndex + 1]);
}

const { seedRuleCitations } = require('../../_adjudication-kit/seed-rule-citations');

seedRuleCitations({
  knowledgePath: path.resolve(__dirname, '..', 'knowledge', 'xray-claims.json'),
  packSubdir: 'xray-pack',
  tag: 'seed-xray',
}).catch((err) => {
  console.error('seed-xray failed:', err.stack || err.message);
  process.exit(1);
});
