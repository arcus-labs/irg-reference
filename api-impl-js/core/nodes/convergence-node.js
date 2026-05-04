/**
 * Convergence Node
 *
 * Pure logic node (no LLM call) that decides whether to accept, iterate, or fail.
 * Evaluates confidence and harm levels to determine if response is ready.
 *
 * Prepare: Updates phase
 * LLM Call: None (null)
 * Process: Evaluates convergence criteria and makes routing decision
 */

'use strict';

const { recordNode, parseYamlFrontmatter } = require('./node-utils');

function normalizeAssessorDecision(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (['exit', 'release', 'accept', 'approved'].includes(normalized)) {
    return 'exit';
  }

  if (['iterate', 'refuse', 'revise', 'retry', 'reject'].includes(normalized)) {
    return 'iterate';
  }

  return normalized;
}

const convergenceNode = {
  id: 'convergence',
  type: 'convergence',

  prepare(state) {
    return { ...state, currentPhase: 'convergence' };
  },

  llmCall: null,

  process(state) {
    const iteration          = state.iteration || 0;
    const maxIterations      = state.config?.maxIterations      ?? 5;
    const confidenceThreshold = state.config?.confidenceThreshold ?? 0.8;

    // Convergence node's confidence is always the meta-evaluation's confidence
    // This is a pass-through - the convergence node doesn't generate its own confidence
    const confidence = state.draftEvaluation?.confidence ?? 0.5;
    let harmLevel = 'none';

    // Check if we've hit the iteration limit
    const atMaxIterations = iteration >= maxIterations;

    // Decision logic: Meta-evaluation + Assessor gate
    let decision;
    let reason;
    let assessorOverride = false;
    let assessorDetails = null;

    if (state.draftEvaluation?.recommendation) {
      // Start with meta-evaluation recommendation
      const metaRec = state.draftEvaluation.recommendation.toLowerCase();

      // If we've hit max iterations, force accept regardless of recommendation
      if (atMaxIterations) {
        decision = 'accept';
        reason = `Maximum iterations (${maxIterations}) reached. Accepting current response despite ${metaRec === 'iterate' ? 'iteration request' : 'recommendation: ' + metaRec}`;
      } else if (metaRec === 'exit') {
        decision = 'accept';
        reason = `Meta-evaluation recommends exit (response is good enough)`;
      } else if (metaRec === 'iterate') {
        decision = 'iterate';
        reason = `Meta-evaluation recommends iteration: ${state.draftEvaluation.iterationLearnings || 'needs improvement'}`;
      } else {
        decision = metaRec === 'fail' ? 'fail' : 'accept';
        reason = `Meta-evaluation recommendation: ${metaRec}`;
      }
      harmLevel = state.impactResult?.harm_assessment?.level || 'none';

      // Assessor gate: Can override if governance integrity is compromised
      // But respects iteration limit - won't request iteration if at max
      if (state.judgmentArtifact && state.config?.enableAssessor !== false && !atMaxIterations) {
        const artifact = state.judgmentArtifact;
        const overallScore = artifact.overall_eie_score ?? 0.5;
        const dimensions = artifact.eie_dimensions || {};

        // Store assessor details for transparency
        assessorDetails = {
          overall_eie_score: overallScore,
          eie_dimensions: dimensions,
          verification_confidence: artifact.verification_confidence,
          risk_flags: artifact.risk_flags || [],
        };

        // Check if any dimension falls below critical floor (0.50)
        const criticalFloor = 0.50;
        const failedDimensions = Object.entries(dimensions)
          .filter(([_, score]) => score < criticalFloor)
          .map(([dim, score]) => `${dim}: ${score.toFixed(2)}`);

        // Gate thresholds
        const releaseThreshold = 0.70;
        const assessorDecision = normalizeAssessorDecision(
          artifact.assessor_decision || artifact.release_decision
        );

        // Assessor can override any decision if governance integrity is critically compromised
        if (assessorDecision === 'iterate') {
          // Assessor explicitly recommends iteration
          assessorOverride = true;
          decision = 'iterate';
          reason = `Iteration required because either Meta Evaluation or Assessor requested it (Assessor: ${assessorDecision})`;
        } else if (failedDimensions.length > 0) {
          // Critical dimensions failed
          assessorOverride = true;
          decision = 'fail';
          reason = `ASSESSOR OVERRIDE: Governance integrity check failed. ${artifact.reasoning || 'Critical governance issues detected'}. Failed dimensions: ${failedDimensions.join(', ')}`;
        } else if (overallScore < releaseThreshold && decision === 'accept') {
          // Assessor can override 'accept' if EIE score is too low
          assessorOverride = true;
          decision = 'iterate';
          reason = `ASSESSOR OVERRIDE: EIE score (${overallScore.toFixed(2)}) below threshold (${releaseThreshold}). ${artifact.remediation_guidance || 'Governance integrity requires iteration'}`;
        }
      } else if (atMaxIterations && state.judgmentArtifact && state.config?.enableAssessor !== false) {
        // At max iterations: still show assessor details but don't allow iteration override
        const artifact = state.judgmentArtifact;
        const overallScore = artifact.overall_eie_score ?? 0.5;
        const dimensions = artifact.eie_dimensions || {};

        assessorDetails = {
          overall_eie_score: overallScore,
          eie_dimensions: dimensions,
          verification_confidence: artifact.verification_confidence,
          risk_flags: artifact.risk_flags || [],
        };

        // Check if any dimension falls below critical floor (0.50)
        const criticalFloor = 0.50;
        const failedDimensions = Object.entries(dimensions)
          .filter(([_, score]) => score < criticalFloor)
          .map(([dim, score]) => `${dim}: ${score.toFixed(2)}`);

        // At max iterations, only fail if critical dimensions failed
        if (failedDimensions.length > 0) {
          decision = 'fail';
          reason = `ASSESSOR OVERRIDE: Governance integrity check failed (max iterations reached). ${artifact.reasoning || 'Critical governance issues detected'}. Failed dimensions: ${failedDimensions.join(', ')}`;
        }
      }
    } else {
      // Fallback: if meta-evaluation is not available, use basic logic
      // (This should rarely happen in normal operation)
      harmLevel = state.impactResult?.harm_assessment?.level || 'none';
      const harmHigh = harmLevel === 'high';
      const harmOk = harmLevel === 'none' || harmLevel === 'low';
      const confOk = confidence >= confidenceThreshold;
      const atMaxIter = iteration >= maxIterations - 1;

      if (atMaxIter) {
        decision = harmHigh ? 'fail' : 'accept_with_caveats';
        reason = `Max iterations (${maxIterations}) reached`;
      } else if (confOk && harmOk) {
        decision = 'accept';
        reason = `conf=${confidence.toFixed(2)} ≥ ${confidenceThreshold}, harm=${harmLevel}`;
      } else if (harmHigh && iteration > 1) {
        decision = 'fail';
        reason = 'Persistent high harm after multiple revisions';
      } else {
        decision = 'iterate';
        reason = `conf=${confidence.toFixed(2)} < ${confidenceThreshold} or harm=${harmLevel}`;
      }
    }

    const nodeContent = {
      decision,
      reason,
      confidence,
      harmLevel,
    };

    // Include assessor details if available
    if (assessorDetails) {
      nodeContent.assessor_gate = {
        overall_eie_score: assessorDetails.overall_eie_score,
        eie_dimensions: assessorDetails.eie_dimensions,
        verification_confidence: assessorDetails.verification_confidence,
        risk_flags: assessorDetails.risk_flags,
        override_applied: assessorOverride,
      };
    }

    const node = {
      id: `node_convergence_${iteration}`,
      type: 'convergence',
      goal: 'Decide whether to accept, iterate, or fail',
      content: nodeContent,
      status: 'completed',
      confidence,
      timestamp: new Date().toISOString(),
    };

    const converged = decision !== 'iterate';
    return recordNode(
      {
        ...state,
        convergenceDecision: decision,
        convergenceReason: reason,
        _converged: converged,
        // For new interpreter: set decision for routing
        _nodeDecision: decision,
        // Increment iteration if looping back
        iteration: decision === 'iterate' ? (state.iteration || 0) + 1 : (state.iteration || 0),
      },
      node, 'convergence'
    );
  },
};

module.exports = convergenceNode;

