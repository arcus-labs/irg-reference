'use strict';

const { recordNode } = require('./node-utils');

function collectClaimsNeedingSourceGeneration(externalFactCheckResult) {
  const claims = Array.isArray(externalFactCheckResult?.claims)
    ? externalFactCheckResult.claims
    : [];

  return claims.filter((claim) => (
    claim?.verification_status === 'cache_miss_retrieval_deferred'
    || claim?.verification_status === 'expired_cache_entry_retrieval_deferred'
    || claim?.verification_status === 'expired_provisional_sources_available'
  ));
}

const factCheckPipelineGateNode = {
  id: 'factCheckPipelineGate',
  type: 'fact_check_pipeline_gate',

  prepare(state) {
    return { ...state, currentPhase: 'factCheckPipelineGate' };
  },

  llmCall: null,

  process(state) {
    const pendingClaims = collectClaimsNeedingSourceGeneration(state.externalFactCheckResult);
    const enabled = state.config?.enableFactCheckPipeline === true;
    const decision = enabled && pendingClaims.length > 0 ? 'run' : 'skip';
    const reason = !enabled
      ? 'disabled_in_config'
      : pendingClaims.length > 0
        ? 'pending_claims_require_source_generation'
        : 'no_pending_claims';

    const node = {
      id: `node_fact_check_pipeline_gate_${state.iteration || 0}`,
      type: 'fact_check_pipeline_gate',
      goal: 'Decide whether to run the optional fact-check pipeline',
      content: {
        enabled,
        decision,
        reason,
        pending_claim_count: pendingClaims.length,
        pending_claims: pendingClaims.map((claim) => ({
          claim_key: claim.claim_key,
          claim_text: claim.claim_text,
          verification_status: claim.verification_status,
        })),
      },
      status: 'completed',
      confidence: 1,
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        factCheckPipelineGateResult: node.content,
        _nodeDecision: decision,
      },
      node,
      'factCheckPipelineGate'
    );
  },
};

module.exports = factCheckPipelineGateNode;