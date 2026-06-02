/**
 * Node-level tests for citationApply wiring.
 *
 * Drives draftNode.prepare (which builds the citable set from
 * citationVerifyResult / memoryRecallResult and threads it into the prompt)
 * and citationApplyNode.process (which validates the draft's tags and builds
 * references[]). No graph executor, no LLM — we feed a synthetic draft.
 */

'use strict';

const draftNode = require('../core/nodes/draft-node');
const citationApplyNode = require('../core/nodes/citation-apply-node');
const { deriveClaimUuid } = require('../core/citations/citation-id');

const prompts = {
  draft: {
    system: 'SYS',
    user: 'Citable Claims: {{citableClaims}}',
  },
};

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

function baseState(over = {}) {
  return {
    originalQuery: 'q',
    context: {},
    iteration: 0,
    arbiterResult: {},
    clarifyResult: {},
    nodes: [],
    history: [],
    ...over,
  };
}

function main() {
  console.log('========================================');
  console.log('citationApply node wiring test');
  console.log('========================================');

  // --- draft builds citable set from fresh verify result ---
  console.log('\n1. draft.prepare builds citable set + threads into prompt');
  const verifyResult = {
    results: [
      { claim_key: 'k1', claim_text: 'Antibiotics do not treat viruses.', verdict: 'supported',
        verification_status: 'verified_supported',
        sources: [{ url: 'https://who.int', extracted_title: 'WHO', verification: { quoted_excerpt: 'no effect on viruses' } }] },
      { claim_key: 'k2', claim_text: 'Maybe true.', verdict: 'inconclusive', verification_status: 'verified_inconclusive', sources: [] },
    ],
  };
  const prepared = draftNode.prepare(baseState({ citationVerifyResult: verifyResult }), prompts);
  ok('citableSet has one entry (supported only)', prepared.citableSet.length === 1);
  ok('handle is cit_1', prepared.citableSet[0].handle === 'cit_1');
  ok('prompt includes the citable claim text', prepared.draftPrompt.includes('Antibiotics do not treat viruses.'));
  ok('prompt does NOT include inconclusive claim', !prepared.draftPrompt.includes('Maybe true.'));

  // --- citationApply validates a synthetic draft ---
  console.log('\n2. citationApply.process resolves tags + builds references');
  const draftState = {
    ...prepared,
    draftResult: {
      response: 'You should know that <citation ref="cit_1">antibiotics will not help a viral cold</citation>.',
      confidence: 0.8,
    },
  };
  const out = citationApplyNode.process(citationApplyNode.prepare(draftState));
  ok('references built', out.references.length === 1);
  ok('reference uuid derived from claim_key', out.references[0].uuid === deriveClaimUuid('k1'));
  ok('reference seq = 1', out.references[0].seq === 1);
  ok('verdict carried', out.references[0].verdict === 'supported');
  ok('source supporting_span mapped', out.references[0].sources[0].supporting_span === 'no effect on viruses');
  ok('response rewritten with uuid ref', out.draftResult.response.includes(`ref="${deriveClaimUuid('k1')}"`));
  ok('response carries seq', out.draftResult.response.includes('seq="1"'));
  ok('currentDraft updated', out.currentDraft === out.draftResult.response);
  ok('citationApplyResult attached', out.citationApplyResult.references_built === 1);

  const node = out.nodes[out.nodes.length - 1];
  ok('trace node type = citation_apply', node.type === 'citation_apply');
  ok('trace node id prefix', String(node.id).startsWith('node_citation_apply'));
  ok('trace node carries references', Array.isArray(node.content.references));

  // --- inert when no citable set: stray tags stripped ---
  console.log('\n3. inert when no citable set');
  const noSet = citationApplyNode.process(citationApplyNode.prepare({
    ...baseState(),
    citableSet: [],
    draftResult: { response: 'Stray <citation ref="cit_1">tag</citation> here.' },
  }));
  ok('no references', noSet.references.length === 0);
  ok('markup stripped, text kept', noSet.draftResult.response === 'Stray tag here.', noSet.draftResult.response);

  // --- hallucinated handle dropped at node level ---
  console.log('\n4. hallucinated handle dropped');
  const hall = citationApplyNode.process(citationApplyNode.prepare({
    ...prepared,
    draftResult: { response: 'Bogus <citation ref="cit_99">claim</citation>.' },
  }));
  ok('no references for bogus handle', hall.references.length === 0);
  ok('inner text retained', hall.draftResult.response === 'Bogus claim.', hall.draftResult.response);
  ok('refs_dropped recorded', hall.citationApplyResult.refs_dropped === 1);

  // --- idempotency: re-running on already-resolved prose preserves references ---
  console.log('\n5. idempotent on already-resolved prose (convergence re-run)');
  const uuid = deriveClaimUuid('k1');
  const resolvedProse = `Foo <citation ref="${uuid}" seq="1">antibiotics do not treat viruses</citation> bar.`;
  const priorRefs = [{ uuid, seq: 1, claim_key: 'k1', claim_text: 'Antibiotics do not treat viruses.', verdict: 'supported', verification_level: 'verified', verification_confidence: 0.9, sources: [] }];

  // Case A: fresh draft already carries resolved tags (no cit_ handles).
  const reA = citationApplyNode.process(citationApplyNode.prepare(baseState({
    citableSet: prepared.citableSet,
    references: priorRefs,
    draftResult: { response: resolvedProse },
    currentDraft: resolvedProse,
  })));
  ok('references preserved (not emptied)', reA.references.length === 1, reA.references);
  ok('resolved tag NOT stripped', reA.draftResult.response.includes(`ref="${uuid}"`), reA.draftResult.response);
  ok('flagged already_resolved', reA.citationApplyResult.already_resolved === true);

  // Case B: new draft empty → falls back to preserved resolved currentDraft.
  const reB = citationApplyNode.process(citationApplyNode.prepare(baseState({
    citableSet: prepared.citableSet,
    references: priorRefs,
    draftResult: { response: '' },
    currentDraft: resolvedProse,
  })));
  ok('empty new draft still preserves references', reB.references.length === 1);
  ok('empty new draft keeps resolved prose', reB.draftResult.response.includes('seq="1"'));

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
