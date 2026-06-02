/**
 * Tests for draft-node response recovery.
 *
 * The draft prompt asks for JSON {response, confidence}, but real models
 * sometimes emit raw markdown (sometimes inside a code fence) instead. The
 * node must recover the answer in those cases — otherwise a non-compliant
 * model silently drops the entire response, taking any <citation> tags with
 * it. Discovered via a live Groq run.
 */

'use strict';

const draftNode = require('../core/nodes/draft-node');

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', JSON.stringify(extra)); }
}

function baseState() {
  return { iteration: 0, nodes: [], history: [], arbiterResult: {}, responseContract: {} };
}

function runProcess(content) {
  // draftNode.process expects an llmResponse object with .content + usage.
  const prepared = draftNode.prepare(
    { ...baseState(), originalQuery: 'q', context: {}, clarifyResult: {} },
    { draft: { system: '', user: '{{citableClaims}}' } }
  );
  return draftNode.process(prepared, { content, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
}

function main() {
  console.log('========================================');
  console.log('draft-node response recovery test');
  console.log('========================================');

  console.log('\n1. proper JSON → response from JSON');
  const a = runProcess(JSON.stringify({ response: '## Answer\n\nHello.', confidence: 0.8 }));
  ok('uses JSON response', a.draftResult.response.includes('Hello.'));

  console.log('\n2. raw markdown (no JSON) → recovered');
  const b = runProcess('## Overview\n\nAntibiotics do not treat viruses. <citation ref="cit_1">x</citation>');
  ok('raw markdown recovered', b.draftResult.response.includes('Antibiotics do not treat viruses'), b.draftResult.response);
  ok('citation tag preserved in recovered prose', b.draftResult.response.includes('<citation ref="cit_1">'), b.draftResult.response);

  console.log('\n3. fenced markdown (```), no JSON → fence stripped + recovered');
  const c = runProcess('```\n## Answer\n\nThe sky is blue. <citation ref="cit_2">y</citation>\n```');
  ok('fence markers removed', !c.draftResult.response.includes('```'), c.draftResult.response);
  ok('fenced prose recovered', c.draftResult.response.includes('The sky is blue'), c.draftResult.response);
  ok('citation preserved', c.draftResult.response.includes('cit_2'));

  console.log('\n4. fenced JSON (```json) → parsed by safeParseJson');
  const d = runProcess('```json\n{"response": "## A\\n\\nFenced JSON body.", "confidence": 0.7}\n```');
  ok('fenced JSON parsed to response', d.draftResult.response.includes('Fenced JSON body'), d.draftResult.response);
  ok('no stray fences', !d.draftResult.response.includes('```'));

  console.log('\n5. broken/partial JSON object → not treated as raw prose (conservative)');
  const e = runProcess('{ "response": "unterminated');
  ok('partial JSON does not leak braces as prose', !e.draftResult.response.startsWith('{'), e.draftResult.response);

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main();
