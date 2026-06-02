/**
 * End-to-end citation pipeline integration test.
 *
 * Chains the REAL nodes that make up the citation feature, in order, against
 * a temp fact-store seeded with a verified citation:
 *
 *   memoryRecall → draft → citationApply → citationQuality
 *
 * The LLM is mocked ONLY for the two generative steps (draft emits citation
 * tags; citationQuality judges sentences). Everything else is the production
 * code path: DuckDB recall, build-citable-set, the deterministic apply pass,
 * and the pure quality math. This proves the wiring works together — not just
 * each unit in isolation — without depending on live web fetches or a live LLM.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-e2e-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const memoryRecallNode = require('../core/nodes/memory-recall-node');
const draftNode = require('../core/nodes/draft-node');
const citationApplyNode = require('../core/nodes/citation-apply-node');
const citationQualityNode = require('../core/nodes/citation-quality-node');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');
const { deriveClaimUuid } = require('../core/citations/citation-id');

const prompts = yaml.load(fs.readFileSync(path.join(__dirname, '../core/prompts/irg-prompts.yaml'), 'utf8'));

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

const CLAIM = 'Antibiotics do not treat viral infections.';

function seedVerifiedCitation() {
  const structured = canonicalizeClaim(CLAIM);
  const dir = path.join(tmpRoot, 'citations', '2026-05');
  fs.mkdirSync(dir, { recursive: true });
  const citation = {
    claim_key: structured.claim_key,
    created_at: '2026-05-01T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    verified_at: '2026-05-01T00:00:00.000Z',
    claim: structured,
    verdict: 'supported',
    verification_level: 'verified',
    verification_status: 'verified_supported',
    confidence: 0.9,
    sources: [
      {
        url: 'https://www.who.int/antibiotics',
        title: 'WHO — Antibiotic resistance',
        verification: {
          verdict: 'supported',
          confidence: 0.93,
          quoted_excerpt: 'Antibiotics are used to prevent and treat bacterial infections; they do not work against viral infections such as colds and flu.',
          llm_used: true,
        },
      },
    ],
    retrieval_mode: 'fetched_unverified',
    retrieval_deferred: false,
  };
  fs.writeFileSync(path.join(dir, `${structured.claim_key.slice(0, 12)}.json`), JSON.stringify(citation, null, 2));
  return structured.claim_key;
}

// Mock LLM: only `draft` and `citationQuality` nodes call it in this chain.
function makeLlm(draftResponse, qualityJudgments) {
  let calls = { draft: 0, citationQuality: 0 };
  return {
    calls,
    async call(_prompt, opts) {
      const node = opts?.node;
      const usage = { input_tokens: 100, output_tokens: 60, total_tokens: 160 };
      if (node === 'draft') {
        calls.draft++;
        return { content: JSON.stringify({ response: draftResponse, confidence: 0.9 }), usage };
      }
      if (node === 'citationQuality') {
        calls.citationQuality++;
        return { content: JSON.stringify({ sentences: qualityJudgments }), usage };
      }
      throw new Error(`unexpected LLM call for node "${node}"`);
    },
  };
}

async function main() {
  console.log('========================================');
  console.log('citation pipeline e2e integration test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);

  const claimKey = seedVerifiedCitation();
  const expectedUuid = deriveClaimUuid(claimKey);

  // The draft model "writes" an answer that cites the recalled claim.
  const draftResponse =
    '## Answer\n\nNo. <citation ref="cit_1">Antibiotics do not treat viral infections</citation>, '
    + 'so they will not help a viral cold.';

  const qualityJudgments = [
    { text: 'No.', claim_bearing: false, has_citation: false, citation_supports: false, cited_seqs: [] },
    { text: 'Antibiotics do not treat viral infections, so they will not help a viral cold.',
      claim_bearing: true, has_citation: true, citation_supports: true, cited_seqs: [1] },
  ];

  const llm = makeLlm(draftResponse, qualityJudgments);

  let state = {
    originalQuery: 'Do antibiotics work on viruses?',
    context: {},
    iteration: 0,
    nodes: [],
    history: [],
    factCheckResult: {
      critical_claims: [{ claim: CLAIM, importance: 'health', assessment: 'true' }],
      generated_at: new Date().toISOString(),
    },
  };

  // ---- 1. memoryRecall: surface the verified citation ----
  console.log('\n1. memoryRecall recalls the seeded verified citation');
  {
    const prepared = memoryRecallNode.prepare(state, prompts);
    const result = await memoryRecallNode.llmCall(prepared);
    state = await memoryRecallNode.process(prepared, result);
  }
  const recall = state.memoryRecallResult;
  ok('recalled = 1', recall.recalled === 1);
  ok('recalled_verified = 1', recall.recalled_verified === 1);
  ok('recall hit verdict supported', recall.results[0].recall.verdict === 'supported');
  ok('recall carries sources from disk', Array.isArray(recall.results[0].recall.sources) && recall.results[0].recall.sources.length === 1, recall.results[0].recall);
  ok('recall source has supporting_span', !!recall.results[0].recall.sources[0].supporting_span);

  // ---- 2. draft.prepare builds the citable set + threads it into the prompt ----
  console.log('\n2. draft builds citable set + emits citation tags');
  const draftPrepared = draftNode.prepare(state, prompts);
  ok('citable set has 1 entry', draftPrepared.citableSet.length === 1, draftPrepared.citableSet);
  ok('handle is cit_1', draftPrepared.citableSet[0].handle === 'cit_1');
  ok('citable uuid derived from claim_key', draftPrepared.citableSet[0].uuid === expectedUuid);
  ok('draft prompt advertises the citable claim', draftPrepared.draftPrompt.includes('cit_1') && draftPrepared.draftPrompt.includes('Antibiotics do not treat'));
  {
    const llmResult = await draftNode.llmCall(draftPrepared, llm);
    state = draftNode.process(draftPrepared, llmResult);
  }
  ok('draft llm called once', llm.calls.draft === 1);
  ok('raw draft contains provisional cit_1 tag', state.draftResult.response.includes('ref="cit_1"'), state.draftResult.response);

  // ---- 3. citationApply: validate → resolve → renumber → references ----
  console.log('\n3. citationApply resolves tags + builds references');
  {
    const prepared = citationApplyNode.prepare(state, prompts);
    state = citationApplyNode.process(prepared);
  }
  const applied = state.draftResult.response;
  ok('cit_1 resolved to durable uuid', applied.includes(`ref="${expectedUuid}"`), applied);
  ok('display seq assigned', applied.includes('seq="1"'));
  ok('no provisional handle left', !applied.includes('cit_1'));
  ok('references built (1)', state.references.length === 1);
  ok('reference verdict supported', state.references[0].verdict === 'supported');
  ok('reference verification_level verified', state.references[0].verification_level === 'verified');
  ok('reference carries supporting_span', !!state.references[0].sources[0].supporting_span);
  ok('citationApply summary present', state.citationApplyResult.tags_validated === 1 && state.citationApplyResult.refs_dropped === 0);

  // ---- 4. citationQuality: ALCE recall + precision over the cited answer ----
  console.log('\n4. citationQuality scores the cited answer');
  {
    const prepared = citationQualityNode.prepare(state, prompts);
    ok('quality node sees citations', prepared.citationQualityInput.hasCitations === true);
    const llmResult = await citationQualityNode.llmCall(prepared, llm);
    state = citationQualityNode.process(prepared, llmResult);
  }
  const q = state.citationQualityResult;
  ok('citationQuality evaluated', q.evaluated === true);
  ok('recall = 1', q.citation_recall === 1, q);
  ok('precision = 1', q.citation_precision === 1, q);
  ok('f1 = 1', q.citation_f1 === 1);
  ok('counted 1 claim-bearing sentence', q.counts.claim_bearing === 1);

  // ---- 5. trace integrity: each node recorded one card ----
  console.log('\n5. trace records all four node cards in order');
  const types = state.nodes.map((n) => n.type);
  ok('memory_recall recorded', types.includes('memory_recall'));
  ok('draft recorded', types.includes('draft'));
  ok('citation_apply recorded', types.includes('citation_apply'));
  ok('citation_quality recorded', types.includes('citation_quality'));
  ok('order: recall < draft < apply < quality',
     types.indexOf('memory_recall') < types.indexOf('draft')
     && types.indexOf('draft') < types.indexOf('citation_apply')
     && types.indexOf('citation_apply') < types.indexOf('citation_quality'), types);

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
