/**
 * EvidenceLink Node (Localized Updates — No LLM)
 *
 * Goal: Bind new or existing evidence to specific hypotheses.
 * Inputs: Findings from ImageObservation + TargetedReanalysis.
 * Fields: supports[], weakens[], invalidates[], impact_on_confidence per hypothesis.
 * Effect: Update Hypothesis node confidence and status locally.
 */

'use strict';

const { buildPrompt, safeParseJson, recordNode } = require('./node-utils');

const evidenceLinkNode = {
  id: 'evidenceLink',
  type: 'evidence_link',

  prepare(state, prompts) {
    const prompt = buildPrompt(prompts.evidenceLink, {
      hypotheses: state.hypotheses || [],
      findings: state.imageObservationResult?.findings || [],
      targetedFindings: state.targetedFindings || [],
      adversaryResult: state.adversaryResult || {},
    });
    return { ...state, evidenceLinkPrompt: prompt, currentPhase: 'evidenceLink' };
  },

  async llmCall(state, llmClient) {
    return llmClient.call(state.evidenceLinkPrompt, { node: 'evidenceLink' });
  },

  process(state, llmResponse) {
    const result = safeParseJson(llmResponse);
    const links = result.evidence_links || [];

    // Apply evidence links to hypotheses
    const updated = [...(state.hypotheses || [])];
    for (const link of links) {
      const idx = updated.findIndex(
        h => h.label.toLowerCase() === (link.hypothesis || '').toLowerCase()
      );
      if (idx < 0) continue;

      const h = { ...updated[idx] };
      if (link.supports) {
        h.supporting_findings = [...new Set([...h.supporting_findings, ...link.supports])];
      }
      if (link.weakens) {
        h.conflicting_findings = [...new Set([...h.conflicting_findings, ...link.weakens])];
      }
      if (link.invalidates && link.invalidates.length > 0) {
        h.status = 'ruled_out';
        h.confidence = 0;
      } else if (typeof link.new_confidence === 'number') {
        h.confidence = Math.max(0, Math.min(1, link.new_confidence));
        if (h.confidence < 0.15) h.status = 'weakened';
      }
      updated[idx] = h;
    }

    const node = {
      id: `node_evidence_link_${state.iteration || 0}`,
      type: 'evidence_link',
      goal: 'Bind evidence to hypotheses and update confidence',
      content: { evidence_links: links, hypotheses_updated: updated.length },
      raw_output: llmResponse,
      status: 'completed',
      confidence: Math.max(...updated.map(h => h.confidence), 0),
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      { ...state, hypotheses: updated, evidenceLinkResult: result },
      node, 'evidenceLink'
    );
  },
};

module.exports = evidenceLinkNode;

