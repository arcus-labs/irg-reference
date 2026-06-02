'use strict';

/**
 * Citation Verifier
 *
 * Reads citation artifacts that have already been fetched (see
 * `fetcher.js`) and, for each source whose content was extracted to
 * markdown, asks the LLM whether the source supports, refutes, or is
 * inconclusive on the claim.
 *
 * Inputs:
 *   - Citation JSON files under _fact-store/citations/YYYY-MM/*.json
 *     that have at least one source with `markdown_file` populated.
 *
 * Outputs (filesystem side-effects):
 *   - Citation JSON updated in place:
 *       - verification_level  : 'verified' (once at least one source got an LLM verdict)
 *       - verification_status : derived from the aggregated verdict
 *       - verdict             : aggregated verdict over sources
 *       - verified_at         : ISO timestamp
 *       - sources[i].verification = {
 *           verdict, confidence, reasoning, quoted_excerpt, llm_used, verified_at
 *         }
 *
 * Cost controls:
 *   - Sources without `markdown_file` (extraction failed) get verdict
 *     'unreachable' with no LLM call.
 *   - Sources already verified in a prior run are skipped (idempotent).
 *   - Markdown is truncated to MAX_SOURCE_CHARS before being sent.
 *   - Concurrent verification within a citation; citations themselves
 *     run sequentially to keep per-file writes consistent.
 */

const fs = require('fs');
const path = require('path');
const { getFactStorePaths } = require('./config');
const { buildPrompt, safeParseJson, extractTokens } = require('../nodes/node-utils');

