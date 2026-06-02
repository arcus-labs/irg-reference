'use strict';

/**
 * Memory Recall Node
 *
 * Runs in `irg-simple` after `factCheck`. For each critical claim
 * extracted by the fact-checker, looks up the fact-store for any
 * existing citation we've already accrued for that exact claim_key.
 * Surfaces the recall result in the trace so the user can see which
 * claims the IRG already has verified evidence on.
 *
 * Pure logic (no LLM call). Uses DuckDB for the lookups.
 *
 * Why this node exists:
 *   - The simple graph persists claims on every run (item #3) but
 *     never reads from the store. Without this node, the memory layer
 *     is write-only.
 *   - This is the cheapest way to make memory "real" in the default
 *     flow without rebuilding the full external fact-check pipeline.
 *
 * What this node does NOT do:
 *   - It doesn't influence the draft yet. Downstream nodes can consume
 *     `state.memoryRecallResult` but the draft prompt isn't (yet)
 *     told to cite recalled evidence. That's a follow-up.
 *   - It doesn't fetch or verify anything new — only reads what
 *     `citationVerify` already wrote on a prior run.
 */

const fs = require('fs');
const path = require('path');
const { recordNode } = require('./node-utils');
const db = require('../external-fact-check/db');
const { canonicalizeClaim } = require('../external-fact-check/claim-parser');
const { getFactStorePaths } = require('../external-fact-check/config');
const { getEmbedding, suggestedNeighborThreshold } = require('../llm/embeddings');
const { createClaimIndex } = require('../retrieval/claim-index');

const TOP_K_NEIGHBORS = 3;

