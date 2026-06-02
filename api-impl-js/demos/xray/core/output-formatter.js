/**
 * X-Ray IRG Output Formatter
 *
 * Converts the final IRG state into the required decision-support output format.
 *
 * Sections:
 *  1. Purpose & Limitations
 *  2. Assumptions
 *  3. Image Quality & Data Gaps
 *  4. Ranked Differential
 *  5. Uncertainty & Alternatives
 *  6. Recommended Next Steps
 */

'use strict';

/**
 * Format the final IRG state into a decision-support report.
 * @param {Object} state - Final state after graph execution
 * @returns {Object} Structured decision-support output
 */
function formatOutput(state) {
  const triage = state.triageResult || {};
  const ctx    = state.clinicalContextResult || {};
  const obs    = state.imageObservationResult || {};
  const adv    = state.adversaryResult || {};

  return {
    // --- 1. Purpose & Limitations ---
    purpose_and_limitations: {
      statement: 'This is an assistive reasoning trace, not a definitive medical diagnosis. '
        + 'All findings and hypotheses require verification by a qualified radiologist. '
        + 'This system is intended for decision-support only.',
      irg_version: 'xray-irg v0.1.0',
      termination_state: state.terminationState || 'unknown',
      iterations: state.iteration || 0,
    },

    // --- 2. Assumptions ---
    assumptions: {
      from_clinical_context: ctx.assumptions || [],
      accumulated: [
        ...(ctx.assumptions || []),
        ...(ctx.missing_info || []).map(m => `Missing: ${m}`),
      ],
    },

    // --- 3. Image Quality & Data Gaps ---
    image_quality_and_gaps: {
      image_quality: obs.image_quality || 'unknown',
      quality_reasons: obs.image_quality_reasons || [],
      missing_info: ctx.missing_info || [],
      missing_evidence: state.missingEvidence || [],
      image_quality_gate: state.imageQualityDecision || 'not_evaluated',
    },

    // --- 4. Ranked Differential ---
    ranked_differential: (triage.ranked_differential || []).map((d, i) => ({
      rank: i + 1,
      diagnosis: d.label,
      confidence: d.confidence,
      key_supporting_evidence: d.key_supporting || [],
      key_contradicting_evidence: d.key_contradicting || [],
      reasoning: d.reasoning || '',
    })),

    // --- 5. Uncertainty & Alternatives ---
    uncertainty_and_alternatives: {
      termination_state: state.terminationState || 'unknown',
      explanation: state.terminationExplanation || '',
      unresolved: [
        ...(adv.overlooked_hypotheses || []),
        ...(state.discriminatingFeatures || []).map(f => `Discriminating feature: ${f}`),
      ],
      red_flags: adv.red_flags || [],
      escalation_flags: state.escalationFlags || [],
    },

    // --- 6. Recommended Next Steps ---
    recommended_next_steps: triage.recommended_next_steps || [],
    urgency: triage.urgency || 'routine',
    clinical_correlation: triage.clinical_correlation || '',
  };
}

/**
 * Format the output as a human-readable markdown string.
 */
function formatOutputMarkdown(state) {
  const out = formatOutput(state);
  const lines = [];

  lines.push('# X-Ray Decision-Support Report');
  lines.push('');
  lines.push('## Purpose & Limitations');
  lines.push(out.purpose_and_limitations.statement);
  lines.push(`- Termination state: **${out.purpose_and_limitations.termination_state}**`);
  lines.push(`- Iterations: ${out.purpose_and_limitations.iterations}`);
  lines.push('');

  lines.push('## Assumptions');
  for (const a of out.assumptions.accumulated) lines.push(`- ${a}`);
  lines.push('');

  lines.push('## Image Quality & Data Gaps');
  lines.push(`- Quality: **${out.image_quality_and_gaps.image_quality}**`);
  for (const r of out.image_quality_and_gaps.quality_reasons) lines.push(`  - ${r}`);
  if (out.image_quality_and_gaps.missing_evidence.length > 0) {
    lines.push('- Missing evidence:');
    for (const m of out.image_quality_and_gaps.missing_evidence) lines.push(`  - ${m}`);
  }
  lines.push('');

  lines.push('## Ranked Differential');
  for (const d of out.ranked_differential) {
    lines.push(`### ${d.rank}. ${d.diagnosis} (confidence: ${(d.confidence * 100).toFixed(0)}%)`);
    if (d.key_supporting_evidence.length) lines.push(`- Supporting: ${d.key_supporting_evidence.join('; ')}`);
    if (d.key_contradicting_evidence.length) lines.push(`- Contradicting: ${d.key_contradicting_evidence.join('; ')}`);
    if (d.reasoning) lines.push(`- ${d.reasoning}`);
  }
  lines.push('');

  lines.push('## Uncertainty & Alternatives');
  lines.push(`- State: **${out.uncertainty_and_alternatives.termination_state}**`);
  if (out.uncertainty_and_alternatives.explanation) lines.push(`- ${out.uncertainty_and_alternatives.explanation}`);
  for (const u of out.uncertainty_and_alternatives.unresolved) lines.push(`- Unresolved: ${u}`);
  for (const r of out.uncertainty_and_alternatives.red_flags) lines.push(`- ⚠️ Red flag: ${r}`);
  for (const e of out.uncertainty_and_alternatives.escalation_flags) lines.push(`- 🔺 ${e}`);
  lines.push('');

  lines.push('## Recommended Next Steps');
  for (const s of out.recommended_next_steps) lines.push(`- ${s}`);
  lines.push(`- Urgency: **${out.urgency}**`);
  if (out.clinical_correlation) lines.push(`- ${out.clinical_correlation}`);

  return lines.join('\n');
}

module.exports = { formatOutput, formatOutputMarkdown };