const MAX_SOURCE_CHARS = 6000;
const DEFAULT_CONCURRENCY = 4;
const VALID_VERDICTS = new Set(['supported', 'refuted', 'inconclusive', 'off_topic']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFactPath(rel) {
  if (!rel) return null;
  if (path.isAbsolute(rel)) return rel;
  return path.join(getFactStorePaths().factStoreRoot, rel);
}

function loadMarkdown(source) {
  const target = resolveFactPath(source?.markdown_file);
  if (!target) return null;
  try {
    return fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Verify one source against one claim by calling the LLM with the
 * configured `citationVerify` prompt. Returns the verification object
 * to attach to the source.
 *
 * Defensive about the LLM's output: if the verdict isn't one of the
 * known values, falls back to 'inconclusive' and notes the issue in
 * `reasoning`.
 */
async function verifySource({ claim, source, llmClient, promptTemplate }) {
  const verifiedAt = new Date().toISOString();

  // If the fetch failed, no content to verify.
  if (source?.error) {
    return {
      verdict: 'unreachable',
      confidence: 0,
      reasoning: `Fetch failed: ${source.error}`,
      quoted_excerpt: null,
      llm_used: false,
      verified_at: verifiedAt,
    };
  }

  const markdown = loadMarkdown(source);
  if (!markdown || !markdown.trim()) {
    return {
      verdict: 'unreachable',
      confidence: 0,
      reasoning: 'No extracted markdown available for this source.',
      quoted_excerpt: null,
      llm_used: false,
      verified_at: verifiedAt,
    };
  }

  const truncated = markdown.length > MAX_SOURCE_CHARS
    ? markdown.slice(0, MAX_SOURCE_CHARS) + '\n[... truncated]'
    : markdown;

  const prompt = buildPrompt(promptTemplate, {
    claim,
    source_content: truncated,
  });

  let response;
  try {
    response = await llmClient.call(prompt, { node: 'citationVerify' });
  } catch (err) {
    return {
      verdict: 'inconclusive',
      confidence: 0,
      reasoning: `LLM call failed: ${err.message}`,
      quoted_excerpt: null,
      llm_used: false,
      verified_at: verifiedAt,
    };
  }

  const content = typeof response === 'object' ? response.content : response;
  const tokens = extractTokens(response);

  // Strip code fences if model added them.
  let cleaned = String(content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = safeParseJson(cleaned) || {};

  let verdict = String(parsed.verdict || '').trim().toLowerCase();
  if (!VALID_VERDICTS.has(verdict)) {
    return {
      verdict: 'inconclusive',
      confidence: 0.3,
      reasoning: `LLM returned unrecognized verdict "${parsed.verdict}". Treating as inconclusive.`,
      quoted_excerpt: parsed.quoted_excerpt ?? null,
      llm_used: true,
      tokens,
      verified_at: verifiedAt,
    };
  }

  return {
    verdict,
    confidence: Number(parsed.confidence ?? 0.5),
    reasoning: String(parsed.reasoning || '').trim(),
    quoted_excerpt: parsed.quoted_excerpt ?? null,
    llm_used: true,
    tokens,
    verified_at: verifiedAt,
  };
}

/**
 * Aggregate per-source verdicts into a citation-level verdict and
 * verification_status string.
 *
 * Returns: { verdict, verification_status, verified_count }
 */
function aggregateVerdicts(sources) {
  let supported = 0;
  let refuted = 0;
  let inconclusive = 0;
  let offTopic = 0;
  let unreachable = 0;
  let llmVerified = 0;

  for (const s of sources) {
    const v = s?.verification?.verdict;
    if (s?.verification?.llm_used) llmVerified++;
    switch (v) {
      case 'supported':    supported++;   break;
      case 'refuted':      refuted++;     break;
      case 'inconclusive': inconclusive++; break;
      case 'off_topic':    offTopic++;    break;
      case 'unreachable':  unreachable++; break;
      default: /* skip */
    }
  }

  let verdict, verification_status;
  if (supported > 0 && refuted > 0) {
    verdict = 'contested';
    verification_status = 'verified_contested';
  } else if (supported > 0) {
    verdict = 'supported';
    verification_status = 'verified_supported';
  } else if (refuted > 0) {
    verdict = 'refuted';
    verification_status = 'verified_refuted';
  } else if (inconclusive > 0 || offTopic > 0) {
    verdict = 'inconclusive';
    verification_status = 'verified_inconclusive';
  } else {
    // All unreachable
    verdict = 'unverified';
    verification_status = 'verification_unreachable';
  }

  return { verdict, verification_status, verified_count: llmVerified, supported, refuted, inconclusive, off_topic: offTopic, unreachable };
}

/**
 * Verify all sources for one citation, update the citation in place,
 * return a summary for the trace.
 */
async function verifyCitation({ citationPath, llmClient, promptTemplate, concurrency = DEFAULT_CONCURRENCY }) {
  const absolutePath = resolveFactPath(citationPath);
  let citation;
  try {
    citation = readJson(absolutePath);
  } catch (err) {
    return {
      citation_path: citationPath,
      verified: 0, skipped: 0, errors: 1,
      error: `Failed to read citation: ${err.message}`,
      sources: [],
    };
  }

  const sources = Array.isArray(citation.sources) ? citation.sources : [];
  if (sources.length === 0) {
    return { citation_path: citationPath, claim_key: citation.claim_key, verified: 0, skipped: 1, errors: 0, sources: [] };
  }

  const claimText = citation?.claim?.raw_text || citation?.claim?.canonical_claim || '';
  if (!claimText) {
    return {
      citation_path: citationPath,
      claim_key: citation.claim_key,
      verified: 0, skipped: 1, errors: 1,
      error: 'Citation has no claim text to verify against.',
      sources: [],
    };
  }

  const updated = new Array(sources.length);
  let cursor = 0;
  let llmCalls = 0;
  let skipped = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= sources.length) return;
      const source = sources[i];

      // Idempotency: skip already-verified sources unless the prior
      // verification was 'unreachable' (which we'll keep trying).
      if (source?.verification && source.verification.verdict !== 'unreachable') {
        updated[i] = source;
        skipped++;
        continue;
      }

      const verification = await verifySource({
        claim: claimText, source, llmClient, promptTemplate,
      });
      if (verification.llm_used) llmCalls++;
      updated[i] = { ...source, verification };
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const agg = aggregateVerdicts(updated);

  citation.sources = updated;
  if (agg.verified_count > 0) {
    citation.verification_level = 'verified';
    citation.verified_at = new Date().toISOString();
  }
  citation.verification_status = agg.verification_status;
  citation.verdict = agg.verdict;

  try {
    fs.writeFileSync(absolutePath, JSON.stringify(citation, null, 2), 'utf8');
  } catch (err) {
    return {
      citation_path: citationPath,
      claim_key: citation.claim_key,
      verified: 0, skipped: skipped, errors: 1,
      error: `Failed to write updated citation: ${err.message}`,
      sources: updated,
    };
  }

  return {
    citation_path: citationPath,
    claim_key: citation.claim_key,
    claim_text: claimText,
    verification_level: citation.verification_level || null,
    verdict: agg.verdict,
    verification_status: agg.verification_status,
    // `verified` = sources verified IN THIS RUN (newly added LLM judgments).
    // `breakdown` reflects the citation's current state across all sources,
    // including verifications from prior runs.
    verified: llmCalls,
    skipped,
    llm_calls: llmCalls,
    total_verified: agg.verified_count,
    breakdown: {
      supported: agg.supported,
      refuted: agg.refuted,
      inconclusive: agg.inconclusive,
      off_topic: agg.off_topic,
      unreachable: agg.unreachable,
    },
    sources: updated,
  };
}

async function verifyManyCitations({ citationPaths, llmClient, promptTemplate, concurrency }) {
  const startMs = Date.now();
  const results = [];
  for (const p of citationPaths) {
    results.push(await verifyCitation({ citationPath: p, llmClient, promptTemplate, concurrency }));
  }
  const totals = results.reduce(
    (acc, r) => ({
      verified: acc.verified + (r.verified || 0),
      skipped: acc.skipped + (r.skipped || 0),
      llm_calls: acc.llm_calls + (r.llm_calls || 0),
      errors: acc.errors + (r.error ? 1 : 0),
      supported: acc.supported + (r.breakdown?.supported || 0),
      refuted: acc.refuted + (r.breakdown?.refuted || 0),
      inconclusive: acc.inconclusive + (r.breakdown?.inconclusive || 0),
      off_topic: acc.off_topic + (r.breakdown?.off_topic || 0),
      unreachable: acc.unreachable + (r.breakdown?.unreachable || 0),
    }),
    { verified: 0, skipped: 0, llm_calls: 0, errors: 0, supported: 0, refuted: 0, inconclusive: 0, off_topic: 0, unreachable: 0 }
  );
  return {
    citations_processed: results.length,
    ...totals,
    duration_ms: Date.now() - startMs,
    results,
  };
}

module.exports = {
  verifySource,
  verifyCitation,
  verifyManyCitations,
  aggregateVerdicts,
  MAX_SOURCE_CHARS,
};
