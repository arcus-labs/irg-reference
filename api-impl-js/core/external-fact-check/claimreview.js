'use strict';

/**
 * ClaimReview Projection
 *
 * Projects native IRG citation records into schema.org `ClaimReview`
 * JSON-LD — the W3C-adopted standard consumed by Google Fact Check
 * Tools and the broader fact-checking ecosystem.
 *
 * This is the LOSSY, interoperable "lite" view. The native citation
 * record (see _docs/Citation_Application.md §4) is the full-capability
 * format. The projection is one-way: native → ClaimReview. We never
 * treat ClaimReview as the source of truth.
 *
 * Everything here is PURE (no I/O) so it's part of the cross-language
 * conformance corpus — every polyglot port must emit byte-comparable
 * ClaimReview for the same input.
 *
 * Contract reference: _docs/Citation_Application.md §12.
 */

const REVIEW_RATING = {
  supported:    { ratingValue: 5, alternateName: 'True' },
  refuted:      { ratingValue: 1, alternateName: 'False' },
  inconclusive: { ratingValue: 3, alternateName: 'Unproven' },
};

const DEFAULT_AUTHOR = { '@type': 'Organization', name: 'Arcus Labs — IRG' };

/**
 * Map an IRG verdict to a schema.org Rating (1–5 scale).
 * Unknown verdicts fall back to Unproven.
 */
function verdictToRating(verdict) {
  const r = REVIEW_RATING[verdict] || REVIEW_RATING.inconclusive;
  return {
    '@type': 'Rating',
    ratingValue: r.ratingValue,
    bestRating: 5,
    worstRating: 1,
    alternateName: r.alternateName,
  };
}

/**
 * Project a single native citation record into a ClaimReview object.
 *
 * @param {Object} citation  native citation JSON (as stored on disk)
 * @param {Object} [opts]
 * @param {Object} [opts.author]  override the author Organization
 * @returns {Object} a schema.org ClaimReview (no @context — caller wraps)
 */
function toClaimReview(citation, opts = {}) {
  const claimText = citation?.claim?.raw_text
    || citation?.claim_text
    || '';

  const sources = Array.isArray(citation?.sources) ? citation.sources : [];
  const appearance = sources
    .map((s) => s?.url)
    .filter((u) => typeof u === 'string' && u.length > 0)
    .map((url) => ({ '@type': 'CreativeWork', url }));

  const datePublished = citation?.verified_at
    || citation?.created_at
    || undefined;

  const claimReview = {
    '@type': 'ClaimReview',
    claimReviewed: claimText,
    reviewRating: verdictToRating(citation?.verdict),
    author: opts.author || DEFAULT_AUTHOR,
    itemReviewed: {
      '@type': 'Claim',
      ...(appearance.length ? { appearance } : {}),
    },
  };

  if (datePublished) claimReview.datePublished = String(datePublished).slice(0, 10);
  if (citation?.citation_path) claimReview.url = citation.citation_path;

  return claimReview;
}

/**
 * Project a collection of citations into a single JSON-LD document
 * with an @graph of ClaimReview entities.
 *
 * @param {Object[]} citations
 * @param {Object}   [opts]
 * @param {boolean}  [opts.includeProvisional=false]  include provisional citations
 * @param {Object}   [opts.author]
 * @returns {Object} JSON-LD document
 */
function toClaimReviewCollection(citations, opts = {}) {
  const list = Array.isArray(citations) ? citations : [];
  const includeProvisional = !!opts.includeProvisional;

  const graph = list
    .filter((c) => includeProvisional || c?.verification_level === 'verified')
    .map((c) => toClaimReview(c, opts));

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

module.exports = {
  verdictToRating,
  toClaimReview,
  toClaimReviewCollection,
  REVIEW_RATING,
};
