'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getFactStorePaths } = require('./config');

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function listJsonFiles(rootDir) {
  if (!(await exists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  }));

  return files.flat();
}

function isCitationExpired(citation, now = Date.now()) {
  const expiresAt = Date.parse(citation?.expires_at || '');
  return Number.isFinite(expiresAt) ? expiresAt < now : false;
}

function parseCitationFile(filePath, raw) {
  try {
    const citation = JSON.parse(raw);
    return citation && typeof citation === 'object' ? { citation, filePath } : null;
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
  const paths = getFactStorePaths();
  const files = await listJsonFiles(paths.citationDir);
  if (!files.length) return null;

  const parsedEntries = (await Promise.all(files.map(async (filePath) => {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseCitationFile(filePath, raw);
  }))).filter(Boolean);

  const exactMatches = parsedEntries
    .filter(({ citation }) => citation.claim_key === structuredClaim.claim_key)
    .sort((a, b) => String(b.citation.created_at || '').localeCompare(String(a.citation.created_at || '')));

  const exact = exactMatches[0];
  if (exact) {
    return {
      match_type: 'exact',
      expired: isCitationExpired(exact.citation),
      citation: exact.citation,
      file_path: exact.filePath,
    };
  }

  const partial = parsedEntries
    .map(({ citation, filePath }) => ({
      match_type: 'partial',
      score: computePartialScore(structuredClaim, citation.claim),
      expired: isCitationExpired(citation),
      citation,
      file_path: filePath,
    }))
    .filter((entry) => entry.score >= 0.8)
    .sort((a, b) => b.score - a.score || String(b.citation.created_at || '').localeCompare(String(a.citation.created_at || '')));

  if (partial.length) {
    return partial[0];
  }

  const fuzzy = parsedEntries
    .map(({ citation, filePath }) => ({
      match_type: 'fuzzy',
      score: computeFuzzyScore(structuredClaim, citation.claim),
      expired: isCitationExpired(citation),
      citation,
      file_path: filePath,
    }))
    .filter((entry) => entry.score >= 0.6)
    .sort((a, b) => b.score - a.score || String(b.citation.created_at || '').localeCompare(String(a.citation.created_at || '')));

  return fuzzy[0] || null;
}

module.exports = {
  isCitationExpired,
  listJsonFiles,
  lookupCachedCitation,
};