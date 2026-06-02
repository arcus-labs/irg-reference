'use strict';

const path = require('path');
const { recordNode } = require('./node-utils');
const { getFactStorePaths } = require('../external-fact-check/config');
const { canonicalizeClaim } = require('../external-fact-check/claim-parser');
const { lookupCachedCitation } = require('../external-fact-check/cache-lookup');
const {
  ensureFactCheckClaimsArtifact,
  getFactCheckClaimsSync,
} = require('../external-fact-check/claim-store');

function isProvisionalCitation(citation) {
  return citation?.verification_level === 'provisional'
    || citation?.verification_status === 'suggested_sources_unverified'
    || citation?.retrieval_mode === 'llm_generated_source_candidates'
    || citation?.context?.pipeline_stage === 'source_generation_only';
}

function buildClaimResult(originalClaim, structuredClaim, cachedMatch) {
  const paths = getFactStorePaths();
  if (!cachedMatch) {
    return {
      claim_text: originalClaim.claim,
      internal_assessment: originalClaim.assessment,
      internal_reasoning: originalClaim.reasoning,
      structured_claim: structuredClaim,
      claim_key: structuredClaim.claim_key,
      cache_hit: false,
      artifact_hit: false,
      provisional: false,
      expired: false,
      match_type: null,
      verification_status: 'cache_miss_retrieval_deferred',
      citation: null,
      cache_file: null,
      notes: 'No cached citation found. Live external retrieval is deferred in v1.',
    };
  }

  const provisional = isProvisionalCitation(cachedMatch.citation);
  const verificationStatus = provisional
    ? (cachedMatch.expired ? 'expired_provisional_sources_available' : 'cached_provisional_sources_available')
    : cachedMatch.expired
      ? 'expired_cache_entry_retrieval_deferred'
      : 'cached_verification_available';

  return {
    claim_text: originalClaim.claim,
    internal_assessment: originalClaim.assessment,
    internal_reasoning: originalClaim.reasoning,
    structured_claim: structuredClaim,
    claim_key: structuredClaim.claim_key,
    cache_hit: !cachedMatch.expired && !provisional,
    artifact_hit: true,
    provisional,
    expired: cachedMatch.expired,
    match_type: cachedMatch.match_type,
    verification_status: verificationStatus,
    citation: cachedMatch.citation,
    cache_file: path.relative(paths.factStoreRoot, cachedMatch.file_path),
    notes: provisional
      ? 'Using cached provisional source suggestions from the local fact store. External verification is still pending.'
      : cachedMatch.expired
        ? 'Cached citation exists but is expired. Live refresh is deferred in v1.'
        : 'Using cached external citation from the local fact store.',
  };
}

function buildSummary(claimResults) {
  const summary = {
    total_claims: claimResults.length,
    cache_hits: 0,
    cache_misses: 0,
    expired_hits: 0,
    provisional_hits: 0,
    exact_hits: 0,
    partial_hits: 0,
    fuzzy_hits: 0,
    supported: 0,
    refuted: 0,
    inconclusive: 0,
    pending_verification: 0,
    retrieval_deferred: true,
  };

  for (const result of claimResults) {
    if (result.cache_hit) summary.cache_hits += 1;
    if (!result.cache_hit && !result.expired && !result.provisional && !result.citation) summary.cache_misses += 1;
    if (result.expired) summary.expired_hits += 1;
    if (result.provisional) summary.provisional_hits += 1;
    if (result.match_type === 'exact') summary.exact_hits += 1;
    if (result.match_type === 'partial') summary.partial_hits += 1;
    if (result.match_type === 'fuzzy') summary.fuzzy_hits += 1;

    if (result.provisional || result.expired) {
      summary.pending_verification += 1;
      continue;
    }

    const verdict = String(result.citation?.verdict || '').toLowerCase();
    if (verdict === 'supported') summary.supported += 1;
    else if (verdict === 'refuted') summary.refuted += 1;
    else if (verdict) summary.inconclusive += 1;
    else summary.pending_verification += 1;
  }

  return summary;
}

function buildConfidence(claimResults) {
  if (!claimResults.length) return 1;

  const total = claimResults.reduce((sum, result) => {
    if (result.cache_hit) return sum + 0.85;
    if (result.provisional) return sum + 0.45;
    if (result.expired) return sum + 0.5;
    return sum + 0.2;
  }, 0);

  return Number((total / claimResults.length).toFixed(2));
}

async function evaluateClaims(claims) {
  const claimResults = await Promise.all(claims.map(async (claim) => {
    const structuredClaim = canonicalizeClaim(claim.claim, {}, {
      originalQuery: claim.original_query,
      context: claim.context,
    });
    const cachedMatch = await lookupCachedCitation(structuredClaim);
    return buildClaimResult(claim, structuredClaim, cachedMatch);
  }));

  const paths = getFactStorePaths();
  return {
    retrieval_mode: 'filesystem_cache_only',
    retrieval_deferred: claimResults.some((result) => !result.cache_hit),
    generated_at: new Date().toISOString(),
    fact_store_root: paths.factStoreRoot,
    claims: claimResults,
    citations: claimResults.filter((result) => result.citation).map((result) => result.citation),
    summary: buildSummary(claimResults),
    confidence: buildConfidence(claimResults),
  };
}

const externalFactCheckNode = {
  id: 'externalFactCheck',
  type: 'external_fact_check',

  prepare(state) {
    // The artifact write happens in `llmCall` (which is async). We
    // can't call the async writer here because `prepare` is sync per
    // the interpreter's contract.
    return {
      ...state,
      currentPhase: 'externalFactCheck',
    };
  },

  async llmCall(state) {
    // Persist via the async (dedup + embedding + classifier aware)
    // writer. This ensures claims arriving via the standalone
    // fact-check endpoint participate in semantic recall, not just
    // the irg-external-facts pipeline path.
    const factCheckResult = await ensureFactCheckClaimsArtifact({
      factCheckResult: state.factCheckResult,
      originalQuery: state.originalQuery,
      context: state.context,
      iteration: state.iteration || 0,
      sourceNode: 'externalFactCheck',
    });
    const claims = getFactCheckClaimsSync(factCheckResult);
    const evaluation = await evaluateClaims(claims);
    // Tuck the updated factCheckResult into the response so process()
    // can stash it back on state.
    return { evaluation, factCheckResult };
  },

  process(state, llmResult) {
    const externalResult = llmResult?.evaluation;
    const updatedFactCheckResult = llmResult?.factCheckResult || state.factCheckResult;
    const result = externalResult && typeof externalResult === 'object'
      ? externalResult
      : {
        retrieval_mode: 'filesystem_cache_only',
        retrieval_deferred: true,
        generated_at: new Date().toISOString(),
        fact_store_root: getFactStorePaths().factStoreRoot,
        claims: [],
        citations: [],
        summary: buildSummary([]),
        confidence: 1,
      };

    const node = {
      id: `node_external_fact_check_${state.iteration || 0}`,
      type: 'external_fact_check',
      goal: 'Check critical claims against the local citation cache and flag external retrieval gaps',
      content: result,
      raw_output: JSON.stringify(result),
      status: 'completed',
      confidence: Number(result.confidence ?? 0.5),
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, factCheckResult: updatedFactCheckResult, externalFactCheckResult: result },
      node,
      'externalFactCheck'
    );
  },
};

module.exports = externalFactCheckNode;