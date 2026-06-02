'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getFactStorePaths } = require('./config');
const { canonicalizeClaim, normalizeWhitespace } = require('./claim-parser');
const { deriveClaimUuid } = require('../citations/citation-id');
const db = require('./db');
const { getEmbeddings } = require('../llm/embeddings');
const { classifyDomains } = require('./domain-classifier');

function monthBucket(timestamp) {
  return String(timestamp || new Date().toISOString()).slice(0, 7);
}

function stampForFilename(timestamp) {
  return String(timestamp || new Date().toISOString()).replace(/[:.]/g, '-');
}

function normalizeFactCheckClaims(criticalClaims, defaults = {}) {
  const claims = Array.isArray(criticalClaims) ? criticalClaims : [];

  return claims
    .map((claim, index) => {
      if (typeof claim === 'string') {
        return {
          claim: normalizeWhitespace(claim),
          importance: '',
          assessment: 'uncertain',
          reasoning: '',
          source: null,
          claim_index: index,
          original_query: normalizeWhitespace(defaults.originalQuery || ''),
          context: defaults.context ?? null,
        };
      }

      return {
        claim: normalizeWhitespace(claim?.claim || claim?.claim_text || claim?.raw_text || ''),
        importance: claim?.importance || '',
        assessment: claim?.assessment || 'uncertain',
        reasoning: claim?.reasoning || '',
        source: claim?.source ?? null,
        claim_index: Number.isFinite(claim?.claim_index) ? claim.claim_index : index,
        original_query: normalizeWhitespace(claim?.original_query || defaults.originalQuery || ''),
        context: claim?.context ?? defaults.context ?? null,
        // Preserve embedding when caller pre-attached one (the async
        // wrapper does this); sync callers leave it undefined and the
        // persisted record gets `embedding: null`.
        embedding: claim?.embedding ?? null,
        // Same for the embedding-based classifier output (item #12).
        // Sync callers leave inferred_domain null and only the legacy
        // hand-tuned `structured_claim.domain` is populated.
        inferred_domain: claim?.inferred_domain ?? null,
      };
    })
    .filter((claim) => claim.claim);
}

function buildPersistedClaim(claim, index) {
  const structuredClaim = canonicalizeClaim(claim.claim, {}, {
    originalQuery: claim.original_query,
    context: claim.context,
  });
  return {
    claim_index: Number.isFinite(claim.claim_index) ? claim.claim_index : index,
    claim_text: claim.claim,
    importance: claim.importance || '',
    assessment: claim.assessment || 'uncertain',
    reasoning: claim.reasoning || '',
    source: claim.source ?? null,
    claim_key: structuredClaim.claim_key,
    // Durable citation handle (Citation_Application.md §2). Derived
    // deterministically from claim_key so the same claim always maps to the
    // same uuid across sessions and polyglot ports.
    uuid: deriveClaimUuid(structuredClaim.claim_key),
    structured_claim: structuredClaim,
    // Inline embedding for semantic recall (item #11). Older claim
    // artifacts without this field continue to load via union_by_name
    // in the DuckDB view; they just won't participate in semantic
    // neighbor search until they're re-extracted.
    embedding: claim.embedding ?? null,
    // Inline classifier output (item #12). Coexists with
    // `structured_claim.domain` (the hand-tuned classifier whose
    // output is part of the claim_key hash). Use `inferred_domain.domain`
    // for display / analytics; use `structured_claim.domain` for
    // anything that needs to round-trip with the claim_key.
    inferred_domain: claim.inferred_domain ?? null,
  };
}

function buildArtifactFilename(generatedAt, iteration, persistedClaims) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      generatedAt,
      iteration: iteration || 0,
      claim_keys: persistedClaims.map((claim) => claim.claim_key),
    }))
    .digest('hex')
    .slice(0, 12);

  return `${stampForFilename(generatedAt)}--fact-check-claims--${digest}.json`;
}

function appendFactCheckLogSync(entry) {
  const paths = getFactStorePaths();
  fs.mkdirSync(paths.metadataDir, { recursive: true });
  fs.appendFileSync(paths.factCheckLog, `${JSON.stringify(entry)}\n`, 'utf8');
}

