'use strict';

/**
 * Cache Lookup
 *
 * Finds matching citations for a structured claim. Backed by DuckDB
 * (see `./db.js`) for fast exact lookups and indexed narrowing of
 * candidates for partial/fuzzy scoring.
 *
 * Returns `null` if no match is found. Returns a result object with
 * `{ match_type, citation, file_path, expired, score? }` otherwise.
 *
 * Behavior is identical to the previous filesystem-scan implementation,
 * just much faster on large stores.
 */

const fs = require('fs');
const path = require('path');
const { getFactStorePaths } = require('./config');
const db = require('./db');

function isCitationExpired(citation, now = Date.now()) {
  const expiresAt = Date.parse(citation?.expires_at || '');
  return Number.isFinite(expiresAt) ? expiresAt < now : false;
}

/**
 * Hydrate the full citation JSON from disk given the source_file path
 * returned by DuckDB. The view only carries the flattened columns we
 * indexed; for the legacy return shape we still want the full record.
 */
function readCitationFile(filePath) {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(getFactStorePaths().factStoreRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (_) {
    return null;
  }
}

function computePartialScore(structuredClaim, citationClaim) {
  if (!citationClaim || typeof citationClaim !== 'object') return 0;
  if (citationClaim.domain !== structuredClaim.domain) return 0;
  if (citationClaim.subject !== structuredClaim.subject) return 0;
  if (citationClaim.predicate !== structuredClaim.predicate) return 0;

  let score = 0.8;
  if ((citationClaim.object || '') === structuredClaim.object) score += 0.15;
  if (JSON.stringify(citationClaim.qualifiers || {}) === JSON.stringify(structuredClaim.qualifiers || {})) score += 0.05;
  return Math.min(score, 1);
}

function computeFuzzyScore(structuredClaim, citationClaim) {
  const rawText = String(citationClaim?.raw_text || '').toLowerCase();
  if (!rawText) return 0;
  const tokens = structuredClaim.raw_text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => rawText.includes(token)).length;
  return hits / tokens.length;
}

async function lookupCachedCitation(structuredClaim) {
  if (!db.isAvailable()) return null;

  // 1. Exact match by claim_key — O(1) via DuckDB.
  const exactRow = await db.lookupCitationByClaimKey(structuredClaim.claim_key);
  if (exactRow) {
    const citation = readCitationFile(exactRow.source_file);
    if (citation) {
      return {
        match_type: 'exact',
        expired: isCitationExpired(citation),
        citation,
        file_path: exactRow.source_file,
      };
    }
  }

  // 2. Narrow candidates to the same domain for partial/fuzzy scoring.
  //    DuckDB filters; JS scores.
  const candidates = await db.listCitationCandidatesByDomain(structuredClaim.domain);
  if (!candidates.length) return null;

  const partialMatches = [];
  const fuzzyMatches = [];

  for (const row of candidates) {
    const citation = readCitationFile(row.source_file);
    if (!citation) continue;

    const partialScore = computePartialScore(structuredClaim, citation.claim);
    if (partialScore >= 0.8) {
      partialMatches.push({
        match_type: 'partial',
        score: partialScore,
        expired: isCitationExpired(citation),
        citation,
        file_path: row.source_file,
      });
      continue;
    }

    const fuzzyScore = computeFuzzyScore(structuredClaim, citation.claim);
    if (fuzzyScore >= 0.6) {
      fuzzyMatches.push({
        match_type: 'fuzzy',
        score: fuzzyScore,
        expired: isCitationExpired(citation),
        citation,
        file_path: row.source_file,
      });
    }
  }

  if (partialMatches.length) {
    partialMatches.sort((a, b) =>
      b.score - a.score
      || String(b.citation.created_at || '').localeCompare(String(a.citation.created_at || '')));
    return partialMatches[0];
  }

  if (fuzzyMatches.length) {
    fuzzyMatches.sort((a, b) =>
      b.score - a.score
      || String(b.citation.created_at || '').localeCompare(String(a.citation.created_at || '')));
    return fuzzyMatches[0];
  }

  return null;
}

module.exports = {
  isCitationExpired,
  lookupCachedCitation,
};