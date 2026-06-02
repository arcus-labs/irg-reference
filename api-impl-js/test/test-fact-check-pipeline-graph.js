'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { factCheckPipelineGraph } = require('../graphs/fact-check-pipeline-graph');
const nodeRegistry = require('../core/execution/irg-node-registry');

const promptsPath = path.join(__dirname, '../core/prompts/irg-prompts.yaml');
const prompts = yaml.load(fs.readFileSync(promptsPath, 'utf8'));

function stampForFilename(isoTimestamp) {
  return String(isoTimestamp || '').replace(/[:.]/g, '-');
}

const mockLlmClient = {
  async call(prompt, opts) {
    if (opts?.node === 'citationSourceGeneration') {
      return {
        content: JSON.stringify({
          claims: [
            {
              research_direction: 'Use a primary astronomy reference and a NASA overview.',
              candidate_sources: [
                {
                  url: 'https://science.nasa.gov/saturn/',
                  title: 'NASA Saturn Overview',
                  why: 'Authoritative overview of Saturn and its ring system.',
                  source_type: 'government',
                },
              ],
              search_queries: ['site:nasa.gov Saturn rings'],
              confidence_prior: 0.9,
            },
          ],
          summary: 'Generated one provisional source plan.',
          confidence: 0.8,
        }),
        usage: { input_tokens: 100, output_tokens: 75, total_tokens: 175 },
      };
    }

    return { content: JSON.stringify({}), usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
  },
};

async function runTest() {
  const previousRoot = process.env.FACT_STORE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'irg-fact-check-pipeline-'));

  try {
    process.env.FACT_STORE_ROOT = tempRoot;

    const registryWrapper = {
      get: (nodeId) => nodeRegistry.getNode(nodeId),
    };

    const result = await runLinearGraph(
      factCheckPipelineGraph,
      {
        originalQuery: 'Check whether Saturn has rings.',
        context: 'Astronomy sanity check',
        factCheckResult: {
          critical_claims: [
            {
              claim: 'Saturn has rings.',
              importance: 'Core astronomy claim.',
              assessment: 'true',
              reasoning: 'Widely known astronomy fact.',
              source: null,
            },
          ],
        },
        config: {
          maxIterations: 1,
          enableFactCheckPipeline: true,
        },
      },
      mockLlmClient,
      prompts,
      registryWrapper
    );

    assert.ok(result.nodes.some((node) => node.type === 'external_fact_check'));
    assert.ok(result.nodes.some((node) => node.type === 'fact_check_pipeline_gate'));
    assert.ok(result.nodes.some((node) => node.type === 'citation_source_generation'));
    assert.ok(result.nodes.some((node) => node.type === 'citation_write'));
    assert.equal(result.factCheckPipelineResult.summary.written_citations, 1);
    assert.ok(result.factCheckResult?.artifact_path);
    assert.ok(fs.existsSync(path.join(tempRoot, result.factCheckResult.artifact_path)));
    assert.ok(fs.existsSync(path.join(tempRoot, 'metadata', 'fact_check_log.jsonl')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'metadata', 'retrieval_log.jsonl')));
    assert.equal(result.factCheckPipelineResult.claims.length, 1);
    assert.ok(
      path.basename(result.factCheckPipelineResult.claims[0].citation_file)
        .startsWith(`${stampForFilename(result.factCheckPipelineResult.generated_at)}--`)
    );

    console.log('✓ standalone fact-check pipeline graph writes provisional citation artifacts');
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACT_STORE_ROOT;
    } else {
      process.env.FACT_STORE_ROOT = previousRoot;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

runTest().catch((error) => {
  console.error('❌ standalone fact-check pipeline graph test failed');
  console.error(error.stack || error.message);
  process.exit(1);
});