function writeFactCheckClaimsArtifactSync({ criticalClaims, summary, confidence, originalQuery, context, iteration, sourceNode, rawOutput }) {
  const generatedAt = new Date().toISOString();
  const paths = getFactStorePaths();
  const persistedClaims = normalizeFactCheckClaims(criticalClaims, { originalQuery, context }).map(buildPersistedClaim);
  const claimBucketDir = path.join(paths.claimsDir, monthBucket(generatedAt));
  fs.mkdirSync(claimBucketDir, { recursive: true });

  const artifact = {
    artifact_type: 'fact_check_claims',
    generated_at: generatedAt,
    source_node: sourceNode || 'factCheck',
    iteration: iteration || 0,
    original_query: originalQuery || '',
    context: context ?? {},
    summary: summary || '',
    confidence: Number(confidence ?? 0.5),
    critical_claim_count: persistedClaims.length,
    critical_claims: persistedClaims,
    raw_llm_output: typeof rawOutput === 'string' ? rawOutput : '',
  };

  const filename = buildArtifactFilename(generatedAt, iteration, persistedClaims);
  const fullPath = path.join(claimBucketDir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(artifact, null, 2), 'utf8');

  const relativePath = path.relative(paths.factStoreRoot, fullPath);
  appendFactCheckLogSync({
    timestamp: generatedAt,
    action: 'fact_claims_persisted',
    source_node: artifact.source_node,
    iteration: artifact.iteration,
    artifact_path: relativePath,
    claim_count: artifact.critical_claim_count,
    query: artifact.original_query,
  });

  return {
    artifact_type: 'fact_check_claims',
    storage: 'filesystem_artifact',
    generated_at: generatedAt,
    source_node: artifact.source_node,
    iteration: artifact.iteration,
    fact_store_root: paths.factStoreRoot,
    artifact_path: relativePath,
    critical_claim_count: artifact.critical_claim_count,
    summary: artifact.summary,
    confidence: artifact.confidence,
  };
}

/**
 * Async, dedup-aware variant of `writeFactCheckClaimsArtifactSync`.
 *
 * Before writing, queries the DuckDB-backed fact-store to see whether
 * every claim_key in the batch already has a fresh on-disk entry. If
 * so, the write is skipped and a synthetic "write_skipped" record is
 * returned that downstream consumers can still process via the inline
 * `critical_claims` field.
 *
 * Mixed batches (some fresh, some new) are written normally; the
 * returned record carries a `deduplicated_count` so callers can
 * surface how many claims were already known.
 *
 * Why skip-entire-batch rather than filter-and-write? See the design
 * note in the dedup PR — keeping all claims in the artifact lets the
 * downstream external pipeline see exactly what the LLM extracted,
 * not a confusing subset.
 */
async function writeFactCheckClaimsArtifact(params) {
  const {
    criticalClaims,
    summary,
    confidence,
    originalQuery,
    context,
    iteration,
    sourceNode,
  } = params;

  const normalizedClaims = normalizeFactCheckClaims(criticalClaims, { originalQuery, context });
  if (normalizedClaims.length === 0) return null;

  // Compute claim_keys for the dedup query. The writer below also
  // canonicalizes; we accept the duplicate work because canonicalization
  // is cheap (string ops + sha256) and the alternative (passing
  // pre-canonicalized claims through) ripples through the public API.
  const claimKeys = normalizedClaims.map((claim) =>
    canonicalizeClaim(claim.claim, {}, { originalQuery, context }).claim_key
  );

  let freshKeys;
  try {
    freshKeys = await db.findFreshClaimKeys(claimKeys);
  } catch (err) {
    // Dedup is an optimization, not a correctness requirement. If the
    // query layer is unavailable, fall back to always-write.
    console.warn('[claim-store] dedup check failed, falling back to always-write:', err.message);
    freshKeys = new Set();
  }

  if (freshKeys.size === claimKeys.length) {
    // Every claim already on disk and not expired — skip the write.
    return {
      artifact_type: 'fact_check_claims',
      storage: 'filesystem_artifact_skipped',
      generated_at: new Date().toISOString(),
      source_node: sourceNode || 'factCheck',
      iteration: iteration || 0,
      critical_claim_count: normalizedClaims.length,
      deduplicated_count: normalizedClaims.length,
      write_skipped: true,
      summary: summary || '',
      confidence: Number(confidence ?? 0.5),
      // Inline claims so callers that read from this object directly
      // (rather than from disk) still get the data.
      critical_claims: normalizedClaims.map((claim, i) => ({
        ...claim,
        claim_key: claimKeys[i],
      })),
    };
  }

  // At least one claim is new — generate embeddings (item #11) AND
  // classify domains via the embedding-based classifier (item #12)
  // for the batch. Both are best-effort: the embeddings module falls
  // back internally if a provider fails, and the classifier delegates
  // to the legacy hand-tuned scorer when only the hash embedder is
  // available. We still wrap in try/catch so an unforeseen explosion
  // never blocks claim persistence.
  const claimTexts = normalizedClaims.map((c) => c.claim);

  let embeddings = [];
  try {
    embeddings = await getEmbeddings(claimTexts);
  } catch (err) {
    console.warn('[claim-store] embedding generation failed (claims will persist without embeddings):', err.message);
    embeddings = new Array(normalizedClaims.length).fill(null);
  }

  let inferredDomains = [];
  try {
    inferredDomains = await classifyDomains(claimTexts);
  } catch (err) {
    console.warn('[claim-store] domain classification failed (claims will persist without inferred_domain):', err.message);
    inferredDomains = new Array(normalizedClaims.length).fill(null);
  }

  // Re-emit the batch with embeddings + inferred_domain inlined so the
  // sync writer (and the normalizer it calls) propagates them into
  // the artifact.
  const claimsWithMetadata = normalizedClaims.map((c, i) => ({
    ...c,
    embedding: embeddings[i] || null,
    inferred_domain: inferredDomains[i] || null,
  }));

  const result = writeFactCheckClaimsArtifactSync({
    ...params,
    criticalClaims: claimsWithMetadata,
  });
  return {
    ...result,
    deduplicated_count: freshKeys.size,
    embeddings_attached: embeddings.filter((e) => e && Array.isArray(e.vector)).length,
    inferred_domains_attached: inferredDomains.filter((d) => d && typeof d.domain === 'string').length,
  };
}

