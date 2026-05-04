/**
 * Test IRG with Real Groq LLM
 * 
 * Tests the linear graph format with actual LLM responses
 * Uses Groq API for fast inference
 */

'use strict';

const path = require('path');
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const { runLinearGraph } = require('../core/execution/irg-interpreter-linear');
const { irgGraphLinear } = require('../graphs/irg-graph-linear');
const nodeRegistry = require('../core/execution/irg-node-registry');
const yaml = require('js-yaml');
const fs = require('fs');

// Groq LLM Client
const groqClient = {
  async call(prompt, opts = {}) {
    const apiKey = process.env.API_KEY_GROQ;
    if (!apiKey) {
      throw new Error('API_KEY_GROQ not found in .env');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: opts.temperature || 0.7,
        max_tokens: opts.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Groq API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  },
};

// Load prompts
const promptsYaml = fs.readFileSync(path.join(__dirname, '../core/prompts/irg-prompts.yaml'), 'utf8');
const prompts = yaml.load(promptsYaml);

async function runTest() {
  console.log('\n' + '='.repeat(80));
  console.log('IRG LINEAR GRAPH TEST WITH GROQ LLM');
  console.log('='.repeat(80) + '\n');

  const initialState = {
    originalQuery: 'What are the best practices for machine learning model deployment?',
    context: 'Technical question about ML operations',
    config: { maxIterations: 2, confidenceThreshold: 0.7 },
  };

  console.log('📋 QUERY:', initialState.originalQuery);
  console.log('🔄 Starting graph execution...\n');

  try {
    // Wrap nodeRegistry to match expected interface
    const registryWrapper = {
      get: (nodeId) => nodeRegistry.getNode(nodeId),
    };

    const result = await runLinearGraph(
      irgGraphLinear,
      initialState,
      groqClient,
      prompts,
      registryWrapper
    );

    console.log('\n' + '='.repeat(80));
    console.log('✅ EXECUTION COMPLETE');
    console.log('='.repeat(80) + '\n');

    console.log('📊 RESULTS:');
    console.log('  Nodes executed:', result.nodes?.length || 0);
    console.log('  Final decision:', result._nodeDecision);
    console.log('\n📝 FINAL RESPONSE (YAML + Markdown):');
    console.log(result.draftResult || result.currentDraft || 'No response generated');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  }
}

runTest();

