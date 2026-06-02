'use strict';

/**
 * Generic rule-citation seeder for any adjudication domain.
 *
 * Materializes a knowledge pack (claims JSON) two ways:
 *   1. As VERIFIED CITATION JSON under
 *      `_fact-store/citations/<packSubdir>/<rule_id>.json` so the recall +
 *      build-citable-set paths surface each rule as a citable record.
 *   2. As CLAIM ARTIFACTS (with embeddings) for ClaimIndex semantic retrieval.
 *
 * This is the Substrate layer of the Cognitive Engineering separation:
 * regulatory knowledge as a persistent, versioned, queryable artifact —
 * domain-agnostic, parameterized only by the pack file + subdir.
 *
 * Each domain ships a thin `scripts/seed-*.js` that calls seedRuleCitations().
 */

const fs = require('fs');
const path = require('path');

const { canonicalizeClaim } = require('../../core/external-fact-check/claim-parser');
const { getFactStorePaths } = require('../../core/external-fact-check/config');
const { writeFactCheckClaimsArtifact } = require('../../core/external-fact-check/claim-store');

const FAR_FUTURE_EXPIRES = '2099-12-31T00:00:00.000Z';

function buildCitation(rule, structuredClaim, now, packName) {
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
          llm_used: false,
          verified_at: now,
        },
      },
    ],
    provenance: {
      regulation_pack: packName,
      rule_id: rule.id,
      topic: rule.topic || null,
    },
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.knowledgePath  absolute path to the claims JSON
 * @param {string} opts.packSubdir     citation subdir, e.g. 'reg-z-pack'
 * @param {string} opts.tag            log tag, e.g. 'seed-reg-z'
 */
async function seedRuleCitations({ knowledgePath, packSubdir, tag = 'seed' }) {
  const pack = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  // `corpus` is the generic label for the knowledge body; legacy packs use
  // `regulation`. Either works (fintech packs use `regulation`; the radiology
  // pack uses `corpus`).
  const corpusLabel = pack.corpus || pack.regulation || pack.pack;
  const { factStoreRoot, citationDir } = getFactStorePaths();
  const packDir = path.join(citationDir, packSubdir);
  fs.mkdirSync(packDir, { recursive: true });

  const now = new Date().toISOString();
  let written = 0;
  let unchanged = 0;

  console.log(`[${tag}] Fact-store: ${factStoreRoot}`);
  console.log(`[${tag}] Pack:       ${pack.pack}  (${pack.claims.length} rules)`);
  console.log(`[${tag}] Pack dir:   ${path.relative(factStoreRoot, packDir)}\n`);

  for (const rule of pack.claims) {
    const structured = canonicalizeClaim(rule.claim);
    const citation = buildCitation(rule, structured, now, pack.pack);
    const filepath = path.join(packDir, `${rule.id}.json`);

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

  const claimsResult = await writeFactCheckClaimsArtifact({
    criticalClaims: pack.claims.map((rule) => ({
      claim: rule.claim,
      importance: rule.section,
      assessment: 'true',
      reasoning: `${corpusLabel} (${rule.section}). Pack ${pack.pack}.`,
    })),
    summary: corpusLabel,
    confidence: 1,
    originalQuery: `${pack.pack} knowledge pack`,
    context: { pack: pack.pack },
    iteration: 0,
    sourceNode: `${packSubdir}Seed`,
  });

  console.log(`\n[${tag}] Citations:     ${written} written · ${unchanged} unchanged`);
  if (claimsResult?.write_skipped) {
    console.log(`[${tag}] Claim artifact: skipped (already on disk; ${claimsResult.deduplicated_count} dedup hits)`);
  } else if (claimsResult) {
    console.log(`[${tag}] Claim artifact: ${claimsResult.artifact_path}`);
    if (claimsResult.embeddings_attached !== undefined) {
      console.log(`[${tag}] Embeddings:     ${claimsResult.embeddings_attached} attached`);
    }
  }
}

module.exports = { seedRuleCitations };
