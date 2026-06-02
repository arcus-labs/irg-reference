'use strict';

/**
 * Retrieve the Reg E rules relevant to a consumer's question and shape them as
 * a citable set.
 *
 * Uses the pluggable ClaimIndex (exact / JS-LSH / SS4) to semantically search
 * the seeded CFR corpus, then maps each match back to its full knowledge-pack
 * entry (verdict, section, eCFR URL, rule text) to build a citable claim. The
 * drafting model is given these as verified evidence; citationApply later drops
 * any the model doesn't actually use, so over-retrieving is safe (precision is
 * preserved downstream).
 */

const { createClaimIndex } = require('../../../core/retrieval/claim-index');
const { getEmbedding } = require('../../../core/llm/embeddings');
const { canonicalizeClaim } = require('../../../core/external-fact-check/claim-parser');
const { deriveClaimUuid } = require('../../../core/citations/citation-id');
const { safeParseJson } = require('../../../core/nodes/node-utils');
const { loadPack } = require('./seed-knowledge');

const CITABLE_VERDICTS = new Set(['supported', 'refuted']);

function toCitable(metaList) {
  return metaList
    .filter((m) => m && CITABLE_VERDICTS.has(m.verdict))
    .map((meta, i) => {
      const claim_key = canonicalizeClaim(meta.claim).claim_key;
      return {
        handle: `cit_${i + 1}`,
        uuid: deriveClaimUuid(claim_key),
        claim_key,
        claim_text: meta.claim,
        verdict: meta.verdict,
        verification_level: 'verified',
        verification_confidence: 0.95,
        sources: [
          { url: meta.url, title: meta.section, supporting_span: meta.supporting_span, span_offset: null, excerpt: null },
        ],
        citation_path: null,
      };
    });
}

/**
 * LLM relevance selection over the (small) knowledge pack — the reasoning step
 * picks which rules are directly applicable to the consumer's question. This is
 * the default retrieval path: it reliably bridges consumer language ("am I on
 * the hook") to the legal concept ("liability"), which sparse hash embeddings
 * cannot. With a strong embedding provider (e.g. OpenAI), `retrieveCitable`
 * (semantic, below) is a drop-in alternative.
 *
 * @param {string} query
 * @param {Object} llmClient  has .call(prompt, opts)
 * @param {Object} [opts] { topK=5 }
 */
async function retrieveCitableByLLM(query, llmClient, opts = {}) {
  const topK = opts.topK || 5;
  const pack = loadPack();
  const byId = new Map(pack.claims.map((c) => [c.id, c]));

  const ruleList = pack.claims
    .map((c) => `- ${c.id} — ${c.section}: ${c.claim}`)
    .join('\n');

  const prompt = [
    'You select which Regulation E rules are directly relevant to answering a consumer\'s question.',
    '',
    `Consumer question: "${query}"`,
    '',
    'Available rules (id — section: text):',
    ruleList,
    '',
    'Return ONLY valid JSON, no prose, no code fences:',
    '{ "relevant_ids": ["id", "..."] }',
    'Include only rules that directly help answer THIS question, most relevant first. Omit unrelated rules.',
  ].join('\n');

  let content = '';
  try {
    const resp = await llmClient.call(prompt, { node: 'regERuleSelect' });
    content = typeof resp === 'object' ? resp.content : resp;
  } catch (err) {
    // Fall back to semantic retrieval if the selector call fails.
    return retrieveCitable(query, opts);
  }

  const parsed = safeParseJson(typeof content === 'string' ? content : '') || {};
  const ids = Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids : [];
  const selected = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, topK);

  // Fall back to semantic if the selector returned nothing usable.
  if (selected.length === 0) return retrieveCitable(query, opts);
  return toCitable(selected);
}

/**
 * Build a claim_key -> knowledge-pack-entry map (keys computed the same way the
 * seeder/fact-store canonicalize claim text).
 */
function buildMetaIndex(pack) {
  const map = new Map();
  for (const c of pack.claims) {
    const key = canonicalizeClaim(c.claim).claim_key;
    map.set(key, c);
  }
  return map;
}

/**
 * @param {string} query
 * @param {Object} [opts] { topK=5 }
 * @returns {Promise<Object[]>} citable set: [{ handle, uuid, claim_key, claim_text,
 *   verdict, verification_level, verification_confidence, sources, citation_path }]
 */
async function retrieveCitable(query, opts = {}) {
  const topK = opts.topK || 5;
  const pack = loadPack();
  const metaByKey = buildMetaIndex(pack);

  const index = await createClaimIndex();
  if (!index || index.size() === 0) return [];

  const emb = await getEmbedding(query);
  if (!emb || !Array.isArray(emb.vector)) return [];

  // Over-retrieve by raw similarity (threshold 0): the most relevant rules
  // surface; the model cites only the applicable ones; citationApply prunes
  // the rest. Robust for the demo regardless of embedding sparsity.
  const neighbors = index.query(emb.vector, { topK, threshold: 0 });

  const entries = [];
  const seen = new Set();
  for (const n of neighbors) {
    const meta = metaByKey.get(n.claim_key);
    if (!meta || !CITABLE_VERDICTS.has(meta.verdict)) continue;
    if (seen.has(n.claim_key)) continue;
    seen.add(n.claim_key);
    entries.push({
      claim_key: n.claim_key,
      claim_text: meta.claim,
      verdict: meta.verdict,
      verification_level: 'verified',
      verification_confidence: 0.95,
      sources: [
        {
          url: meta.url,
          title: meta.section,
          supporting_span: meta.supporting_span,
          span_offset: null,
          excerpt: null,
        },
      ],
      citation_path: null,
      similarity: n.similarity,
    });
  }

  return entries.map((e, i) => ({
    handle: `cit_${i + 1}`,
    uuid: deriveClaimUuid(e.claim_key),
    ...e,
  }));
}

module.exports = { retrieveCitable, retrieveCitableByLLM, buildMetaIndex };
