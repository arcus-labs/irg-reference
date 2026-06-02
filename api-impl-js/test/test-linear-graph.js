/**
 * Linear Graph Test
 *
 * Tests the new linear graph format with parallel execution support.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseYamlOnly } = require('../core/parsing/yaml-format-utils');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphExternalFacts: irgGraphLinear } = require('../graphs/irg-graph-external-facts');
const nodeRegistry = require('../core/execution/irg-node-registry');

// Mock LLM client
const mockLlmClient = {
  callCount: 0,
  async call(prompt, options = {}) {
    this.callCount++;
    const node = options.node || 'unknown';
    console.log(`[LLM Call ${this.callCount}] Node: ${node}`);

    const usage = {
      input_tokens: 100,
      output_tokens: 80,
      total_tokens: 180,
    };
    
    const responses = {
      clarify: JSON.stringify({
        core_concepts: [{ term: 'ML best practices', recognized: true, notes: 'standard topic' }],
        premise_type: 'valid',
        premise_explanation: 'The query is answerable as written.',
        ambiguities: [],
        missing_context: [],
        assumptions: [],
        scope_assessment: 'clear',
        clarification_questions: [],
        failure_modes: [],
        salvageable_core: 'Provide a concise best-practices overview.',
        invalid_components: [],
        dangerous_terms: [],
        can_proceed: true,
        early_exit: false,
        confidence: 0.8,
        reasoning: 'Straightforward request.',
      }),
      adversary: JSON.stringify({ weak_assumptions: [], strategy_flaws: [], recommended_adjustments: [], confidence: 0.8 }),
      strategy: JSON.stringify({
        key_points: ['Cover data quality, evaluation, deployment, and monitoring.'],
        structure: ['overview', 'best practices'],
        reasoning_approach: 'direct',
        evidence_types: ['general best practices'],
        response_policy: { policy: 'answer_normally', rationale: 'Answerable query', delivery_goal: 'be practical' },
        blueprint: { forbidden_moves: [], required_moves: [] },
        confidence: 0.85,
      }),
      arbiter: JSON.stringify({
        synthesis: 'Use a concise, practical structure.',
        final_strategy: { key_points: ['data quality', 'evaluation', 'monitoring'], required_moves: [] },
        addressed_concerns: [],
        confidence: 0.85,
      }),
      factCheck: JSON.stringify({
        critical_claims: [
          {
            claim: 'Machine learning systems can overfit training data.',
            importance: 'This supports the recommendation to validate on held-out data.',
            assessment: 'true',
            reasoning: 'Widely established ML principle.',
            source: null,
          },
        ],
        summary: 'One foundational ML claim identified.',
        confidence: 0.8,
      }),
      citationSourceGeneration: JSON.stringify({
        claims: [
          {
            research_direction: 'Use an educational reference explaining overfitting and held-out evaluation.',
            candidate_sources: [
              {
                url: 'https://developers.google.com/machine-learning/crash-course/overfitting',
                title: 'Overfitting: Machine Learning Crash Course',
                why: 'Directly explains overfitting in ML.',
                source_type: 'reference',
              },
            ],
            search_queries: ['machine learning overfitting held-out evaluation'],
            confidence_prior: 0.8,
          },
        ],
        summary: 'Generated one candidate source plan.',
        confidence: 0.75,
      }),
      impact: JSON.stringify({ implications: [], limitations: [], confidence: 0.8 }),
      draft: JSON.stringify({ response: '## Overview\n\nUse standard ML best practices.\n\n## Key Points\n\n- Validate data quality\n- Evaluate rigorously\n- Monitor in production\n\n## Analysis\n\nThese practices reduce failure risk.\n\n## Conclusion\n\nApply disciplined validation and monitoring.', confidence: 0.95 }),
      metaEvaluation: JSON.stringify({
        execution_quality: { score: 0.9, justification: 'Matches the requested practical structure.', improvement_areas: '' },
        completeness: { score: 0.88, justification: 'Covers the main areas succinctly.', improvement_areas: '' },
        clarity: { score: 0.9, justification: 'Clear markdown structure.', improvement_areas: '' },
        confidence: 0.9,
        recommendation: 'exit',
        iteration_learnings: '',
      }),
      assessor: JSON.stringify({
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
      }),
    };
    return {
      content: responses[node] || JSON.stringify({}),
      usage,
    };
  },
};

function loadPrompts() {
  const promptsPath = path.join(__dirname, '../core/prompts/irg-prompts.yaml');
  const raw = fs.readFileSync(promptsPath, 'utf8');
  return parseYamlOnly(raw);
}

async function runTest() {
  const previousRoot = process.env.FACT_STORE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'irg-linear-graph-'));

  console.log('\n' + '='.repeat(80));
  console.log('LINEAR GRAPH TEST - New Format with Parallel Support');
  console.log('='.repeat(80));

  try {
    process.env.FACT_STORE_ROOT = tempRoot;

    const prompts = loadPrompts();
    const initialState = {
      originalQuery: 'What are best practices for ML?',
      context: 'User is a software engineer',
      iteration: 0,
      config: { maxIterations: 5, enableFactCheckPipeline: true },
    };

    console.log('\n📋 INITIAL STATE:');
    console.log(`  Query: ${initialState.originalQuery}`);

    // Create a wrapper for nodeRegistry to match the expected interface
    const registryWrapper = {
      get: (nodeId) => nodeRegistry.getNode(nodeId),
    };

    const result = await runLinearGraph(
      irgGraphLinear,
      initialState,
      mockLlmClient,
      prompts,
      registryWrapper
    );
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ GRAPH EXECUTION COMPLETED');
    console.log('='.repeat(80));
    
    console.log('\n📊 EXECUTION SUMMARY:');
    console.log(`  Total LLM calls: ${mockLlmClient.callCount}`);
    console.log(`  Nodes executed: ${result.nodes?.length || 0}`);
    console.log(`  Final decision: ${result._nodeDecision}`);
    console.log(`  External fact checks: ${result.externalFactCheckResult?.claims?.length || 0}`);

    const nodeTypes = (result.nodes || []).map((node) => node.type);
    // The fact-check node records 'fact_check_pipeline' when the external
    // pipeline is enabled (as in this test), else 'fact_check'.
    const factCheckIndex = nodeTypes.indexOf('fact_check') >= 0
      ? nodeTypes.indexOf('fact_check')
      : nodeTypes.indexOf('fact_check_pipeline');
    const externalFactCheckIndex = nodeTypes.indexOf('external_fact_check');
    const citationSourceGenerationIndex = nodeTypes.indexOf('citation_source_generation');
    const citationWriteIndex = nodeTypes.indexOf('citation_write');
    const impactIndex = nodeTypes.indexOf('impact_prediction');

    if (!(factCheckIndex >= 0 && externalFactCheckIndex >= 0 && impactIndex >= 0)) {
      throw new Error('Expected fact_check, external_fact_check, and impact_prediction nodes to execute');
    }

    if (!(factCheckIndex < externalFactCheckIndex && externalFactCheckIndex < impactIndex)) {
      throw new Error('Expected fact_check -> external_fact_check -> impact_prediction ordering');
    }

    if (!(citationSourceGenerationIndex >= 0 && citationWriteIndex >= 0)) {
      throw new Error('Expected citation source generation and citation write nodes to execute');
    }

    if (!(externalFactCheckIndex < citationSourceGenerationIndex && citationWriteIndex < impactIndex)) {
      throw new Error('Expected external fact-check pipeline nodes to complete before impact');
    }

    if (!result.nodes?.some(node => node.type === 'external_fact_check')) {
      throw new Error('Expected external_fact_check node to execute');
    }

    if (!result.externalFactCheckResult) {
      throw new Error('Expected externalFactCheckResult to be present');
    }

    if (!result.nodes?.some(node => node.type === 'citation_source_generation')) {
      throw new Error('Expected citation_source_generation node to execute when pipeline is enabled');
    }

    if (!result.nodes?.some(node => node.type === 'citation_write')) {
      throw new Error('Expected citation_write node to execute when pipeline is enabled');
    }

    if (!result.factCheckPipelineResult?.summary?.written_citations) {
      throw new Error('Expected factCheckPipelineResult to include written citations');
    }

    if (!result.factCheckResult?.artifact_path) {
      throw new Error('Expected factCheckResult to reference a persisted claim artifact');
    }

    const claimArtifactPath = path.join(tempRoot, result.factCheckResult.artifact_path);
    if (!fs.existsSync(claimArtifactPath)) {
      throw new Error(`Expected claim artifact at ${claimArtifactPath}`);
    }

    const claimArtifact = JSON.parse(fs.readFileSync(claimArtifactPath, 'utf8'));
    if (claimArtifact.critical_claim_count !== 1) {
      throw new Error('Expected persisted claim artifact to contain exactly one claim');
    }

    // factCheckResult now carries BOTH artifact metadata (artifact_path) AND
    // the inline claims, so downstream nodes (memoryRecall) can read claims
    // without re-reading the artifact from disk.
    if (!Array.isArray(result.factCheckResult.critical_claims) || result.factCheckResult.critical_claims.length !== 1) {
      throw new Error('Expected graph state factCheckResult to carry the inline critical_claims array');
    }

    if (!fs.existsSync(path.join(tempRoot, 'metadata', 'fact_check_log.jsonl'))) {
      throw new Error('Expected fact_check_log.jsonl to be written');
    }
    
    console.log('\n✨ TEST PASSED');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACT_STORE_ROOT;
    } else {
      process.env.FACT_STORE_ROOT = previousRoot;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

runTest();

