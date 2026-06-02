#!/usr/bin/env node
'use strict';

/**
 * Seed the Reg E rule pack as first-class fact-store citations.
 *
 * Each Reg E rule (knowledge/reg-e-claims.json) is materialized two ways:
 *
 *   1. As a VERIFIED CITATION JSON under `_fact-store/citations/reg-e-pack/<rule_id>.json`,
 *      so the existing memoryRecall / build-citable-set / DuckDB query paths surface
 *      it as a citable evidence record — same as any other verified citation in the
 *      store. The rule text is the supporting span; the § + eCFR URL is the source.
 *
 *   2. As a CLAIM ARTIFACT (with an embedding) via the dedup-aware async writer, so
 *      ClaimIndex semantic retrieval can find it.
 *
 * This is the substrate layer of the Cognitive Engineering separation: regulatory
 * knowledge is a persistent, versioned, queryable artifact — not a runtime injection.
 *
 * Idempotent: stable filenames; the embedded-claim writer dedupes against fresh
 * on-disk claims. Re-running updates citation files and skips redundant claim writes.
 *
 * Usage:
 *   node demos/reg-e/scripts/seed-reg-e-rule-citations.js [--fact-store <path>]
 *   FACT_STORE_ROOT=/path/to/store node demos/reg-e/scripts/seed-reg-e-rule-citations.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

// Allow CLI override of FACT_STORE_ROOT before the fact-store modules read it.
const argv = process.argv.slice(2);
const rootFlagIndex = argv.indexOf('--fact-store');
if (rootFlagIndex !== -1 && argv[rootFlagIndex + 1]) {
  process.env.FACT_STORE_ROOT = path.resolve(argv[rootFlagIndex + 1]);
}

const { canonicalizeClaim } = require('../../../core/external-fact-check/claim-parser');
const { getFactStorePaths } = require('../../../core/external-fact-check/config');
const { writeFactCheckClaimsArtifact } = require('../../../core/external-fact-check/claim-store');

const KNOWLEDGE_PATH = path.resolve(__dirname, '..', 'knowledge', 'reg-e-claims.json');
const FAR_FUTURE_EXPIRES = '2099-12-31T00:00:00.000Z';
const PACK_SUBDIR = 'reg-e-pack';

function buildCitation(rule, structuredClaim, now) {
  return {
    claim_key: structuredClaim.claim_key,
    claim: structuredClaim,
    verdict: 'supported',
    verification_level: 'verified',
    verification_status: 'verified_supported',
    confidence: 0.95,
    created_at: now,
    verified_at: now,
    expires_at: FAR_FUTURE_EXPIRES,
    retrieval_mode: 'regulatory_pack',
    retrieval_deferred: false,
    sources: [
      {
        url: rule.url,
        title: rule.section,
        supporting_span: rule.supporting_span,
        verification: {
          verdict: 'supported',
          confidence: 0.95,
          quoted_excerpt: rule.supporting_span,
          // Curated by the rule pack maintainer, not an LLM judgment.
          llm_used: false,
          verified_at: now,
        },
      },
    ],
    provenance: {
      regulation_pack: 'reg-e-v0.1',
      rule_id: rule.id,
      topic: rule.topic || null,
    },
  };
}

async function main() {
  const pack = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
  const { factStoreRoot, citationDir } = getFactStorePaths();
  const packDir = path.join(citationDir, PACK_SUBDIR);
  fs.mkdirSync(packDir, { recursive: true });

  const now = new Date().toISOString();
  let written = 0;
  let unchanged = 0;

  console.log(`[seed-reg-e] Fact-store: ${factStoreRoot}`);
  console.log(`[seed-reg-e] Pack:       ${pack.pack}  (${pack.claims.length} rules)`);
  console.log(`[seed-reg-e] Pack dir:   ${path.relative(factStoreRoot, packDir)}\n`);

  // ---- 1) Write each rule as a verified citation -----------------------
  for (const rule of pack.claims) {
    const structured = canonicalizeClaim(rule.claim);
    const citation = buildCitation(rule, structured, now);
    const filename = `${rule.id}.json`;
    const filepath = path.join(packDir, filename);

    // Idempotency: if the existing citation file already represents the same
    // claim_key + source URL + supporting_span, skip rewriting (keeps mtimes
    // stable). Otherwise overwrite.
    let identical = false;
    if (fs.existsSync(filepath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        identical = existing.claim_key === citation.claim_key
          && existing.sources?.[0]?.url === citation.sources[0].url
          && existing.sources?.[0]?.supporting_span === citation.sources[0].supporting_span
          && existing.provenance?.regulation_pack === citation.provenance.regulation_pack;
      } catch { identical = false; }
    }

    if (identical) {
      unchanged++;
      console.log(`  · ${rule.id.padEnd(36)} ${rule.section}  (unchanged)`);
    } else {
      fs.writeFileSync(filepath, JSON.stringify(citation, null, 2));
      written++;
      console.log(`  ✓ ${rule.id.padEnd(36)} ${rule.section}`);
    }
  }

  // ---- 2) Write claim artifacts with embeddings for ClaimIndex --------
  // The async writer dedupes against fresh on-disk claim_keys, so re-runs
  // are a no-op once the corpus is in place.
  const claimsResult = await writeFactCheckClaimsArtifact({
    criticalClaims: pack.claims.map((rule) => ({
      claim: rule.claim,
      importance: rule.section,
      assessment: 'true',
      reasoning: `Reg E rule (${rule.section}). Pack ${pack.pack}.`,
    })),
    summary: pack.regulation,
    confidence: 1,
    originalQuery: 'reg-e knowledge pack',
    context: { pack: pack.pack },
    iteration: 0,
    sourceNode: 'regEPackSeed',
  });

  console.log(`\n[seed-reg-e] Citations:     ${written} written · ${unchanged} unchanged`);
  if (claimsResult?.write_skipped) {
    console.log(`[seed-reg-e] Claim artifact: skipped (already on disk; ${claimsResult.deduplicated_count} dedup hits)`);
  } else if (claimsResult) {
    console.log(`[seed-reg-e] Claim artifact: ${claimsResult.artifact_path}`);
    if (claimsResult.embeddings_attached !== undefined) {
      console.log(`[seed-reg-e] Embeddings:     ${claimsResult.embeddings_attached} attached`);
    }
  }
}

main().catch((err) => {
  console.error('seed-reg-e failed:', err.stack || err.message);
  process.exit(1);
});
