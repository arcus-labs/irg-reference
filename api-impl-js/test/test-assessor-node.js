/**
 * Test script for the Assessor Node
 * Verifies that the assessor node works correctly with the IRG system
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const assessorNode = require('../core/nodes/assessor-node');
const nodeRegistry = require('../core/execution/irg-node-registry');

console.log('\n' + '='.repeat(70));
console.log('ASSESSOR NODE TEST');
console.log('='.repeat(70));

// Load prompts
const promptsPath = path.join(__dirname, '../core/prompts/irg-prompts.yaml');
const promptsYaml = fs.readFileSync(promptsPath, 'utf8');
const prompts = yaml.load(promptsYaml);

console.log('\n1. PROMPT LOADING:');
console.log('-'.repeat(70));
console.log(`✓ Prompts loaded: ${Object.keys(prompts).length} templates`);
console.log(`✓ Assessor prompt available: ${!!prompts.assessor}`);
console.log(`  - System prompt: ${prompts.assessor.system.length} chars`);
console.log(`  - User prompt: ${prompts.assessor.user.length} chars`);

// Test node registry
console.log('\n2. NODE REGISTRY:');
console.log('-'.repeat(70));
console.log(`✓ Assessor registered: ${nodeRegistry.hasNode('assessor')}`);
const node = nodeRegistry.getNode('assessor');
console.log(`✓ Node ID: ${node.id}`);
console.log(`✓ Node type: ${node.type}`);
console.log(`✓ Has prepare: ${typeof node.prepare === 'function'}`);
console.log(`✓ Has llmCall: ${typeof node.llmCall === 'function'}`);
console.log(`✓ Has process: ${typeof node.process === 'function'}`);

// Test prepare function
console.log('\n3. PREPARE FUNCTION:');
console.log('-'.repeat(70));
const mockState = {
  originalQuery: 'What are best practices for ML?',
  trace: [
    { id: 'node_1', type: 'clarify', goal: 'Clarify query', confidence: 0.9, status: 'completed' },
    { id: 'node_2', type: 'draft', goal: 'Generate draft', confidence: 0.85, status: 'completed' },
  ],
  metaEvaluationResult: { recommendation: 'exit' },
  draftEvaluation: { confidence: 0.85 },
  currentDraft: 'This is a test draft response.',
  factCheckResult: { verified_claims: 5 },
  adversaryResult: { weak_assumptions: [] },
  impactResult: { harm_assessment: { level: 'low' } },
};

const prepared = assessorNode.prepare(mockState, prompts);
console.log(`✓ Prepare executed successfully`);
console.log(`✓ assessorPrompt generated: ${prepared.assessorPrompt.length} chars`);
console.log(`✓ currentPhase set to: ${prepared.currentPhase}`);

// Test process function
console.log('\n4. PROCESS FUNCTION:');
console.log('-'.repeat(70));
const mockLLMResponse = JSON.stringify({
  eie_dimensions: {
    claim_evidence_alignment: 0.85,
    confidence_calibration: 0.78,
    scope_discipline: 0.92,
    omission_awareness: 0.65,
    internal_consistency: 0.88,
    reasoning_transparency: 0.81,
  },
  overall_eie_score: 0.81,
  verification_confidence: 0.87,
  assessor_decision: 'exit',
  reasoning: 'Governance integrity verified',
  risk_flags: [
    {
      dimension: 'omission_awareness',
      severity: 'low',
      description: 'Minor gap in coverage',
      trace_reference: 'node_1',
    },
  ],
  remediation_guidance: '',
});

const processed = assessorNode.process(prepared, mockLLMResponse);
console.log(`✓ Process executed successfully`);
console.log(`✓ judgmentArtifact created: ${!!processed.judgmentArtifact}`);
console.log(`✓ Overall EIE score: ${processed.judgmentArtifact.overall_eie_score}`);
console.log(`✓ Assessor decision: ${processed.judgmentArtifact.assessor_decision}`);
console.log(`✓ Risk flags: ${processed.judgmentArtifact.risk_flags.length}`);

if (processed.judgmentArtifact.assessor_decision !== 'exit') {
  throw new Error(`Expected normalized assessor_decision to be exit, got ${processed.judgmentArtifact.assessor_decision}`);
}

if (processed.judgmentArtifact.release_decision !== 'exit') {
  throw new Error(`Expected compatibility release_decision to be exit, got ${processed.judgmentArtifact.release_decision}`);
}

const legacyProcessed = assessorNode.process(prepared, JSON.stringify({
  eie_dimensions: {
    claim_evidence_alignment: 0.9,
    confidence_calibration: 0.9,
    scope_discipline: 0.9,
    omission_awareness: 0.9,
    internal_consistency: 0.9,
    reasoning_transparency: 0.9,
  },
  verification_confidence: 0.9,
  release_decision: 'release',
  reasoning: 'Legacy output still supported.',
  risk_flags: [],
  remediation_guidance: '',
}));

if (legacyProcessed.judgmentArtifact.assessor_decision !== 'exit') {
  throw new Error(`Expected legacy release_decision=release to normalize to exit, got ${legacyProcessed.judgmentArtifact.assessor_decision}`);
}

const legacyIterateProcessed = assessorNode.process(prepared, JSON.stringify({
  eie_dimensions: {
    claim_evidence_alignment: 0.9,
    confidence_calibration: 0.9,
    scope_discipline: 0.9,
    omission_awareness: 0.9,
    internal_consistency: 0.9,
    reasoning_transparency: 0.9,
  },
  verification_confidence: 0.9,
  release_decision: 'refuse',
  reasoning: 'Legacy iterate output still supported.',
  risk_flags: [],
  remediation_guidance: '',
}));

if (legacyIterateProcessed.judgmentArtifact.assessor_decision !== 'iterate') {
  throw new Error(`Expected legacy release_decision=refuse to normalize to iterate, got ${legacyIterateProcessed.judgmentArtifact.assessor_decision}`);
}

// Test with missing prompt
console.log('\n5. ERROR HANDLING:');
console.log('-'.repeat(70));
const emptyPrompts = {};
const prepared2 = assessorNode.prepare(mockState, emptyPrompts);
console.log(`✓ Handles missing assessor prompt gracefully`);
console.log(`✓ assessorPrompt is empty: ${prepared2.assessorPrompt === ''}`);
console.log('✓ Legacy assessor decision values normalize to EXIT / ITERATE');

console.log('\n' + '='.repeat(70));
console.log('✅ ALL TESTS PASSED');
console.log('='.repeat(70) + '\n');

