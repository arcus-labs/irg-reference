'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getFactStorePaths } = require('./config');
const { canonicalizeClaim, normalizeWhitespace } = require('./claim-parser');

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
    structured_claim: structuredClaim,
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
  writeFactCheckClaimsArtifactSync,
  readFactCheckClaimsArtifactSync,
  ensureFactCheckClaimsArtifactSync,
  getFactCheckClaimsSync,
  buildFactCheckPromptResultSync,
};