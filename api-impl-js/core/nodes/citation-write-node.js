'use strict';

const { recordNode } = require('./node-utils');
const { writeCitationArtifacts } = require('../external-fact-check/citation-writer');

const citationWriteNode = {
  id: 'citationWrite',
  type: 'citation_write',

  prepare(state) {
    return {
      ...state,
      citationWriteInput: {
        claimPlans: state.citationSourceGenerationResult?.claims || [],
        originalQuery: state.originalQuery,
        context: state.context,
      },
      currentPhase: 'citationWrite',
    };
  },

  async llmCall(state) {
    return writeCitationArtifacts(state.citationWriteInput || {});
  },

  process(state, writeResult) {
    const result = writeResult && typeof writeResult === 'object'
      ? writeResult
      : {
        generated_at: new Date().toISOString(),
        retrieval_mode: 'llm_generated_source_candidates',
        retrieval_deferred: true,
        claims: [],
        citations: [],
        summary: {
          total_claims: 0,
          written_citations: 0,
          skipped_claims: 0,
          total_candidate_sources: 0,
          retrieval_log_entries: 0,
        },
        confidence: 1,
      };

    const pipelineResult = {
      ...result,
      source_generation: state.citationSourceGenerationResult || {},
    };

    const node = {
      id: `node_citation_write_${state.iteration || 0}`,
      type: 'citation_write',
      goal: 'Write provisional citation artifacts and retrieval log entries',
      content: pipelineResult,
      raw_output: JSON.stringify(pipelineResult),
      status: 'completed',
      confidence: Number(pipelineResult.confidence ?? 0.5),
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        citationWriteResult: pipelineResult,
        factCheckPipelineResult: pipelineResult,
      },
      node,
      'citationWrite'
    );
  },
};

module.exports = citationWriteNode;