/**
 * Meta-Evaluation Node
 *
 * Evaluates the quality of the generated draft response and recommends next steps.
 * Grades execution quality, completeness, and clarity, then decides whether to
 * exit (response is good enough) or iterate (with learnings for improvement).
 *
 * Prepare: Renders meta-evaluation prompt with draft and supporting analysis
 * LLM Call: Calls LLM to evaluate draft quality
 * Process: Parses evaluation and records recommendation
 */

'use strict';

const { buildPrompt, safeParseJson, safeParseYaml, extractTokens, recordNode } = require('./node-utils');
const { buildFactCheckPromptResultSync } = require('../external-fact-check/claim-store');

const metaEvaluationNode = {
  id: 'metaEvaluation',
  type: 'meta_evaluation',

  prepare(state, prompts) {
    const factCheckPromptResult = buildFactCheckPromptResultSync(state.factCheckResult);
    const prompt = buildPrompt(prompts.metaEvaluation, {
      originalQuery:   state.originalQuery,
      context:         state.context,
      arbiterResult:   state.arbiterResult   || {},
      currentDraft:    state.currentDraft    || '',
      factCheckResult: factCheckPromptResult,
      externalFactCheckResult: state.externalFactCheckResult || {},
      factCheckPipelineResult: state.factCheckPipelineResult || {},
      impactResult:    state.impactResult    || {},
    });
    return { ...state, metaEvaluationPrompt: prompt, currentPhase: 'metaEvaluation' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.metaEvaluationPrompt, { node: 'metaEvaluation' });
  },

  process(state, llmResponse) {
    // Extract content and tokens from response
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);

    // Ensure content is a string
    if (typeof content !== 'string') {
      console.warn('[meta-evaluation-node] content is not a string:', typeof content);
      return { ...state };
    }

    // Strip markdown code blocks if present
    let cleanedResponse = content.trim();
    if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```[a-z]*\n?/, '');
      cleanedResponse = cleanedResponse.replace(/\n?```$/, '');
    }

    // Try YAML first (LLM often returns YAML), then fall back to JSON
    let result = safeParseYaml(cleanedResponse);
    if (!result || Object.keys(result).length === 0) {
      result = safeParseJson(cleanedResponse);
    }

    // Helper function to extract score and justification from either new format (object) or old format (number)
    const extractMetricData = (metric) => {
      // Try multiple key variations (YAML parser may lowercase and remove underscores)
      const keyVariations = [
        metric,                                    // execution_quality
        metric.toLowerCase(),                      // execution_quality (if already lowercase)
        metric.toLowerCase().replace(/_/g, ''),   // executionquality
        metric.replace(/_/g, ''),                 // executionquality
      ];

      let metricData;
      for (const key of keyVariations) {
        if (result[key]) {
          metricData = result[key];
          break;
        }
      }

      if (typeof metricData === 'object' && metricData !== null) {
        return {
          score: Number(metricData.score ?? 0.5),
          justification: metricData.justification || '',
          improvement_areas: metricData.improvement_areas || metricData.improvementareas || '',
        };
      }
      // Fallback to old format (just a number)
      return {
        score: Number(metricData ?? 0.5),
        justification: '',
        improvement_areas: '',
      };
    };

    // Extract evaluation metrics with justifications
    const executionQualityData = extractMetricData('execution_quality');
    const completenessData = extractMetricData('completeness');
    const clarityData = extractMetricData('clarity');

    const executionQuality = executionQualityData.score;
    const completeness = completenessData.score;
    const clarity = clarityData.score;
    // Handle both null and undefined for confidence
    const confidence = result.confidence !== null && result.confidence !== undefined ? Number(result.confidence) : 0.5;
    // Ensure recommendation is always a string (handle cases where it might be an object)
    let recommendation = result.recommendation || 'iterate';
    if (typeof recommendation !== 'string') {
      recommendation = String(recommendation || 'iterate');
    }
    const iterationLearnings = result.iteration_learnings || result.iterationlearnings || '';

    // Calculate overall quality score
    const overallQuality = (executionQuality + completeness + clarity) / 3;

    // Normalize the result object to use consistent key names for display
    const normalizedContent = {
      execution_quality: executionQualityData,
      completeness: completenessData,
      clarity: clarityData,
      confidence,
      recommendation,
      iteration_learnings: iterationLearnings,
    };

    const node = {
      id: `node_metaEvaluation_${state.iteration || 0}`,
      type: 'meta_evaluation',
      goal: 'Evaluate draft quality and recommend next steps',
      content: normalizedContent,
      raw_output: cleanedResponse,
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

    // Store evaluation results for convergence node to use
    const newState = {
      ...state,
      metaEvaluationResult: {
        ...result,
        confidence, // Ensure confidence is always available
      },
      draftEvaluation: {
        executionQuality,
        completeness,
        clarity,
        overallQuality,
        confidence,
        recommendation,
        iterationLearnings,
        // Include detailed justifications for iteration feedback
        executionQualityJustification: executionQualityData.justification,
        completenessJustification: completenessData.justification,
        clarityJustification: clarityData.justification,
      },
      total_tokens_used: newTokens,
    };

    return recordNode(newState, node, 'metaEvaluation');
  },
};

module.exports = metaEvaluationNode;

