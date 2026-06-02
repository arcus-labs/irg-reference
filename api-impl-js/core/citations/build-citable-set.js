'use strict';

/**
 * Build Citable Set (Citation_Application.md §6 step 1).
 *
 * Assembles the list of claims the drafting model is allowed to cite from:
 *   - `citationVerifyResult` — FRESH verifications (irg-external-facts)
 *   - `memoryRecallResult`   — RECALLED verifications from prior runs (irg-simple)
 *
 * Citability (§5): only verification_level === 'verified' AND verdict is
 * 'supported' or 'refuted'. Provisional / inconclusive / unfetched never
 * become citable.
 *
 * Each entry: { handle:'cit_N', uuid, claim_key, claim_text, verdict,
 * verification_level, verification_confidence, sources, citation_path }.
 * Handles are assigned cit_1..cit_K in assembly order; the durable `uuid`
 * is derived deterministically from claim_key.
 *
 * PURE — no I/O. Inputs must already carry claim_text + sources (the
 * citationVerify / memoryRecall nodes enrich their results accordingly).
 * Dedupes by claim_key (fresh wins over recalled).
 */

const { deriveClaimUuid } = require('./citation-id');

const CITABLE_VERDICTS = new Set(['supported', 'refuted']);

function isCitable(verdict, level) {
  return level === 'verified' && CITABLE_VERDICTS.has(verdict);
}

/**
 * Normalize a source into the Reference.sources[] shape (§4).
 */
function normalizeSource(s) {
  if (!s || typeof s !== 'object') return null;
  const url = typeof s.url === 'string' ? s.url : null;
  if (!url) return null;
  // citationVerify stores the supporting passage on verification.quoted_excerpt;
  // accept an already-mapped supporting_span too.
  const span = s.supporting_span
    ?? s.verification?.quoted_excerpt
    ?? null;
  return {
    url,
    title: s.title || s.extracted_title || null,
    supporting_span: span || null,
    span_offset: Number.isFinite(s.span_offset) ? s.span_offset : null,
    excerpt: s.excerpt || null,
  };
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map(normalizeSource).filter(Boolean);
}

function makeEntry({ claim_key, claim_text, verdict, verification_level, verification_confidence, sources, citation_path }) {
  return {
    uuid: deriveClaimUuid(claim_key),
    claim_key,
    claim_text,
    verdict,
    verification_level,
    verification_confidence: Number.isFinite(verification_confidence) ? verification_confidence : 0,
    sources: normalizeSources(sources),
    ...(citation_path ? { citation_path } : {}),
  };
}

/**
 * @param {Object} [args]
 * @param {Object} [args.citationVerifyResult]  fresh verify summary
 * @param {Object} [args.memoryRecallResult]    recalled summary
 * @returns {Object[]} citable set with cit_N handles
 */
function buildCitableSet({ citationVerifyResult, memoryRecallResult } = {}) {
  const entries = [];
  const seen = new Set(); // dedupe by claim_key

  // --- Fresh verifications (irg-external-facts) ---
  for (const r of citationVerifyResult?.results || []) {
    const verdict = r.verdict;
    const level = r.verification_level
      || (String(r.verification_status || '').startsWith('verified') ? 'verified' : 'provisional');
    if (!isCitable(verdict, level)) continue;
    if (!r.claim_text || seen.has(r.claim_key)) continue;
    seen.add(r.claim_key);
    entries.push(makeEntry({
      claim_key: r.claim_key,
      claim_text: r.claim_text,
      verdict,
      verification_level: level,
      verification_confidence: r.verification_confidence,
      sources: r.sources,
      citation_path: r.citation_path,
    }));
  }

  // --- Recalled verifications (irg-simple) ---
  for (const r of memoryRecallResult?.results || []) {
    const rec = r.recall || {};
    if (!rec.hit || !isCitable(rec.verdict, rec.verification_level)) continue;
    if (!r.claim_text || seen.has(r.claim_key)) continue;
    seen.add(r.claim_key);
    entries.push(makeEntry({
      claim_key: r.claim_key,
      claim_text: r.claim_text,
      verdict: rec.verdict,
      verification_level: rec.verification_level,
      verification_confidence: rec.verification_confidence,
      sources: rec.sources,
      citation_path: rec.citation_path,
    }));
  }

  return entries.map((e, i) => ({ handle: `cit_${i + 1}`, ...e }));
}

module.exports = { buildCitableSet, isCitable, normalizeSources };
