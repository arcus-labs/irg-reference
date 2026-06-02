/**
 * Adjudication domain map.
 *
 * Maps a /fintech/<slug> scenario to the api-impl-js demo that backs it, plus
 * the UI copy the upload runner renders. Shared by the upload page, the
 * sample-listing API, and the run API so a single edit wires a new domain
 * end-to-end. The `demoDir` is the ONLY value the server uses to build a
 * filesystem path — it is validated against this allowlist to prevent path
 * traversal, so never construct a demo path from raw user input.
 */

export interface AdjudicationDomain {
  /** URL segment under /fintech/ (matches scenarios.ts slug) */
  slug: string;
  /** directory under api-impl-js/demos/ that holds adjudicate.js + cases/ + output/ */
  demoDir: string;
  /** prefix for the copied trace filename in the navigator traces/ dir */
  tracePrefix: string;
  /** page heading */
  title: string;
  /** one-line tagline under the heading */
  tagline: string;
  /** label used in the progress ticker ("seeding <seedLabel> …") */
  seedLabel: string;
  /** output-document name shown in completion copy */
  outputName: string;
}

export const ADJUDICATION_DOMAINS: Record<string, AdjudicationDomain> = {
  'adjudication': {
    slug: 'adjudication',
    demoDir: 'reg-e-adjudication',
    tracePrefix: 'reg-e-adj',
    title: 'Reg E Adjudication',
    tagline: 'Submit evidence · run the full IRG · produce a decision and a §1005.11 consumer notice',
    seedLabel: 'Reg E rule citations',
    outputName: 'consumer notice letter',
  },
};

/** Resolve a domain by slug, defaulting to Reg E. Returns null for unknown slugs. */
export function resolveDomain(slug: string | null | undefined): AdjudicationDomain | null {
  if (!slug) return ADJUDICATION_DOMAINS['adjudication'];
  return ADJUDICATION_DOMAINS[slug] ?? null;
}