const memoryRecallNode = {
  id: 'memoryRecall',
  type: 'memory_recall',

  prepare(state) {
    const factCheckClaims = state.factCheckResult?.critical_claims;
    const claims = Array.isArray(factCheckClaims) ? factCheckClaims : [];
    return {
      ...state,
      memoryRecallInput: { claims, originalQuery: state.originalQuery, context: state.context },
      currentPhase: 'memoryRecall',
    };
  },

  // No LLM call; we use the llmCall slot for the async DB lookups so
  // the interpreter awaits this naturally.
  async llmCall(state) {
    const { claims, originalQuery, context } = state.memoryRecallInput || {};

    if (!claims || claims.length === 0) {
      return emptyResult();
    }

    // If DuckDB isn't initialized OR the store is empty, return a
    // clean all-miss result. This is the "first run ever" case and
    // shouldn't be treated as an error.
    if (!db.isAvailable()) {
      return {
        claims_checked: claims.length,
        previously_seen: 0,
        recalled: 0,
        recalled_verified: 0,
        recall_rate: 0,
        semantic_neighbors_found: 0,
        embedding_provider: null,
        results: claims.map((c) => ({
          claim_text: extractClaimText(c),
          previously_seen: false,
          recall: { hit: false, reason: 'no fact-store data yet' },
          semantic_neighbors: [],
        })),
      };
    }

    // Compute claim_keys up front so we can do batch lookups for
    // "previously seen in prior sessions."
    const structuredClaims = claims
      .map((c) => {
        const text = extractClaimText(c);
        return text ? { text, structured: canonicalizeClaim(text, {}, { originalQuery, context }) } : null;
      })
      .filter(Boolean);
    const claimKeys = structuredClaims.map((s) => s.structured.claim_key);

    // "Previously seen": claim_keys with entries written BEFORE the
    // current session's factCheck write. Excludes the write we just
    // made so users see meaningful "this question matches what you
    // asked last time" signal.
    const sessionCutoff =
      state.factCheckResult?.generated_at
      || state.factCheckResult?.fetched_at
      || new Date().toISOString();
    let priorWriteKeys = new Set();
    try {
      priorWriteKeys = await db.findPriorClaimWrites(claimKeys, sessionCutoff);
    } catch (err) {
      console.warn('[memory-recall] prior-write lookup failed:', err.message);
    }

    // Build the semantic ClaimIndex once (loads the stored claim-embedding
    // corpus and constructs whichever backend CLAIM_INDEX_BACKEND selects —
    // exact brute-force by default, JS-LSH or an SS4 sidecar otherwise). The
    // index is queried once per current claim below. Best-effort: a failure
    // here just means no neighbors surface; exact-match recall still works.
    let claimIndex = null;
    try {
      claimIndex = await createClaimIndex();
    } catch (err) {
      console.warn('[memory-recall] failed to build claim index:', err.message);
    }

    const results = [];
    let priorWriteCount = 0;
    let hits = 0;
    let verifiedHits = 0;
    let totalNeighbors = 0;
    let embeddingProvider = null;

    for (const { text: claimText, structured } of structuredClaims) {
      // -------- exact-match lookup against CITATIONS --------
      let row = null;
      try {
        row = await db.lookupCitationByClaimKey(structured.claim_key);
      } catch (err) {
        results.push({
          claim_text: claimText,
          claim_key: structured.claim_key,
          previously_seen: priorWriteKeys.has(structured.claim_key),
          recall: { hit: false, error: err.message },
          semantic_neighbors: [],
        });
        if (priorWriteKeys.has(structured.claim_key)) priorWriteCount++;
        continue;
      }

      const recall = row
        ? {
            hit: true,
            verdict: row.verdict || null,
            verification_level: row.verification_level || null,
            verification_status: row.verification_status || null,
            source_count: toPlainNumber(row.source_count),
            created_at: stringifyTimestamp(row.created_at),
            expires_at: stringifyTimestamp(row.expires_at),
            citation_path: row.source_file || null,
            // Read source detail + confidence off disk so the citable-set
            // builder can construct a full Reference for recalled citations
            // (irg-simple path). Best-effort: a missing/corrupt file just
            // yields no sources.
            ...readCitationDetail(row.source_file),
          }
        : { hit: false };

      if (row) {
        hits++;
        if (row.verification_level === 'verified') verifiedHits++;
      }

      const seenBefore = priorWriteKeys.has(structured.claim_key);
      if (seenBefore) priorWriteCount++;

      // -------- semantic neighbor search (via ClaimIndex) --------
      // Skip if the index is empty. Embedding generation is best-effort, so a
      // failure here just means no neighbors surface — exact-match recall
      // still works.
      let semanticNeighbors = [];
      if (claimIndex && claimIndex.size() > 0) {
        try {
          semanticNeighbors = await findSemanticNeighbors({
            claimText,
            claimKey: structured.claim_key,
            claimIndex,
          });
          totalNeighbors += semanticNeighbors.length;
          if (!embeddingProvider && semanticNeighbors.length > 0) {
            embeddingProvider = semanticNeighbors[0].embedding_model || null;
          }
        } catch (err) {
          console.warn('[memory-recall] semantic search failed for one claim:', err.message);
        }
      }

      results.push({
        claim_text: claimText,
        claim_key: structured.claim_key,
        previously_seen: seenBefore,
        recall,
        semantic_neighbors: semanticNeighbors,
      });
    }

    return {
      claims_checked: claims.length,
      // "previously_seen": claim_keys with at least one prior-session
      // write in the claims store. This is the most lenient recall
      // signal — independent of whether we've ever generated a citation
      // for the claim.
      previously_seen: priorWriteCount,
      // "recalled": claim_keys with a citation in the store (citations
      // are written by the irg-external-facts pipeline). Stricter than
      // previously_seen.
      recalled: hits,
      recalled_verified: verifiedHits,
      recall_rate: claims.length > 0 ? Number((hits / claims.length).toFixed(2)) : 0,
      semantic_neighbors_found: totalNeighbors,
      embedding_provider: embeddingProvider,
      results,
    };
  },

  async process(state, recallResult) {
    const result = recallResult && typeof recallResult === 'object'
      ? recallResult
      : emptyResult();

    const node = {
      id: `node_memory_recall_${state.iteration || 0}`,
      type: 'memory_recall',
      goal: 'Look up prior verified evidence for the current claims',
      content: result,
      raw_output: JSON.stringify(result),
      status: 'completed',
      // Confidence reflects how well the memory layer is supporting this
      // run: 0.5 baseline, scaled up by the verified-recall ratio.
      confidence: confidenceFor(result),
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, memoryRecallResult: result },
      node,
      'memoryRecall'
    );
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function emptyResult() {
  return {
    claims_checked: 0,
    previously_seen: 0,
    recalled: 0,
    recalled_verified: 0,
    recall_rate: 0,
    semantic_neighbors_found: 0,
    embedding_provider: null,
    results: [],
  };
}

/**
 * Embed the current claim and ask the ClaimIndex for the top-K neighbors
 * above the model's suggested similarity threshold, excluding the claim's
 * own key (exact-match recall already surfaces that one).
 *
 * Backend-agnostic: whether the index is exact brute-force, JS-LSH, or an
 * SS4 sidecar, the neighbor record shape is identical.
 */
async function findSemanticNeighbors({ claimText, claimKey, claimIndex }) {
  // Embed the current claim. Best-effort: if this fails (very unlikely
  // since the hash fallback is always available), return no neighbors.
  let embedding;
  try {
    embedding = await getEmbedding(claimText);
  } catch {
    return [];
  }
  if (!embedding || !Array.isArray(embedding.vector)) return [];

  return claimIndex.query(embedding.vector, {
    topK: TOP_K_NEIGHBORS,
    threshold: suggestedNeighborThreshold(embedding.model),
    excludeKey: claimKey,
  });
}

/**
 * Read a recalled citation file and extract the source detail + an
 * aggregate verification_confidence for the citable-set builder.
 * Best-effort — returns {} on any failure.
 */
function readCitationDetail(sourceFile) {
  if (!sourceFile) return {};
  try {
    const root = getFactStorePaths().factStoreRoot;
    const abs = path.isAbsolute(sourceFile) ? sourceFile : path.join(root, sourceFile);
    const citation = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const sources = Array.isArray(citation.sources) ? citation.sources : [];
    const confidences = sources
      .map((s) => s?.verification?.confidence)
      .filter((n) => typeof n === 'number');
    const verification_confidence = confidences.length
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2))
      : 0;
    return {
      verification_confidence,
      sources: sources.map((s) => ({
        url: s.url,
        title: s.title || s.extracted_title || null,
        supporting_span: s.supporting_span ?? s.verification?.quoted_excerpt ?? null,
        span_offset: Number.isFinite(s.span_offset) ? s.span_offset : null,
        excerpt: s.excerpt || null,
      })),
    };
  } catch {
    return {};
  }
}

function extractClaimText(c) {
  if (typeof c === 'string') return c.trim();
  return String(c?.claim || c?.claim_text || c?.raw_text || '').trim();
}

function toPlainNumber(n) {
  if (typeof n === 'bigint') return Number(n);
  return typeof n === 'number' ? n : 0;
}

function stringifyTimestamp(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function confidenceFor(result) {
  const checked = result.claims_checked || 0;
  if (checked === 0) return 0.5;
  const verifiedRatio = (result.recalled_verified || 0) / checked;
  return Number((0.5 + 0.5 * verifiedRatio).toFixed(2));
}

module.exports = memoryRecallNode;
