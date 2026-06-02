'use strict';

/**
 * Citation Tag Format
 *
 * Parse / sanitize / serialize / strip the inline `<citation>` tag
 * (Citation_Application.md §3). PURE — no I/O, no state. This is the
 * conformance core: every polyglot port must implement the same tag
 * grammar and the same edge-case handling (§11).
 *
 * Draft phase (LLM emits):
 *   <citation ref="cit_3">antibiotics do not act on viral infections</citation>
 *   <citation ref="cit_1 cit_2">…</citation>     (multi-source)
 *
 * Resolved phase (after citationApply):
 *   <citation ref="<uuid>" seq="1">…</citation>
 *   <citation ref="<uuid1> <uuid2>" seq="1 2">…</citation>
 *
 * Rules: no nesting; one or more space-separated handles in `ref`; inner
 * content is the prose span. Malformed / unclosed / nested markup is
 * stripped, keeping the inner text.
 */

// Well-formed tag: <citation ref="...">inner</citation>. Non-greedy inner,
// case-insensitive, dot-all so spans may cross newlines.
const WELL_FORMED_RE = /<citation\s+ref="([^"]*)"\s*>([\s\S]*?)<\/citation>/gi;

// Any citation open/close markup — used to scrub leftovers (malformed,
// unclosed, or nested inner tags) after the well-formed tags are protected.
const ANY_CITATION_MARKUP_RE = /<\/?citation\b[^>]*>/gi;

/**
 * Split a `ref` attribute into individual handles.
 * @param {string} refAttr
 * @returns {string[]}
 */
function parseHandles(refAttr) {
  if (!refAttr || typeof refAttr !== 'string') return [];
  return refAttr.trim().split(/\s+/).filter(Boolean);
}

/**
 * Remove any nested citation markup from an inner span, keeping its text.
 * Nesting is not allowed (§11) — the inner markup is dropped.
 * @param {string} inner
 * @returns {string}
 */
function sanitizeInner(inner) {
  if (!inner) return '';
  return String(inner).replace(ANY_CITATION_MARKUP_RE, '');
}

/**
 * Strip ALL citation markup from a string, keeping inner text. Used for the
 * hallucination / malformed guard.
 * @param {string} text
 * @returns {string}
 */
function stripAllCitationMarkup(text) {
  if (!text) return '';
  return String(text).replace(ANY_CITATION_MARKUP_RE, '');
}

/**
 * Serialize a resolved citation tag.
 * @param {string[]} uuids  durable claim uuids (parallel to seqs)
 * @param {number[]} seqs   display integers (parallel to uuids)
 * @param {string}   inner  prose span (already sanitized)
 * @returns {string}
 */
function serializeResolvedTag(uuids, seqs, inner) {
  return `<citation ref="${uuids.join(' ')}" seq="${seqs.join(' ')}">${inner}</citation>`;
}

module.exports = {
  WELL_FORMED_RE,
  ANY_CITATION_MARKUP_RE,
  parseHandles,
  sanitizeInner,
  stripAllCitationMarkup,
  serializeResolvedTag,
};
