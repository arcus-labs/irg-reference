'use strict';

const fs = require('fs/promises');
const path = require('path');
const { EXPIRY_DEFAULTS, getFactStorePaths } = require('./config');
const { canonicalizeClaim, normalizeWhitespace } = require('./claim-parser');

function clampConfidence(value, fallback = 0.35) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function monthBucket(isoTimestamp) {
  return String(isoTimestamp || '').slice(0, 7) || 'unknown-month';
}

function stampForFilename(isoTimestamp) {
  return String(isoTimestamp || new Date().toISOString()).replace(/[:.]/g, '-');
}

function getExpiryTimestamp(structuredClaim, createdAt) {
  const created = Date.parse(createdAt);
  const expiryDays = EXPIRY_DEFAULTS[structuredClaim?.domain] || EXPIRY_DEFAULTS.other;
  return new Date(created + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeCandidateSource(source, index) {
  if (typeof source === 'string') {
    const value = normalizeWhitespace(source);
    return value ? {
      url: value,
      title: value,
      why: '',
      source_type: 'unknown',
      retrieved_at: null,
      source_file: null,
      relevant_excerpt: null,
      stance: 'candidate',
      rank: index + 1,
    } : null;
  }

  const url = normalizeWhitespace(source?.url);
  const title = normalizeWhitespace(source?.title || source?.name || url);
  if (!url && !title) return null;

  return {
    url: url || title,
    title,
    why: normalizeWhitespace(source?.why || source?.reason || ''),
    source_type: normalizeWhitespace(source?.source_type || source?.type || 'unknown') || 'unknown',
    retrieved_at: null,
    source_file: null,
    relevant_excerpt: null,
    stance: 'candidate',
    rank: index + 1,
  };
}

function buildCitationRecord(plan, originalQuery, context, createdAt) {
  const structuredClaim = plan.structured_claim || canonicalizeClaim(plan.claim_text || '');
  const sources = (Array.isArray(plan.candidate_sources) ? plan.candidate_sources : [])
    .map(normalizeCandidateSource)
    .filter(Boolean)
    .slice(0, 3);

  return {
    claim_key: structuredClaim.claim_key,
    created_at: createdAt,
    expires_at: getExpiryTimestamp(structuredClaim, createdAt),
    claim: structuredClaim,
    verdict: 'inconclusive',
    confidence: clampConfidence(plan.confidence_prior, 0.35),
    reasoning: normalizeWhitespace(plan.research_direction || 'Candidate sources generated; external verification not yet performed.'),
    sources,
    context: {
      original_query: originalQuery,
      runtime_context: context,
      internal_assessment: plan.internal_assessment || 'uncertain',
      internal_reasoning: plan.internal_reasoning || '',
      search_queries: Array.isArray(plan.search_queries) ? plan.search_queries : [],
      pipeline_stage: 'source_generation_only',
    },
    verification_level: 'provisional',
    verification_status: 'suggested_sources_unverified',
    retrieval_mode: 'llm_generated_source_candidates',
    retrieval_deferred: true,
  };
}

async function appendRetrievalLog(entry) {
  const paths = getFactStorePaths();
  await fs.mkdir(path.dirname(paths.retrievalLog), { recursive: true });
  await fs.appendFile(paths.retrievalLog, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function writeCitationArtifacts({ claimPlans, originalQuery, context }) {
  const startedAt = Date.now();
  const paths = getFactStorePaths();
  const generatedAt = new Date().toISOString();
  const bucket = monthBucket(generatedAt);
  const citationDir = path.join(paths.citationDir, bucket);
  await fs.mkdir(citationDir, { recursive: true });

  const citations = [];
  const claims = [];

  for (const plan of claimPlans || []) {
    const citation = buildCitationRecord(plan, originalQuery, context, generatedAt);
    const filename = `${stampForFilename(generatedAt)}--${citation.claim_key}.json`;
    const citationPath = path.join(citationDir, filename);
    const relativePath = path.relative(paths.factStoreRoot, citationPath);

    if (citation.sources.length > 0) {
      await fs.writeFile(citationPath, JSON.stringify(citation, null, 2), 'utf8');
      citations.push(citation);
    }

    claims.push({
      claim_key: citation.claim_key,
      claim_text: citation.claim.raw_text,
      verification_status: citation.sources.length > 0
        ? 'candidate_sources_written_unverified'
        : 'candidate_source_generation_failed',
      citation_file: citation.sources.length > 0 ? relativePath : null,
      candidate_sources_count: citation.sources.length,
      search_queries: citation.context.search_queries,
    });

    await appendRetrievalLog({
      timestamp: generatedAt,
      claim_key: citation.claim_key,
      claim_text: citation.claim.raw_text,
      action: 'llm_source_generation',
      urls_attempted: citation.sources.map((source) => source.url),
      urls_succeeded: [],
      urls_failed: [],
      duration_ms: Date.now() - startedAt,
      verification_level: citation.verification_level,
      citation_file: citation.sources.length > 0 ? relativePath : null,
    });
  }

  const totalCandidateSources = claims.reduce((sum, claim) => sum + claim.candidate_sources_count, 0);

  return {
    generated_at: generatedAt,
    fact_store_root: paths.factStoreRoot,
    retrieval_mode: 'llm_generated_source_candidates',
    retrieval_deferred: true,
    claims,
    citations,
    summary: {
      total_claims: claims.length,
      written_citations: citations.length,
      skipped_claims: claims.filter((claim) => !claim.citation_file).length,
      total_candidate_sources: totalCandidateSources,
      retrieval_log_entries: claims.length,
    },
    confidence: claims.length
      ? Number((claims.reduce((sum, plan) => sum + clampConfidence(plan.candidate_sources_count > 0 ? 0.45 : 0.2), 0) / claims.length).toFixed(2))
      : 1,
  };
}

module.exports = {
  writeCitationArtifacts,
};