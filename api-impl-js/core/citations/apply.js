'use strict';

/**
 * citationApply — deterministic validation pass (Citation_Application.md §6 step 3).
 *
 * Given the LLM draft prose (with provisional `<citation ref="cit_N">` tags)
 * and the citable set, this:
 *   1. parses each well-formed tag
 *   2. drops any handle not in the citable set (hallucination guard)
 *   3. resolves surviving handles → claim uuid
 *   4. renumbers used citations densely by first appearance (seq 1..K)
 *   5. rewrites tags with `ref`(uuid) + `seq`(int)
 *   6. strips malformed / unclosed / nested markup, keeping inner text
 *   7. builds `references[]` (only cited claims appear)
 *
 * PURE — no I/O. This is the function the golden conformance fixtures target.
 *
 * Edge cases (§11) are all handled here; see test-citation-apply.js.
 */

const {
  WELL_FORMED_RE,
  parseHandles,
  sanitizeInner,
  stripAllCitationMarkup,
  serializeResolvedTag,
} = require('./citation-format');

// Private-use sentinels wrap protected fragments after pass 1. They carry no
// citation markup (so pass-2 scrubbing leaves them intact) and add no
// surrounding whitespace (so prose spacing is preserved exactly). Built from
// char codes to keep the source ASCII-clean.
const SENTINEL_OPEN = String.fromCharCode(0xe000);
const SENTINEL_CLOSE = String.fromCharCode(0xe001);
const RESTORE_RE = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, 'g');

/**
 * @param {string} prose            draft text with provisional citation tags
 * @param {Object[]} citableSet     [{ handle:'cit_N', uuid, claim_key, claim_text,
 *                                     verdict, verification_level,
 *                                     verification_confidence, sources, citation_path }]
 * @returns {{ prose: string, references: Object[], stats: Object }}
 */
function applyCitations(prose, citableSet) {
  // Strip any pre-existing sentinel chars from the input so prose that happens
  // to contain U+E000/U+E001 cannot collide with our protect/restore pass.
  const text = typeof prose === 'string'
    ? prose.split(SENTINEL_OPEN).join('').split(SENTINEL_CLOSE).join('')
    : '';
  const set = Array.isArray(citableSet) ? citableSet : [];

  if (set.length === 0) {
    // No citable set → strip every citation tag, keep inner text (§11).
    return {
      prose: stripAllCitationMarkup(text),
      references: [],
      stats: { tags_found: 0, tags_validated: 0, refs_dropped: 0, references_built: 0 },
    };
  }

  const byHandle = new Map(set.map((c) => [c.handle, c]));
  const seqByUuid = new Map();   // uuid → display seq
  const usedUuids = [];          // first-appearance order

  let tagsFound = 0;
  let tagsValidated = 0;
  let refsDropped = 0;
  let nextSeq = 1;

  // --- Pass 1: replace well-formed tags with protected sentinels ---
  // We can't write the resolved tag inline because pass 2 scrubs leftover
  // citation markup and would clobber it. Sentinels carry no markup.
  const protectedFragments = [];
  const afterPass1 = text.replace(WELL_FORMED_RE, (full, refAttr, inner) => {
    tagsFound++;
    const cleanInner = sanitizeInner(inner);
    const handles = parseHandles(refAttr);

    const uuids = [];
    const seqs = [];
    const seenInThisTag = new Set();
    for (const h of handles) {
      const entry = byHandle.get(h);
      if (!entry) { refsDropped++; continue; }
      if (seenInThisTag.has(entry.uuid)) continue; // collapse dupes within one tag
      seenInThisTag.add(entry.uuid);

      let seq = seqByUuid.get(entry.uuid);
      if (seq === undefined) {
        seq = nextSeq++;
        seqByUuid.set(entry.uuid, seq);
        usedUuids.push(entry.uuid);
      }
      uuids.push(entry.uuid);
      seqs.push(seq);
    }

    if (uuids.length === 0) {
      // Every handle was invalid → strip markup, keep inner text (§11).
      return cleanInner;
    }

    tagsValidated++;
    const idx = protectedFragments.length;
    protectedFragments.push(serializeResolvedTag(uuids, seqs, cleanInner));
    return `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`;
  });

  // --- Pass 2: scrub any leftover (malformed/unclosed/nested) markup ---
  const scrubbed = stripAllCitationMarkup(afterPass1);

  // --- Pass 3: restore protected resolved tags ---
  const finalProse = scrubbed.replace(
    RESTORE_RE,
    (_, idx) => protectedFragments[Number(idx)] ?? ''
  );

  // --- Build references[] in seq order (only cited claims) ---
  const byUuid = new Map(set.map((c) => [c.uuid, c]));
  const references = usedUuids.map((uuid) => {
    const c = byUuid.get(uuid);
    return {
      uuid,
      seq: seqByUuid.get(uuid),
      claim_key: c.claim_key,
      claim_text: c.claim_text,
      verdict: c.verdict,
      verification_level: c.verification_level,
      verification_confidence: c.verification_confidence ?? 0,
      sources: Array.isArray(c.sources) ? c.sources : [],
      ...(c.citation_path ? { citation_path: c.citation_path } : {}),
    };
  });

  return {
    prose: finalProse,
    references,
    stats: {
      tags_found: tagsFound,
      tags_validated: tagsValidated,
      refs_dropped: refsDropped,
      references_built: references.length,
    },
  };
}

module.exports = { applyCitations };
