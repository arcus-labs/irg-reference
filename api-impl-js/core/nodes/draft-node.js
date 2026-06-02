/**
 * Draft Node
 *
 * Generates the response draft based on the unified strategy from arbiter,
 * fact-checking results, and impact assessment.
 *
 * Prepare: Renders draft prompt with arbiter strategy, fact-check, and impact
 * LLM Call: Calls LLM to generate draft response
 * Process: Parses response and records draft
 */

'use strict';

const {
  buildPrompt,
  recordNode,
  safeParseJson,
  extractTokens,
  normalizeDraftResponse,
  convertToMarkdown,
} = require('./node-utils');
const { buildFactCheckPromptResultSync } = require('../external-fact-check/claim-store');
const { buildCitableSet } = require('../citations/build-citable-set');

/**
 * Render the citable set as a compact list for the draft prompt. The model
 * only needs the handle, claim text, and verdict to decide where to wrap a
 * <citation> tag — full source detail stays out of the prompt to save tokens.
 */
function renderCitableClaims(citableSet) {
  if (!citableSet.length) return '';
  return JSON.stringify(
    citableSet.map((c) => ({
      handle: c.handle,
      claim_text: c.claim_text,
      verdict: c.verdict, // "supported" | "refuted"
    })),
    null,
    2
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function buildExecutionContract(state) {
  const responseContract = state.responseContract || {};
  const finalStrategy = state.arbiterResult?.final_strategy || {};

  return {
    response_policy: responseContract.response_policy || finalStrategy.response_policy || {},
    dangerous_terms: Array.isArray(responseContract.dangerous_terms) ? responseContract.dangerous_terms : [],
    invalid_components: Array.isArray(responseContract.invalid_components) ? responseContract.invalid_components : [],
    failure_modes: Array.isArray(responseContract.failure_modes) ? responseContract.failure_modes : [],
    laundering_risks: Array.isArray(responseContract.laundering_risks) ? responseContract.laundering_risks : [],
    forbidden_moves: Array.isArray(responseContract.forbidden_moves)
      ? responseContract.forbidden_moves
      : Array.isArray(finalStrategy.forbidden_moves)
        ? finalStrategy.forbidden_moves
        : [],
    required_moves: Array.isArray(responseContract.required_moves)
      ? responseContract.required_moves
      : Array.isArray(finalStrategy.required_moves)
        ? finalStrategy.required_moves
        : [],
    section_plan: Array.isArray(responseContract.section_plan)
      ? responseContract.section_plan
      : Array.isArray(finalStrategy.section_plan)
        ? finalStrategy.section_plan
        : [],
  };
}

const draftNode = {
  id: 'draft',
  type: 'draft',

  prepare(state, prompts) {
    const executionContract = buildExecutionContract(state);
    const factCheckPromptResult = buildFactCheckPromptResultSync(state.factCheckResult);

    // Build the citable set (verified + supported|refuted) from fresh
    // verification (irg-external-facts) and/or recalled evidence (irg-simple).
    // The model is told which claims it may cite; citationApply validates
    // the tags it emits afterwards.
    const citableSet = buildCitableSet({
      citationVerifyResult: state.citationVerifyResult,
      memoryRecallResult: state.memoryRecallResult,
    });

    const prompt = buildPrompt(prompts.draft, {
      originalQuery:   state.originalQuery,
      context:         state.context,
      clarifyResult:   state.clarifyResult   || {},
      arbiterResult:   state.arbiterResult   || {},
      responseContract: executionContract,
      factCheckResult: factCheckPromptResult,
      externalFactCheckResult: state.externalFactCheckResult || {},
      factCheckPipelineResult: state.factCheckPipelineResult || {},
      impactResult:    state.impactResult    || {},
      citableClaims:   renderCitableClaims(citableSet),
    });
    return {
      ...state,
      draftPrompt: prompt,
      draftExecutionContract: executionContract,
      citableSet,
      currentPhase: 'draft',
    };
  },

  async llmCall(state, llmClient) {
    // Don't set maxTokens - let Groq use full context window for comprehensive responses
    return llmClient.call(state.draftPrompt, { node: 'draft' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    // Strip a surrounding ```/```lang code fence BEFORE parsing so fenced JSON
    // parses normally and fenced prose can still be recovered below. (safeParseJson
    // only repairs unbalanced JSON, so balanced fenced JSON would otherwise be lost.)
    let parseSource = typeof content === 'string' ? content.trim() : content;
    if (typeof parseSource === 'string' && parseSource.startsWith('```')) {
      parseSource = parseSource.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    const result = safeParseJson(parseSource);
    let response = result.response || '';

    // Robustness: some models ignore the "return JSON" instruction and emit
    // the answer as raw markdown/prose. When JSON parsing yields no usable
    // response but the (de-fenced) content is clearly not a JSON object/array,
    // fall back to treating it as the response. Without this, a non-compliant
    // model silently drops the entire answer — and any <citation> tags with it.
    if (!response && typeof parseSource === 'string') {
      const trimmed = parseSource.trim();
      if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        response = trimmed;
      }
    }
    const confidence = Number(result.confidence ?? 0.5);
    const executionContract = state.draftExecutionContract || buildExecutionContract(state);

    response = normalizeDraftResponse(response);

    // Convert plain text response to markdown format if needed
    response = convertToMarkdown(response);
    result.response = response;
    result.execution_contract = executionContract;

    const preservedDraft = firstNonEmptyString(
      response,
      state.lastNonEmptyDraft,
      state.currentDraft,
      state.draftResult?.response,
      state.draftResult?.draft_response,
      state.finalResponse
    );

    const preservedConfidence = response
      ? confidence
      : Number(
        state.lastNonEmptyDraftConfidence
        ?? state.draftResult?.overall_confidence
        ?? state.draftResult?.confidence
        ?? state.finalConfidence
        ?? confidence
      );

    const node = {
      id: `node_draft_${state.iteration || 0}`,
      type: 'draft',
      goal: 'Generate response draft based on unified strategy',
      content: result, // Keep original result with response field
      raw_output: content,
      status: 'completed',
      confidence,
      tokens,
      timestamp: new Date().toISOString(),
    };

    // Accumulate tokens in state
    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    return recordNode(
      {
        ...state,
        draftResult: result,
        currentDraft: preservedDraft,
        lastNonEmptyDraft: preservedDraft,
        lastNonEmptyDraftConfidence: preservedConfidence,
        total_tokens_used: newTokens,
      },
      node, 'draft'
    );
  },
};

module.exports = draftNode;

