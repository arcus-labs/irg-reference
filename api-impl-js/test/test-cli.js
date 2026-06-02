/**
 * fact-store CLI smoke test.
 *
 * Spawns the CLI as a subprocess (so we exercise the real arg-parsing
 * and exit-code paths) against a tmp fact-store with seeded data.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'scripts', 'fact-store.js');
const SWEEP_SHIM = path.resolve(__dirname, '..', 'scripts', 'fact-store-sweep.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-store-cli-test-'));

let passed = 0;
let failed = 0;

function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra) console.log('    ' + extra); }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, FACT_STORE_ROOT: tmpRoot },
    encoding: 'utf8',
  });
  return result;
}

function seedData() {
  // Use the actual writer + canonicalizer so the schemas match
  process.env.FACT_STORE_ROOT = tmpRoot;
  // Clear any cached require state from prior tests (paranoia)
  for (const k of Object.keys(require.cache)) {
    if (k.includes('external-fact-check') || k.includes('claim-store')) delete require.cache[k];
  }
  const { writeFactCheckClaimsArtifactSync } = require('../core/external-fact-check/claim-store');
  const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');

  // Seed claims via the proper writer. Use claims whose text triggers
  // distinct domains via the keyword scoring in claim-parser.js:
  //   "planet"  → science
  //   "antibiotic", "bacterial" → health
  writeFactCheckClaimsArtifactSync({
    criticalClaims: [
      { claim: 'Mars is the fourth planet from the Sun.', importance: 'astronomy', assessment: 'true' },
      { claim: 'Antibiotics target bacterial cells, not viruses.', importance: 'health', assessment: 'true' },
    ],
    summary: 'seed',
    confidence: 0.9,
    originalQuery: 'seed',
    context: {},
    iteration: 0,
    sourceNode: 'factCheck',
    rawOutput: '',
  });

  // Seed citations manually (one fresh, one expired)
  const citationDir = path.join(tmpRoot, 'citations', '2026-04');
  fs.mkdirSync(citationDir, { recursive: true });

  const writeCitation = (claimText, createdAt, expiresAt) => {
    const structured = canonicalizeClaim(claimText);
    const citation = {
      claim_key: structured.claim_key,
      created_at: createdAt,
      expires_at: expiresAt,
      claim: structured,
      verdict: 'inconclusive',
      confidence: 0.5,
      sources: [{ url: 'https://example.com', title: 'Example' }],
      verification_level: 'provisional',
      verification_status: 'suggested_sources_unverified',
      retrieval_mode: 'llm_generated_source_candidates',
      retrieval_deferred: true,
    };
    const filename = `${structured.claim_key.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(path.join(citationDir, filename), JSON.stringify(citation, null, 2));
  };
  writeCitation('Mars is the fourth planet from the Sun.', '2099-01-01T00:00:00.000Z', '2099-12-31T00:00:00.000Z');
  writeCitation('Pluto was reclassified as a dwarf planet.', '2020-01-01T00:00:00.000Z', '2020-12-31T00:00:00.000Z'); // expired
}

function main() {
  console.log('========================================');
  console.log('fact-store CLI smoke test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. --help works
  console.log('\n1. Root help');
  const r1 = runCli(['--help']);
  ok('exit 0',                     r1.status === 0);
  ok('mentions stats command',     r1.stdout.includes('stats'));
  ok('mentions ls command',        r1.stdout.includes('ls'));
  ok('mentions prune command',     r1.stdout.includes('prune'));

  // 2. Unknown command
  console.log('\n2. Unknown command');
  const r2 = runCli(['unknown']);
  ok('exit 2 (usage error)', r2.status === 2);
  ok('error message mentions unknown', r2.stderr.toLowerCase().includes('unknown'));

  // 3. Empty store stats
  console.log('\n3. Stats against empty store');
  const r3 = runCli(['stats']);
  ok('exit 0',                       r3.status === 0);
  ok('reports empty store',          r3.stdout.toLowerCase().includes('empty'));

  // 4. Empty store stats --json
  console.log('\n4. Stats --json against empty store');
  const r4 = runCli(['stats', '--json']);
  ok('exit 0',                r4.status === 0);
  const parsed4 = (() => { try { return JSON.parse(r4.stdout); } catch { return null; } })();
  ok('output is valid JSON',  parsed4 !== null);
  ok('JSON has stats=null',   parsed4?.stats === null);

  // 5. Seed data, then stats again
  console.log('\n5. Stats against seeded store');
  seedData();
  const r5 = runCli(['stats']);
  ok('exit 0',                  r5.status === 0);
  ok('mentions Claims',         r5.stdout.includes('Claims'));
  ok('mentions Citations',      r5.stdout.includes('Citations'));
  ok('shows claim count',       /total:\s*2/i.test(r5.stdout));

  // 6. ls default (both)
  console.log('\n6. ls (default both)');
  const r6 = runCli(['ls']);
  ok('exit 0',                       r6.status === 0);
  ok('lists claims section',         r6.stdout.includes('Claims'));
  ok('lists citations section',      r6.stdout.includes('Citations'));

  // 7. ls --type citations --expired
  console.log('\n7. ls --type citations --expired');
  const r7 = runCli(['ls', '--type', 'citations', '--expired']);
  ok('exit 0',                       r7.status === 0);
  ok('shows the expired Pluto row',  r7.stdout.includes('Pluto'));
  ok('does not show fresh Mars',    !r7.stdout.includes('Mars '));

  // 8. ls --domain filter (science triggered by "planet" keyword)
  console.log('\n8. ls --domain filter');
  const r8 = runCli(['ls', '--type', 'claims', '--domain', 'science']);
  ok('exit 0',                            r8.status === 0);
  ok('Mars (science) appears',            r8.stdout.includes('Mars'));
  ok('Antibiotics (health) does not',    !r8.stdout.includes('Antibiotics'));

  // 9. ls --json
  console.log('\n9. ls --json');
  const r9 = runCli(['ls', '--type', 'claims', '--json']);
  const parsed9 = (() => { try { return JSON.parse(r9.stdout); } catch { return null; } })();
  ok('output is valid JSON',     parsed9 !== null);
  ok('has claims array',         Array.isArray(parsed9?.claims));
  ok('claims have claim_key',    parsed9?.claims?.[0]?.claim_key?.length > 0);

  // 10. prune --dry-run
  console.log('\n10. prune --dry-run');
  const r10 = runCli(['prune', '--dry-run']);
  ok('exit 0',                            r10.status === 0);
  ok('reports would-remove count',        r10.stdout.includes('would remove'));

  // 11. prune (real)
  console.log('\n11. prune real');
  const r11 = runCli(['prune', '--json']);
  ok('exit 0',                  r11.status === 0);
  const parsed11 = (() => { try { return JSON.parse(r11.stdout); } catch { return null; } })();
  ok('removed 1 expired',       parsed11?.removed === 1);

  // 12. Stats after prune: expired count drops to 0
  console.log('\n12. Stats after prune');
  const r12 = runCli(['stats', '--json']);
  const parsed12 = (() => { try { return JSON.parse(r12.stdout); } catch { return null; } })();
  ok('expired = 0', parsed12?.citations?.expired === 0);

  // 13. Backward-compat shim still works
  console.log('\n13. fact-store-sweep shim');
  const r13 = spawnSync(process.execPath, [SWEEP_SHIM, '--dry-run'], {
    env: { ...process.env, FACT_STORE_ROOT: tmpRoot },
    encoding: 'utf8',
  });
  ok('shim exits 0',          r13.status === 0);
  ok('shim invokes prune',    r13.stdout.includes('would remove') || r13.stdout.includes('expired'));

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('Test crashed:', err);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}
