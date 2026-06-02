/**
 * Golden conformance fixtures for citationApply (Citation_Application.md §10).
 *
 * Each fixture is a pure, language-neutral case:
 *   { draft_with_tags, citable_set } → { validated_prose, references[], stats }
 *
 * citationApply is deterministic, so these fixtures must diff exactly across
 * every polyglot port (JS / Python / Rust / LangChain). The citable_set
 * carries explicit uuids so this corpus tests the validation contract
 * independently of the uuid-derivation step (which has its own tests).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { applyCitations } = require('../core/citations/apply');

// Shared, language-neutral conformance corpus (consumed by every polyglot port).
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'conformance', 'fixtures', 'citation-apply');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  console.log('========================================');
  console.log('citationApply golden conformance fixtures');
  console.log('========================================');

  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
  ok('found fixtures', files.length > 0, files);

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    console.log(`\n[${file}] ${fixture.name}`);
    const result = applyCitations(fixture.draft_with_tags, fixture.citable_set);

    ok('validated_prose matches', result.prose === fixture.expected.validated_prose,
       `\n      expected: ${JSON.stringify(fixture.expected.validated_prose)}\n      actual:   ${JSON.stringify(result.prose)}`);
    ok('references match', deepEqual(result.references, fixture.expected.references),
       `\n      expected: ${JSON.stringify(fixture.expected.references)}\n      actual:   ${JSON.stringify(result.references)}`);
    if (fixture.expected.stats) {
      ok('stats match', deepEqual(result.stats, fixture.expected.stats),
         `\n      expected: ${JSON.stringify(fixture.expected.stats)}\n      actual:   ${JSON.stringify(result.stats)}`);
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
