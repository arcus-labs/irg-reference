/**
 * Targeted tests for the external fact check node.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const externalFactCheckNode = require('../core/nodes/external-fact-check-node');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');
const { getFactStorePaths } = require('../core/external-fact-check/config');

async function runTest() {
  const previousRoot = process.env.FACT_STORE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'irg-fact-store-'));

  try {
    delete process.env.FACT_STORE_ROOT;
    assert.equal(
      getFactStorePaths().factStoreRoot,
      path.resolve(__dirname, '../../_fact-store')
    );

    process.env.FACT_STORE_ROOT = tempRoot;

    const citationsDir = path.join(tempRoot, 'citations', '2026-03');
    fs.mkdirSync(citationsDir, { recursive: true });

    const cachedClaimText = 'Mars is a planet.';
    const provisionalClaimText = 'Jupiter has rings.';
    const uncachedClaimText = 'Venus has liquid water oceans.';
    const structuredClaim = canonicalizeClaim(cachedClaimText);
    const provisionalStructuredClaim = canonicalizeClaim(provisionalClaimText);

    const citation = {
      claim_key: structuredClaim.claim_key,
      claim: structuredClaim,
      verdict: 'supported',
      created_at: '2026-03-01T00:00:00.000Z',
      expires_at: '2099-03-01T00:00:00.000Z',
      // Production citations always carry these fields (citationWrite/Verify
      // set them). The DuckDB citations view references them, so fixtures must
      // include them or read_json_auto's column binding fails on a sparse store.
      verification_level: 'verified',
      verification_status: 'verified_supported',
      retrieval_mode: 'fetched_unverified',
      retrieval_deferred: false,
      confidence: 0.9,
      sources: [
        {
          title: 'Example Mars Reference',
          url: 'https://example.com/mars',
        },
      ],
    };

    const provisionalCitation = {
      claim_key: provisionalStructuredClaim.claim_key,
      claim: provisionalStructuredClaim,
      verdict: 'inconclusive',
      confidence: 0.42,
      reasoning: 'Candidate sources generated; external verification pending.',
      created_at: '2026-03-02T00:00:00.000Z',
      expires_at: '2099-03-02T00:00:00.000Z',
      sources: [
        {
          title: 'NASA Jupiter Overview',
          url: 'https://science.nasa.gov/jupiter/',
          stance: 'candidate',
        },
      ],
      verification_level: 'provisional',
      verification_status: 'suggested_sources_unverified',
      retrieval_mode: 'llm_generated_source_candidates',
      retrieval_deferred: true,
      context: {
        pipeline_stage: 'source_generation_only',
      },
    };

    fs.writeFileSync(
      path.join(citationsDir, `${structuredClaim.claim_key}.json`),
      JSON.stringify(citation, null, 2)
    );
    fs.writeFileSync(
      path.join(citationsDir, `${provisionalStructuredClaim.claim_key}--generated.json`),
      JSON.stringify(provisionalCitation, null, 2)
    );

    const initialState = {
      iteration: 0,
      nodes: [],
      history: [],
      factCheckResult: {
        critical_claims: [
          {
            claim: cachedClaimText,
            importance: 'Needed for the astronomy answer.',
            assessment: 'true',
            reasoning: 'Basic astronomy.',
            source: null,
          },
          {
            claim: provisionalClaimText,
            importance: 'Used to verify provisional source artifact behavior.',
            assessment: 'uncertain',
            reasoning: 'No verified source yet.',
            source: null,
          },
          {
            claim: uncachedClaimText,
            importance: 'Used to verify miss behavior.',
            assessment: 'uncertain',
            reasoning: 'No source available.',
            source: null,
          },
        ],
      },
    };

    const prepared = externalFactCheckNode.prepare(initialState);

    // The claims artifact is persisted during the async llmCall (the
    // dedup/embedding/classifier-aware writer), NOT in the sync prepare().
    // Drive the full node lifecycle, then assert on the written artifact.
    const externalResult = await externalFactCheckNode.llmCall(prepared);
    const processed = externalFactCheckNode.process(prepared, externalResult);

    const artifactPath = path.join(tempRoot, processed.factCheckResult.artifact_path);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    assert.ok(processed.factCheckResult.artifact_path);
    assert.ok(fs.existsSync(artifactPath));
    assert.equal(artifact.critical_claim_count, 3);
    assert.equal(artifact.critical_claims[0].structured_claim.claim_kind, 'factual_assertion');
    assert.equal(typeof artifact.critical_claims[0].structured_claim.domain_confidence, 'number');
    assert.ok(fs.existsSync(path.join(tempRoot, 'metadata', 'fact_check_log.jsonl')));

    assert.equal(processed.externalFactCheckResult.summary.total_claims, 3);
    assert.equal(processed.externalFactCheckResult.summary.cache_hits, 1);
    assert.equal(processed.externalFactCheckResult.summary.cache_misses, 1);
    assert.equal(processed.externalFactCheckResult.summary.provisional_hits, 1);
    assert.equal(processed.externalFactCheckResult.summary.exact_hits, 2);

    const hit = processed.externalFactCheckResult.claims.find((claim) => claim.claim_text === cachedClaimText);
    const provisional = processed.externalFactCheckResult.claims.find((claim) => claim.claim_text === provisionalClaimText);
    const miss = processed.externalFactCheckResult.claims.find((claim) => claim.claim_text === uncachedClaimText);

    assert.ok(hit);
    assert.ok(provisional);
    assert.ok(miss);
    assert.equal(hit.verification_status, 'cached_verification_available');
    assert.equal(hit.cache_hit, true);
    assert.equal(hit.match_type, 'exact');
    assert.equal(provisional.verification_status, 'cached_provisional_sources_available');
    assert.equal(provisional.cache_hit, false);
    assert.equal(provisional.provisional, true);
    assert.equal(miss.verification_status, 'cache_miss_retrieval_deferred');
    assert.equal(miss.cache_hit, false);
    assert.equal(hit.structured_claim.domain, 'science');
    assert.equal(typeof hit.structured_claim.domain_confidence, 'number');
    assert.ok(typeof processed.factCheckResult.artifact_path === 'string' && processed.factCheckResult.artifact_path.length > 0);
    assert.ok(processed.nodes.some((node) => node.type === 'external_fact_check'));

    console.log('✓ external fact check node verified/provisional/miss behavior validated');
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACT_STORE_ROOT;
    } else {
      process.env.FACT_STORE_ROOT = previousRoot;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

runTest().catch((error) => {
  console.error('❌ external fact check node test failed');
  console.error(error.stack || error.message);
  process.exit(1);
});