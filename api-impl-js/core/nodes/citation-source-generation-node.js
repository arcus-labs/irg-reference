'use strict';

const { buildPrompt, safeParseJson, extractTokens, recordNode } = require('./node-utils');

function claimsNeedingSourceGeneration(externalFactCheckResult) {
  const claims = Array.isArray(externalFactCheckResult?.claims)
    ? externalFactCheckResult.claims
    : [];

  return claims.filter((claim) => (
    claim?.verification_status === 'cache_miss_retrieval_deferred'
    || claim?.verification_status === 'expired_cache_entry_retrieval_deferred'
    || claim?.verification_status === 'expired_provisional_sources_available'
  ));
}

function normalizeCandidateSource(source) {
  if (typeof source === 'string') {
    return {
      url: source.trim(),
      title: source.trim(),
      why: '',
      source_type: 'unknown',
    };
  }

  return {
    url: String(source?.url || '').trim(),
    title: String(source?.title || source?.name || '').trim(),
    why: String(source?.why || source?.reason || '').trim(),
    source_type: String(source?.source_type || source?.type || 'unknown').trim() || 'unknown',
  };
}

function normalizeClaimPlan(inputClaim, rawPlan, index) {
  const fallbackQueries = [inputClaim.claim_text].filter(Boolean);
  const candidateSources = (Array.isArray(rawPlan?.candidate_sources) ? rawPlan.candidate_sources : [])
    .map(normalizeCandidateSource)
    .filter((source) => source.url || source.title)
    .slice(0, 3);

  return {
    claim_key: rawPlan?.claim_key || inputClaim.claim_key,
    claim_text: inputClaim.claim_text,
    internal_assessment: inputClaim.internal_assessment,
    internal_reasoning: inputClaim.internal_reasoning,
    structured_claim: inputClaim.structured_claim,
    source_generation_rank: index,
    research_direction: String(rawPlan?.research_direction || '').trim(),
    search_queries: (Array.isArray(rawPlan?.search_queries) ? rawPlan.search_queries : fallbackQueries)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 4),
    candidate_sources: candidateSources,
    confidence_prior: Number(rawPlan?.confidence_prior ?? 0.35),
    verification_status: candidateSources.length > 0
      ? 'candidate_sources_generated_unverified'
      : 'candidate_source_generation_failed',
  };
}

const citationSourceGenerationNode = {
  id: 'citationSourceGeneration',
  type: 'citation_source_generation',

  prepare(state, prompts) {
    const claims = claimsNeedingSourceGeneration(state.externalFactCheckResult);
    const prompt = buildPrompt(prompts.citationSourceGeneration, {
      originalQuery: state.originalQuery,
      context: state.context,
      citationSourceGenerationInput: JSON.stringify(claims, null, 2),
    });

    return {
      ...state,
      citationSourceGenerationPrompt: prompt,
      citationSourceGenerationInput: { claims },
      currentPhase: 'citationSourceGeneration',
    };
  },

  async llmCall(state, llmClient) {
    const claims = state.citationSourceGenerationInput?.claims || [];
    if (!claims.length) {
      return {
        claims: [],
        summary: 'No unresolved claims required source generation.',
        confidence: 1,
      };
    }

    return llmClient.call(state.citationSourceGenerationPrompt, { node: 'citationSourceGeneration' });
  },

  process(state, llmResponse) {
    const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
    const tokens = extractTokens(llmResponse);
    const result = typeof content === 'string' ? safeParseJson(content) : (llmResponse || {});
    const inputClaims = state.citationSourceGenerationInput?.claims || [];
    const rawPlans = Array.isArray(result?.claims) ? result.claims : [];

    const normalizedPlans = inputClaims.map((claim, index) => {
      const rawPlan = rawPlans.find((plan) => plan?.claim_key === claim.claim_key) || rawPlans[index] || {};
      return normalizeClaimPlan(claim, rawPlan, index);
    });

    const normalizedResult = {
      generated_at: new Date().toISOString(),
      retrieval_mode: 'llm_generated_source_candidates',
      retrieval_deferred: true,
      claims: normalizedPlans,
      summary: result?.summary || `Generated candidate source plans for ${normalizedPlans.length} claims.`,
      confidence: Number(result?.confidence ?? 0.5),
    };

    const node = {
      id: `node_citation_source_generation_${state.iteration || 0}`,
      type: 'citation_source_generation',
      goal: 'Generate candidate sources for unresolved fact-check claims',
      content: normalizedResult,
      raw_output: typeof content === 'string' ? content : JSON.stringify(normalizedResult),
      status: 'completed',
      confidence: normalizedResult.confidence,
      tokens,
      timestamp: new Date().toISOString(),
    };

    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    return recordNode(
      {
        ...state,
        citationSourceGenerationResult: normalizedResult,
        total_tokens_used: newTokens,
      },
      node,
      'citationSourceGeneration'
    );
  },
};

module.exports = citationSourceGenerationNode;