function resolveArtifactPath(factCheckResult) {
  const artifactPath = typeof factCheckResult === 'string'
    ? factCheckResult
    : factCheckResult?.artifact_path;

  if (!artifactPath || typeof artifactPath !== 'string') {
    return null;
  }

  return path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(getFactStorePaths().factStoreRoot, artifactPath);
}

function readFactCheckClaimsArtifactSync(factCheckResult) {
  const artifactPath = resolveArtifactPath(factCheckResult);
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.warn('[claim-store] Failed to read fact-check claims artifact:', error.message);
    return null;
  }
}

function ensureFactCheckClaimsArtifactSync({ factCheckResult, originalQuery, context, iteration, sourceNode, rawOutput }) {
  if (factCheckResult?.artifact_path) {
    return factCheckResult;
  }

  const criticalClaims = normalizeFactCheckClaims(factCheckResult?.critical_claims, { originalQuery, context });
  if (!criticalClaims.length) {
    return factCheckResult || {};
  }

  return writeFactCheckClaimsArtifactSync({
    criticalClaims,
    summary: factCheckResult?.summary || '',
    confidence: factCheckResult?.confidence ?? 0.5,
    originalQuery,
    context,
    iteration,
    sourceNode,
    rawOutput,
  });
}

/**
 * Async variant of `ensureFactCheckClaimsArtifactSync` that uses the
 * dedup-aware writer. Generates embeddings + inferred_domain when
 * writing new artifacts, so claims coming in via the standalone
 * fact-check endpoint participate in semantic recall and the
 * classifier features (items #11 + #12).
 *
 * Returns the existing factCheckResult unchanged if it already has
 * `artifact_path` (no write needed).
 */
async function ensureFactCheckClaimsArtifact({ factCheckResult, originalQuery, context, iteration, sourceNode, rawOutput }) {
  if (factCheckResult?.artifact_path) {
    return factCheckResult;
  }

  const criticalClaims = normalizeFactCheckClaims(factCheckResult?.critical_claims, { originalQuery, context });
  if (!criticalClaims.length) {
    return factCheckResult || {};
  }

  return writeFactCheckClaimsArtifact({
    criticalClaims,
    summary: factCheckResult?.summary || '',
    confidence: factCheckResult?.confidence ?? 0.5,
    originalQuery,
    context,
    iteration,
    sourceNode,
    rawOutput,
  });
}

function getFactCheckClaimsSync(factCheckResult) {
  const artifact = readFactCheckClaimsArtifactSync(factCheckResult);
  if (Array.isArray(artifact?.critical_claims)) {
    return normalizeFactCheckClaims(artifact.critical_claims, {
      originalQuery: artifact.original_query,
      context: artifact.context,
    });
  }

  return normalizeFactCheckClaims(factCheckResult?.critical_claims, {
    originalQuery: factCheckResult?.original_query,
    context: factCheckResult?.context,
  });
}

function buildFactCheckPromptResultSync(factCheckResult) {
  const artifact = readFactCheckClaimsArtifactSync(factCheckResult);
  if (!artifact) {
    return factCheckResult && typeof factCheckResult === 'object'
      ? factCheckResult
      : {};
  }

  const { raw_llm_output, ...promptResult } = artifact;
  return promptResult;
}

module.exports = {
  normalizeFactCheckClaims,
  writeFactCheckClaimsArtifact,
  writeFactCheckClaimsArtifactSync,
  readFactCheckClaimsArtifactSync,
  ensureFactCheckClaimsArtifact,
  ensureFactCheckClaimsArtifactSync,
  getFactCheckClaimsSync,
  buildFactCheckPromptResultSync,
};