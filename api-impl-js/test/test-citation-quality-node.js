/**
 * Node-level tests for the citationQuality node.
 *
 * Drives prepare → llmCall → process directly with a mock LLM. Covers:
 *   - inert when no citations (no LLM call, null scores)
 *   - scores computed from the LLM's per-sentence judgments
 *   - trace node shape
 */

'use strict';

const citationQualityNode = require('../core/nodes/citation-quality-node');

const prompts = {
  citationQuality: {
    system: 'SYS',
    user: 'ANSWER:\n{{response}}\nREFERENCES:\n{{references}}',
  },
};

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

function makeLlm(judgments) {
  let calls = 0;
  return {
    callCount: () => calls,
    call: async () => {
      calls++;
      return { content: JSON.stringify({ sentences: judgments }), usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
  };
}

async function runNode(state, llm) {
  const prepared = citationQualityNode.prepare(state, prompts);
  const llmResult = await citationQualityNode.llmCall(prepared, llm);
  return citationQualityNode.process(prepared, llmResult);
}

async function main() {
  console.log('========================================');
  console.log('citationQuality node test');
  console.log('========================================');

  const refs = [
    { uuid: 'u1', seq: 1, claim_text: 'Antibiotics do not treat viruses.', verdict: 'supported',
      sources: [{ url: 'https://who.int', title: 'WHO', supporting_span: 'no effect on viruses' }] },
  ];

  // 1. Inert: references exist but the prose has no <citation> markers
  console.log('\n1. inert when prose has no citation markers');
  const inertLlm = makeLlm([]);
  const inert = await runNode({
    iteration: 0, nodes: [], history: [],
    citationApplyResult: { references: refs, response: 'Plain answer with no markers.' },
  }, inertLlm);
  ok('no LLM call made', inertLlm.callCount() === 0);
  ok('recall null', inert.citationQualityResult.citation_recall === null);
  ok('precision null', inert.citationQualityResult.citation_precision === null);
  ok('evaluated false', inert.citationQualityResult.evaluated === false);

  // 2. Inert: no references at all
  console.log('\n2. inert when no references');
  const inert2Llm = makeLlm([]);
  const inert2 = await runNode({
    iteration: 0, nodes: [], history: [],
    citationApplyResult: { references: [], response: 'Anything.' },
  }, inert2Llm);
  ok('no LLM call', inert2Llm.callCount() === 0);
  ok('reason mentions no verified citations', /no verified citations/.test(inert2.citationQualityResult.reason || ''));

  // 3. Scored: prose has a marker, LLM returns judgments
  console.log('\n3. scores computed from LLM judgments');
  const response = 'Intro sentence. <citation ref="u1" seq="1">Antibiotics will not help a viral cold</citation>.';
  const llm = makeLlm([
    { text: 'Intro sentence.', claim_bearing: false, has_citation: false, citation_supports: false, cited_seqs: [] },
    { text: 'Antibiotics will not help a viral cold', claim_bearing: true, has_citation: true, citation_supports: true, cited_seqs: [1] },
  ]);
  const scored = await runNode({
    iteration: 0, nodes: [], history: [],
    citationApplyResult: { references: refs, response },
  }, llm);
  ok('LLM called once', llm.callCount() === 1);
  ok('evaluated true', scored.citationQualityResult.evaluated === true);
  ok('recall = 1', scored.citationQualityResult.citation_recall === 1);
  ok('precision = 1', scored.citationQualityResult.citation_precision === 1);
  ok('f1 = 1', scored.citationQualityResult.citation_f1 === 1);
  ok('claim_bearing count = 1', scored.citationQualityResult.counts.claim_bearing === 1);
  ok('tokens accumulated', scored.total_tokens_used.total_tokens === 15);

  // 4. Trace node shape
  console.log('\n4. trace node shape');
  const node = scored.nodes[scored.nodes.length - 1];
  ok('type = citation_quality', node.type === 'citation_quality');
  ok('id prefix', String(node.id).startsWith('node_citation_quality'));
  ok('confidence reflects f1', node.confidence === 1);
  ok('content has counts', !!node.content.counts);

  // 5. Reads from draftResult.response when citationApplyResult absent
  console.log('\n5. falls back to draftResult.response');
  const llm5 = makeLlm([{ text: 'X', claim_bearing: true, has_citation: true, citation_supports: false, cited_seqs: [1] }]);
  const s5 = await runNode({
    iteration: 0, nodes: [], history: [],
    references: refs,
    draftResult: { response: '<citation ref="u1" seq="1">X</citation>' },
  }, llm5);
  ok('precision = 0 (misattached)', s5.citationQualityResult.citation_precision === 0);
  ok('misattributed counted', s5.citationQualityResult.counts.misattributed_citations === 1);

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
