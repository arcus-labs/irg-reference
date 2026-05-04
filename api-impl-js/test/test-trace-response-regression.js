'use strict';

const assert = require('assert');
const draftNode = require('../core/nodes/draft-node');
const exitNode = require('../core/nodes/exit-node');
const { formatTrace } = require('../core/tracing/trace-formatter');

function testEarlyExitResponseIsPreserved() {
  const state = {
    originalQuery: 'Should we use a differential indemnity decomposition before signing?',
    strategyDecision: 'unanswerable',
    _nodeDecision: 'unanswerable',
    clarifyResult: {
      premise_type: 'fabricated_premise',
      premise_explanation: 'the phrase "differential indemnity decomposition" does not appear to be a recognized standard term',
      early_exit: true,
      core_concepts: [
        {
          term: 'differential indemnity decomposition',
          recognized: false,
          notes: 'This appears to be non-standard or misworded legal jargon.',
        },
      ],
    },
    nodes: [],
    history: [],
  };

  const processed = exitNode.process(state);
  const response = processed.nodes[0].content.response;
  assert.ok(response.includes('I can’t answer this as written'));
  assert.ok(response.includes('differential indemnity decomposition'));
  assert.ok(response.includes('Please clarify the term you intended'));

  const trace = formatTrace(processed, { query: state.originalQuery, context: {} });
  assert.equal(trace.trace[0].type, 'exit');
  assert.equal(trace.trace[0].content.response, response);
  assert.equal(trace.draft_response, response);
  assert.equal(trace.trace[0].content.confidence, undefined);
  assert.equal(trace.trace[0].confidence, undefined);
  assert.equal(trace.finalConfidence, undefined);
}

function testExitNodeSupportsLegacyDraftResponseField() {
  const state = {
    originalQuery: 'Test query',
    draftResult: {
      draft_response: 'Legacy final draft',
      overall_confidence: 0.7,
    },
    nodes: [],
    history: [],
  };

  const processed = exitNode.process(state);
  assert.equal(processed.nodes[0].content.response, 'Legacy final draft');
  assert.equal(processed.nodes[0].content.confidence, 0.7);

  const trace = formatTrace(processed, { query: state.originalQuery, context: {} });
  assert.equal(trace.finalConfidence, 0.7);
}

function testDraftNodeTrimsAppendedDuplicateStructure() {
  const state = {
    iteration: 3,
    nodes: [],
    history: [],
    draftExecutionContract: {
      response_policy: { policy: 'answer_normally' },
      forbidden_moves: [],
      required_moves: [],
      section_plan: [],
    },
    arbiterResult: { final_strategy: {} },
  };

  const llmResponse = {
    content: `{
  "response": "## Overview\nPrimary answer.\n\n## Key Points\n- Point 1\n- Point 2\n\n## Analysis\nHelpful analysis.\n\n## Conclusion\nFinal answer.\n\n## Section 1: Restart\nDuplicated structure begins.\n\n## Section 2: More Restart\nMore duplicated structure.",
  "confidence": 0.85
}`,
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  };

  const processed = draftNode.process(state, llmResponse);
  const response = processed.draftResult.response;

  assert.ok(response.includes('## Conclusion'));
  assert.ok(!response.includes('## Section 1: Restart'));
  assert.equal(processed.currentDraft, response);
  assert.equal(processed.nodes[0].content.response, response);
}

function testDraftNodePreservesLastNonEmptyDraftAcrossEmptyRetry() {
  const state = {
    iteration: 3,
    nodes: [],
    history: [],
    currentDraft: 'Previous usable answer',
    lastNonEmptyDraft: 'Previous usable answer',
    lastNonEmptyDraftConfidence: 0.81,
    draftResult: {
      response: 'Previous usable answer',
      confidence: 0.81,
    },
    draftExecutionContract: {
      response_policy: { policy: 'answer_normally' },
      forbidden_moves: [],
      required_moves: [],
      section_plan: [],
    },
    arbiterResult: { final_strategy: {} },
  };

  const llmResponse = {
    content: JSON.stringify({ response: '', confidence: 0.42 }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };

  const processed = draftNode.process(state, llmResponse);
  assert.equal(processed.draftResult.response, '');
  assert.equal(processed.currentDraft, 'Previous usable answer');
  assert.equal(processed.lastNonEmptyDraft, 'Previous usable answer');
  assert.equal(processed.lastNonEmptyDraftConfidence, 0.81);

  const exited = exitNode.process(processed);
  assert.equal(exited.finalResponse, 'Previous usable answer');

  const trace = formatTrace(exited, { query: 'Test query', context: {} });
  assert.equal(trace.draft_response, 'Previous usable answer');
}

testEarlyExitResponseIsPreserved();
testExitNodeSupportsLegacyDraftResponseField();
testDraftNodeTrimsAppendedDuplicateStructure();
testDraftNodePreservesLastNonEmptyDraftAcrossEmptyRetry();
console.log('trace response regression tests passed');