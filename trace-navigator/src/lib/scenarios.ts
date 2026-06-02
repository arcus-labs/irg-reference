/**
 * Scenario registry.
 *
 * Declarative source of truth for every IRG scenario surfaced in the
 * trace-navigator. Adding a new scenario means appending one entry here —
 * the vertical index pages render from this list, so /fintech, /medical,
 * etc. stay in sync automatically.
 *
 * `status: 'live'` scenarios link to a working scenario page.
 * `status: 'planned'` scenarios link to a coming-soon placeholder so the
 *   list still tells the story of what's coming without false promises.
 */

export type Vertical = 'fintech' | 'medical';

export type ScenarioStatus = 'live' | 'planned';

export interface Scenario {
  /** url-safe slug, second segment of the path (e.g. /fintech/<slug>) */
  slug: string;
  /** which vertical this belongs to */
  vertical: Vertical;
  /** short display title (used as card heading + page heading) */
  title: string;
  /** one-line subtitle (regulatory anchor, e.g. "12 CFR Part 1005") */
  subtitle: string;
  /** 1–2 sentence plain-English description for the index card */
  description: string;
  /** regulations / standards this scenario reasons over, for badges */
  regulations: string[];
  /** live = working demo, planned = placeholder page */
  status: ScenarioStatus;
}

export const SCENARIOS: Scenario[] = [
  // --- Fintech ----------------------------------------------------------
  {
    slug: 'adjudication',
    vertical: 'fintech',
    title: 'Reg E Adjudication',
    subtitle: '12 CFR Part 1005 — consumer EFT error resolution',
    description:
      'Adjudicate a Regulation E dispute end-to-end from a consumer evidence packet. Classifies the dispute under §1005.11(a)(i)–(vii), applies §1005.6 liability tiers only when warranted, and produces both a decision artifact and a §1005.11(d)/(e) consumer notice letter.',
    regulations: ['§1005.2(m)', '§1005.6', '§1005.10', '§1005.11', '§1005.17', '§1005.33/.34'],
    status: 'live',
  },

  // --- Medical (placeholder vertical, populated later) ------------------
  // Entries will follow the same shape.
];

export const VERTICALS: Record<Vertical, { title: string; subtitle: string; description: string }> = {
  fintech: {
    title: 'Fintech',
    subtitle: 'Consumer finance · regulatory adjudication',
    description:
      'IRG scenarios for consumer-finance institutions. This reference implementation ships the Regulation E electronic-fund-transfer error-resolution adjudication end to end: a deterministic, citation-grounded reasoning trace plus a structured decision artifact and a §1005.11 consumer notice.',
  },
  medical: {
    title: 'Medical',
    subtitle: 'Clinical reasoning · payor authorization · documentation',
    description:
      'IRG scenarios for clinical and revenue-cycle workflows. Coming soon.',
  },
};

export function scenariosForVertical(vertical: Vertical): Scenario[] {
  return SCENARIOS.filter((s) => s.vertical === vertical);
}

export function hrefFor(scenario: Scenario): string {
  return `/${scenario.vertical}/${scenario.slug}`;
}
