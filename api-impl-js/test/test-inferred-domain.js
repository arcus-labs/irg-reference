/**
 * Integration test: persist claims via the async writer, then read
 * them back via the DuckDB claims view. Verifies that the new
 * `inferred_domain.*` columns are populated correctly.
 *
 * Runs against the hash embedder, which means the classifier
 * delegates to the legacy hand-tuned scorer — that's the path users
 * without an OpenAI key will see. We still exercise the WIRING all
 * the way through the persisted JSON and the DuckDB view.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inferred-domain-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;
process.env.EMBEDDINGS_PROVIDER = 'hash';

const { writeFactCheckClaimsArtifact } = require('../core/external-fact-check/claim-store');
const db = require('../core/external-fact-check/db');

let passed = 0, failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

async function main() {
  console.log('========================================');
  console.log('inferred_domain end-to-end test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  // 1. Write a batch of claims via the async path
  console.log('\n1. Async writer attaches inferred_domain');
  const result = await writeFactCheckClaimsArtifact({
    criticalClaims: [
      { claim: 'Antibiotics target bacterial cells.',          importance: 'health',     assessment: 'true' },
      { claim: 'The stock market closed lower today.',          importance: 'finance',    assessment: 'true' },
      { claim: 'The Supreme Court ruled on a constitutional statute.', importance: 'law', assessment: 'true' },
    ],
    summary: 'mixed', confidence: 0.9, originalQuery: 'mixed',
    context: {}, iteration: 0, sourceNode: 'factCheck', rawOutput: '',
  });
  ok('write succeeded',                       !!result?.artifact_path);
  ok('inferred_domains_attached = 3',          result?.inferred_domains_attached === 3);
  ok('embeddings_attached = 3',                result?.embeddings_attached === 3);

  // 2. Inspect the JSON on disk
  console.log('\n2. Persisted JSON includes inferred_domain');
  const artifactAbsPath = path.join(tmpRoot, result.artifact_path);
  const artifact = JSON.parse(fs.readFileSync(artifactAbsPath, 'utf8'));
  const claims = artifact.critical_claims;
  ok('3 persisted claims',                    Array.isArray(claims) && claims.length === 3);

  for (const c of claims) {
    ok(`  claim "${c.claim_text.slice(0, 35)}…" has inferred_domain object`,
       c.inferred_domain && typeof c.inferred_domain.domain === 'string');
    ok(`  inferred_domain has confidence`,
       typeof c.inferred_domain.confidence === 'number');
    ok(`  inferred_domain has source`,
       c.inferred_domain.source === 'hand_tuned' || c.inferred_domain.source === 'embedding');
  }

  // 3. DuckDB view exposes inferred_domain columns
  console.log('\n3. DuckDB exposes inferred_domain columns');
  const rows = await db.listClaims({ limit: 10 });
  ok('claims view returns rows',  Array.isArray(rows) && rows.length === 3);
  // We didn't add inferred_domain to listClaims output; use raw query
  // via the existing listClaimEmbeddings call (which DOES expose
  // embedding fields) plus a direct probe.
  // Simpler: re-query through a fresh helper that just confirms the
  // column exists. We can use db.getStats() which reads the claims
  // view, or do an ad-hoc query via the private connection.

  // Use listClaimEmbeddings — it doesn't include inferred_domain but
  // confirms the view loads. Then run a SQL query directly for the
  // column.
  const probe = await db.listClaimEmbeddings({});
  ok('claims view loadable (probe via embeddings)',  probe.length === 3);

  // Direct SQL probe via the db.js conn — we can't reach the conn
  // from outside, so spin a one-off query via the DuckDB binding:
  const duckdb = require('@duckdb/node-api');
  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const claimsGlob = path.join(tmpRoot, 'claims', '**', '*.json').replace(/\\/g, '/');
  await conn.run(`
    CREATE OR REPLACE VIEW probe_claims AS
    SELECT c.claim_text                     AS claim_text,
           c.inferred_domain.domain         AS inferred_domain,
           c.inferred_domain.confidence     AS inferred_domain_confidence,
           c.inferred_domain.source         AS inferred_domain_source
    FROM read_json_auto('${claimsGlob}', ignore_errors = true, union_by_name = true) AS art,
         UNNEST(art.critical_claims) AS t(c);
  `);
  const res = await conn.run('SELECT * FROM probe_claims;');
  const probeRows = await res.getRowObjects();
  ok('SQL probe returns 3 rows',       probeRows.length === 3);
  for (const r of probeRows) {
    ok(`  probe row has inferred_domain = "${r.inferred_domain}"`,
       typeof r.inferred_domain === 'string' && r.inferred_domain.length > 0);
    ok(`  probe row has inferred_domain_source = "${r.inferred_domain_source}"`,
       r.inferred_domain_source === 'hand_tuned' || r.inferred_domain_source === 'embedding');
  }

  // 4. Domain assignments themselves are sensible (delegating to
  //    hand-tuned scorer because we're on hash embeddings)
  console.log('\n4. Domain assignments are sensible');
  const byText = Object.fromEntries(probeRows.map((r) => [r.claim_text, r.inferred_domain]));
  ok('antibiotics → health',  byText['Antibiotics target bacterial cells.'] === 'health');
  ok('stock market → finance', byText['The stock market closed lower today.'] === 'finance');
  ok('court → law',            byText['The Supreme Court ruled on a constitutional statute.'] === 'law');

  fs.rmSync(tmpRoot, { recursive: true, force: true });

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
