'use strict';

/**
 * Citation Quality Metrics (Citation_Application.md §13).
 *
 * ALCE-style citation recall + precision, computed over per-sentence
 * judgments produced by the citationQuality LLM pass:
 *
 *   - Citation RECALL    — of the claim-bearing sentences, how many are
 *                          actually backed by a supporting citation?
 *   - Citation PRECISION — of the citation instances in the prose, how many
 *                          genuinely support the sentence they're attached to?
 *                          (Catches a valid handle wrapped around the wrong
 *                          span — something citationApply cannot detect, since
 *                          it only checks the handle exists in the citable set.)
 *
 * The math here is PURE and deterministic; only the per-sentence judgment
 * (which sentence asserts a claim, whether its citation supports it) is the
 * non-deterministic LLM step. Splitting it this way keeps the metric
 * computation unit-testable and conformance-friendly.
 *
 * Denominators can be zero (no claim-bearing sentences, no citations). In
 * those cases the corresponding score is `null` (not 0 and not 1) so a
 * response with nothing to cite doesn't distort aggregate accuracy numbers.
 */

/**
 * @typedef {Object} SentenceJudgment
 * @property {string}  [text]              the sentence
 * @property {boolean} claim_bearing       does it assert a checkable factual claim?
 * @property {boolean} has_citation        is a <citation> attached to it?
 * @property {boolean} citation_supports   do the attached citation(s) actually support it?
 * @property {number[]} [cited_seqs]       display seqs cited on this sentence
 */

function round(n) {
  return n == null ? null : Number(n.toFixed(3));
}

/**
 * @param {SentenceJudgment[]} judgments
 * @returns {Object} quality summary
 */
function computeCitationQuality(judgments) {
  const sentences = Array.isArray(judgments) ? judgments : [];

  let claimBearing = 0;
  let claimBearingSupported = 0; // claim-bearing AND backed by a supporting citation
  let citedSentences = 0;        // sentences carrying at least one citation
  let citedSupported = 0;        // cited sentences whose citation actually supports them
  let uncitedClaims = 0;         // claim-bearing sentences with NO citation (recall gaps)
  let misattributed = 0;         // cited sentences whose citation does NOT support them (precision gaps)

  for (const s of sentences) {
    const isClaim = !!s.claim_bearing;
    const hasCite = !!s.has_citation;
    const supports = !!s.citation_supports;

    if (isClaim) {
      claimBearing++;
      if (hasCite && supports) claimBearingSupported++;
      if (!hasCite) uncitedClaims++;
    }
    if (hasCite) {
      citedSentences++;
      if (supports) citedSupported++;
      else misattributed++;
    }
  }

  const citation_recall = claimBearing > 0 ? claimBearingSupported / claimBearing : null;
  const citation_precision = citedSentences > 0 ? citedSupported / citedSentences : null;
  const f1 = (citation_recall != null && citation_precision != null && (citation_recall + citation_precision) > 0)
    ? (2 * citation_recall * citation_precision) / (citation_recall + citation_precision)
    : null;

  return {
    citation_recall: round(citation_recall),
    citation_precision: round(citation_precision),
    citation_f1: round(f1),
    counts: {
      sentences: sentences.length,
      claim_bearing: claimBearing,
      claim_bearing_supported: claimBearingSupported,
      cited_sentences: citedSentences,
      cited_supported: citedSupported,
      uncited_claims: uncitedClaims,
      misattributed_citations: misattributed,
    },
  };
}

module.exports = { computeCitationQuality };
