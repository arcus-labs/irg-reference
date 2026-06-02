'use strict';

/**
 * Citation Apply Node
 *
 * Thin graph wrapper around the pure `core/citations/apply.js` module
 * (Citation_Application.md §8). Runs immediately after `draft`.
 *
 * Takes the draft prose (which may contain provisional `<citation
 * ref="cit_N">` tags emitted by the model) and the citable set built by
 * the draft node, then deterministically:
 *   - drops hallucinated / malformed refs (keeping inner text)
 *   - resolves surviving handles → durable claim uuid
 *   - renumbers used citations densely (seq 1..K)
 *   - rewrites tags with ref+seq
 *   - builds references[]
 *
 * Updates the response in place and attaches `state.citationApplyResult`
 * (+ `state.references`) for downstream nodes and the trace navigator.
 *
 * Inert when there is no citable set: any stray tags are stripped and the
 * prose is otherwise unchanged.
 */

const { recordNode } = require('./node-utils');
const { applyCitations } = require('../citations/apply');

const citationApplyNode = {
  id: 'citationApply',
  type: 'citation_apply',

  prepare(state) {
    return { ...state, currentPhase: 'citationApply' };
  },

  process(state) {
    const citableSet = Array.isArray(state.citableSet) ? state.citableSet : [];
    const draftResult = state.draftResult || {};
    // Prefer the fresh draft response; fall back to the preserved current
    // draft only when the new response is empty (e.g. a failed LLM call on a
    // convergence re-run).
    const prose = (typeof draftResult.response === 'string' && draftResult.response.trim())
      ? draftResult.response
      : (state.currentDraft || '');

    // Idempotency guard. On a convergence iterate, draft-node may preserve a
    // PRIOR draft that citationApply already resolved (tags now carry a uuid +
    // seq="N", not a cit_N handle). Re-running applyCitations on that prose
    // would treat each uuid as an unknown handle, strip every tag, and empty
    // references[] — leaving [n] markers in the text with a blank reference
    // list. If the prose has no provisional cit_ handles but already carries
    // resolved citation markup, treat it as already-applied and preserve the
    // prior references/response instead of reprocessing.
    const hasProvisionalHandles = /<citation\s+ref="cit_/i.test(prose);
    const alreadyResolved = /<citation\s[^>]*\bseq="/i.test(prose);
    if (!hasProvisionalHandles && alreadyResolved) {
      const preserved = Array.isArray(state.references) ? state.references : [];
      const summary = {
        citable_count: citableSet.length,
        tags_found: 0,
        tags_validated: 0,
        refs_dropped: 0,
        references_built: preserved.length,
        references: preserved,
        response: prose,
        already_resolved: true,
      };
      const node = {
        id: `node_citation_apply_${state.iteration || 0}`,
        type: 'citation_apply',
        goal: 'Validate citation tags, resolve durable IDs, build the reference list',
        content: summary,
        raw_output: JSON.stringify(summary),
        status: 'completed',
        confidence: 1,
        tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        timestamp: new Date().toISOString(),
      };
      return recordNode(
        {
          ...state,
          draftResult: { ...draftResult, response: prose, references: preserved },
          currentDraft: prose,
          lastNonEmptyDraft: prose || state.lastNonEmptyDraft,
          references: preserved,
          citationApplyResult: summary,
        },
        node,
        'citationApply'
      );
    }

    const { prose: validatedProse, references, stats } = applyCitations(prose, citableSet);

    const updatedDraftResult = { ...draftResult, response: validatedProse, references };

    const summary = {
      citable_count: citableSet.length,
      tags_found: stats.tags_found,
      tags_validated: stats.tags_validated,
      refs_dropped: stats.refs_dropped,
      references_built: stats.references_built,
      references,
      // The validated, citation-resolved prose so the trace navigator can
      // render the final cited answer + References from this node alone.
      response: validatedProse,
    };

    const node = {
      id: `node_citation_apply_${state.iteration || 0}`,
      type: 'citation_apply',
      goal: 'Validate citation tags, resolve durable IDs, build the reference list',
      content: summary,
      raw_output: JSON.stringify(summary),
      status: 'completed',
      // Confidence reflects how clean the model's citation behavior was:
      // 1.0 when nothing was dropped, decaying with dropped refs.
      confidence: stats.tags_found > 0
        ? Number((stats.tags_validated / stats.tags_found).toFixed(2))
        : 1,
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      timestamp: new Date().toISOString(),
    };

    return recordNode(
      {
        ...state,
        draftResult: updatedDraftResult,
        currentDraft: validatedProse,
        lastNonEmptyDraft: validatedProse || state.lastNonEmptyDraft,
        references,
        citationApplyResult: summary,
      },
      node,
      'citationApply'
    );
  },
};

module.exports = citationApplyNode;
