/**
 * Test Suite for IRG Interpreter
 *
 * Tests the new flexible graph interpreter with:
 * - Linear execution
 * - Early exit (strategy gate)
 * - Iteration/looping (convergence)
 * - Branching logic
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphLinear } = require('../graphs/irg-graph-linear');
const nodeRegistry = require('../core/execution/irg-node-registry');
const { formatTrace } = require('../core/tracing/trace-formatter');

// Output directory for traces
const TRACES_DIR = path.resolve(__dirname, '../../trace-navigator/traces');

// Ensure traces directory exists
if (!fs.existsSync(TRACES_DIR)) {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
}

// Helper function to save trace
function saveTrace(testName, result) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${testName.replace(/\s+/g, '-')}_${timestamp}.json`;
    const filepath = path.join(TRACES_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log(`  📁 Trace saved: ${filename}`);
  } catch (err) {
    console.error(`  ❌ Failed to save trace: ${err.message}`);
  }
}

async function withTempFactStore(run) {
  const previousRoot = process.env.FACT_STORE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'irg-interpreter-fact-store-'));

  try {
    process.env.FACT_STORE_ROOT = tempRoot;
    return await run(tempRoot);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACT_STORE_ROOT;
    } else {
      process.env.FACT_STORE_ROOT = previousRoot;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

// Load prompts
const yaml = require('js-yaml');
const promptsPath = path.join(__dirname, '../core/prompts/irg-prompts.yaml');
const promptsYaml = fs.readFileSync(promptsPath, 'utf8');
const prompts = yaml.load(promptsYaml);

function indexOfNodeType(nodes, type) {
  return nodes.findIndex((node) => node.type === type);
}

// Mock LLM client
const mockLlmClient = {
  async call(prompt, opts) {
    // Return mock JSON responses based on node
    const node = opts?.node || '';

    // Mock token usage data
    const mockUsage = {
      input_tokens: 150,
      output_tokens: 100,
      total_tokens: 250,
    };

    let content = '';
    if (node === 'clarify') {
      content = JSON.stringify({
        core_concepts: [{ term: '2+2', recognized: true, notes: 'basic arithmetic' }],
        premise_type: 'valid',
        premise_explanation: 'The question is straightforward.',
        ambiguities: [],
        missing_context: [],
        assumptions: [],
        scope_assessment: 'clear',
        clarification_questions: [],
        failure_modes: [],
        salvageable_core: 'Answer the arithmetic question directly.',
        invalid_components: [],
        dangerous_terms: [],
        can_proceed: true,
        early_exit: false,
        confidence: 0.9,
        reasoning: 'No clarification needed.',
      });
    } else if (node === 'strategy') {
      content = JSON.stringify({
        key_points: [],
        structure: [],
        reasoning_approach: '',
        evidence_types: [],
        response_policy: {
          policy: 'answer_normally',
          rationale: 'The query is valid as written.',
          delivery_goal: 'be direct and helpful',
        },
        blueprint: { forbidden_moves: [], required_moves: [] },
        confidence: 0.85,
      });
    } else if (node === 'adversary') {
      content = JSON.stringify({ weak_assumptions: [], strategy_flaws: [], recommended_adjustments: [], confidence: 0.9 });
    } else if (node === 'arbiter') {
      content = JSON.stringify({ synthesis: 'Synthesis of strategy and adversary', final_strategy: { key_points: [] }, addressed_concerns: [], confidence: 0.85 });
    } else if (node === 'factCheck') {
      content = JSON.stringify({
        critical_claims: [
          {
            claim: '2+2 equals 4.',
            importance: 'This arithmetic fact is required to answer the query correctly.',
            assessment: 'true',
            reasoning: 'Basic arithmetic.',
            source: null,
          },
        ],
        summary: 'One core arithmetic claim requires minimal verification.',
        confidence: 0.8,
      });
    } else if (node === 'impact') {
      content = JSON.stringify({ implications: [], limitations: [], confidence: 0.8 });
    } else if (node === 'draft') {
      content = JSON.stringify({ response: 'This is a test response.', confidence: 0.85 });
    } else if (node === 'metaEvaluation') {
      content = JSON.stringify({ execution_quality: 0.85, completeness: 0.9, clarity: 0.88, confidence: 0.85, recommendation: 'exit', iteration_learnings: '' });
    } else if (node === 'assessor') {
      content = JSON.stringify({
        eie_dimensions: {
          claim_evidence_alignment: 0.9,
          confidence_calibration: 0.9,
          scope_discipline: 0.9,
          omission_awareness: 0.9,
          internal_consistency: 0.9,
          reasoning_transparency: 0.9,
        },
        verification_confidence: 0.9,
        assessor_decision: 'exit',
        reasoning: 'Looks good.',
        risk_flags: [],
        remediation_guidance: '',
      });
    } else {
      content = JSON.stringify({});
    }

    // Return object with content and usage data (matching GroqLLMClient format)
    return {
      content,
      usage: mockUsage,
    };
  },
};

// Test 1: Basic linear execution
async function testLinearExecution() {
  console.log('\n=== Test 1: Linear Execution ===');

  return withTempFactStore(async (tempRoot) => {
    const initialState = {
      originalQuery: 'What is 2+2?',
      context: 'Math question',
      config: { maxIterations: 5, confidenceThreshold: 0.8 },
    };

    // Wrap nodeRegistry to match expected interface
    const registryWrapper = {
      get: (nodeId) => nodeRegistry.getNode(nodeId),
    };

    const result = await runLinearGraph(irgGraphLinear, initialState, mockLlmClient, prompts, registryWrapper);

    console.log('✓ Graph executed successfully');
    console.log(`  Nodes executed: ${result.nodes.length}`);
    console.log(`  Nodes: ${result.nodes.map(n => n.type).join(' → ')}`);
    assert.equal(result.strategyResult.response_policy.policy, 'answer_normally');
    assert.ok(Array.isArray(result.arbiterResult.final_strategy.required_moves));
    assert.ok(result.nodes.some(n => n.type === 'external_fact_check'));
    assert.ok(result.nodes.some(n => n.type === 'fact_check_pipeline_gate'));
    assert.ok(!result.nodes.some(n => n.type === 'citation_source_generation'));
    assert.ok(!result.nodes.some(n => n.type === 'citation_write'));
    assert.ok(result.externalFactCheckResult);
    assert.equal(result.externalFactCheckResult.retrieval_mode, 'filesystem_cache_only');
    assert.equal(result.externalFactCheckResult.claims.length, 1);
    assert.equal(result.draftResult.execution_contract.response_policy.policy, 'answer_normally');
    assert.ok(result.factCheckResult?.artifact_path);
    assert.equal(result.factCheckResult.critical_claims, undefined);
    assert.equal(result.factCheckResult.fact_store_root, tempRoot);
    assert.equal(result.externalFactCheckResult.fact_store_root, tempRoot);

    const factCheckIndex = indexOfNodeType(result.nodes, 'fact_check');
    const externalFactCheckIndex = indexOfNodeType(result.nodes, 'external_fact_check');
    const impactIndex = indexOfNodeType(result.nodes, 'impact_prediction');

    assert.ok(factCheckIndex >= 0);
    assert.ok(externalFactCheckIndex >= 0);
    assert.ok(impactIndex >= 0);
    assert.ok(
      factCheckIndex < externalFactCheckIndex,
      'expected external fact check to run after internal fact check'
    );
    assert.ok(
      externalFactCheckIndex < impactIndex,
      'expected impact to run after external fact check in the main graph'
    );

    const claimArtifactPath = path.join(tempRoot, result.factCheckResult.artifact_path);
    assert.ok(fs.existsSync(claimArtifactPath));
    assert.ok(fs.existsSync(path.join(tempRoot, 'metadata', 'fact_check_log.jsonl')));

    // Format and save the trace
    const trace = formatTrace(result, {
      query: initialState.originalQuery,
      context: initialState.context,
      maxIterations: 5,
      confidenceThreshold: 0.8,
      model: 'llama-3.3-70b-versatile',
    });
    saveTrace('test-1-linear-execution', trace);

    return result.nodes.length > 0;
  });
}

// Test 2: Early exit (clarification-owned fabricated premise)
async function testEarlyExit() {
  console.log('\n=== Test 2: Early Exit (Clarification-Owned) ===');

  // Mock LLM that marks query as a fabricated premise during clarification
  const mockUsage = {
    input_tokens: 150,
    output_tokens: 100,
    total_tokens: 250,
  };

  const earlyExitLlm = {
    async call(prompt, opts) {
      if (opts?.node === 'clarify') {
        return {
          content: JSON.stringify({
            core_concepts: [{ term: 'quantum indemnity spline', recognized: false, notes: 'not a recognized term' }],
            premise_type: 'fabricated_premise',
            premise_explanation: 'the query depends on an unknown or misworded term',
            ambiguities: [],
            missing_context: [],
            assumptions: [],
            scope_assessment: 'unclear because the central term is unrecognized',
            failure_modes: ['unknown_invented_referent'],
            salvageable_core: '',
            invalid_components: ['quantum indemnity spline'],
            dangerous_terms: ['quantum indemnity spline'],
            clarification_questions: ['What do you mean by "quantum indemnity spline"?'],
            can_proceed: false,
            early_exit: true,
            confidence: 0.9,
            reasoning: 'The central term appears fabricated.',
          }),
          usage: mockUsage,
        };
      }
      return mockLlmClient.call(prompt, opts);
    },
  };

  const initialState = {
    originalQuery: 'Unanswerable question',
    context: 'Test',
    config: { maxIterations: 5, confidenceThreshold: 0.8 },
  };

  // Wrap nodeRegistry to match expected interface
  const registryWrapper = {
    get: (nodeId) => nodeRegistry.getNode(nodeId),
  };

  const result = await runLinearGraph(irgGraphLinear, initialState, earlyExitLlm, prompts, registryWrapper);

  console.log('✓ Early exit executed');
  console.log(`  Nodes executed: ${result.nodes.length}`);
  console.log(`  Nodes: ${result.nodes.map(n => n.type).join(' → ')}`);

  assert.ok(result.nodes.some(n => n.type === 'strategy_gate'));
  assert.ok(!result.nodes.some(n => n.type === 'draft'));
  assert.ok(result.finalResponse.includes('I can’t answer this as written'));

  // Format and save the trace
  const trace = formatTrace(result, {
    query: initialState.originalQuery,
    context: initialState.context,
    maxIterations: 5,
    confidenceThreshold: 0.8,
    model: 'llama-3.3-70b-versatile',
  });
  saveTrace('test-2-early-exit', trace);

  // Should have fewer nodes due to early exit
  return result.nodes.length > 0;
}

// Test 3: Node registry
async function testNodeRegistry() {
  console.log('\n=== Test 3: Node Registry ===');

  const nodeIds = nodeRegistry.getNodeIds();
  console.log(`✓ Registry contains ${nodeIds.length} nodes`);
  console.log(`  Nodes: ${nodeIds.join(', ')}`);

  const clarifyNode = nodeRegistry.getNode('clarify');
  console.log(`✓ Retrieved clarify node: ${clarifyNode.id}`);

  return nodeIds.length === 17
    && nodeIds.includes('strategyGate')
    && nodeIds.includes('assessor')
    && nodeIds.includes('externalFactCheck')
    && nodeIds.includes('factCheckPipelineGate')
    && nodeIds.includes('citationSourceGeneration')
    && nodeIds.includes('citationWrite');
}

// Test 4: Graph definition structure
async function testGraphDefinition() {
  console.log('\n=== Test 4: Graph Definition (Linear Format) ===');

  console.log(`✓ Graph is an array with ${irgGraphLinear.length} steps`);

  // Check for key nodes in the graph
  const nodeStrings = irgGraphLinear.filter(step => typeof step === 'string');
  console.log(`✓ Linear nodes: ${nodeStrings.join(' → ')}`);

  // Verify the flow includes arbiter after adversary
  const adversaryIndex = irgGraphLinear.indexOf('adversary');
  const arbiterIndex = irgGraphLinear.indexOf('arbiter');
  console.log(`✓ Adversary at index ${adversaryIndex}, Arbiter at index ${arbiterIndex}`);
  console.log(`✓ Arbiter comes after adversary: ${arbiterIndex > adversaryIndex}`);

  // Check for parallel execution
  const parallelStep = irgGraphLinear.find(step => step.parallel);
  console.log(`✓ Parallel execution: ${parallelStep?.parallel?.join(', ')}`);

  const externalFactCheckIndex = irgGraphLinear.indexOf('externalFactCheck');
  console.log(`✓ External Fact Check at index ${externalFactCheckIndex}`);

  const factCheckPipelineGateIndex = irgGraphLinear.findIndex(step => step.gate === 'factCheckPipelineGate');
  console.log(`✓ Fact-Check Pipeline Gate at index ${factCheckPipelineGateIndex}`);

  // Check for convergence
  const convergeStep = irgGraphLinear.find(step => step.converge);
  console.log(`✓ Convergence node: ${convergeStep?.converge}`);

  return arbiterIndex > adversaryIndex && externalFactCheckIndex !== -1 && factCheckPipelineGateIndex !== -1;
}

// Run all tests
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     IRG Interpreter Test Suite                         ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    const test1 = await testLinearExecution();
    const test2 = await testEarlyExit();
    const test3 = await testNodeRegistry();
    const test4 = await testGraphDefinition();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     Test Results                                       ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ Linear Execution:     ${test1 ? '✓ PASS' : '✗ FAIL'}                          ║`);
    console.log(`║ Early Exit:           ${test2 ? '✓ PASS' : '✗ FAIL'}                          ║`);
    console.log(`║ Node Registry:        ${test3 ? '✓ PASS' : '✗ FAIL'}                          ║`);
    console.log(`║ Graph Definition:     ${test4 ? '✓ PASS' : '✗ FAIL'}                          ║`);
    console.log('╚════════════════════════════════════════════════════════╝');

    const allPassed = test1 && test2 && test3 && test4;
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('\n✗ Test suite failed with error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();

