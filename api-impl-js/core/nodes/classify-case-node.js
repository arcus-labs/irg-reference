'use strict';

/**
 * Classify Case Node
 *
 * Runs one focused LLM call between `clarify` and `strategy` in an
 * adjudication graph. Its single job is to classify the case under a
 * domain-specific error/issue taxonomy and write the locked category to
 * `state.regEErrorCategory`. It also prepends a structured banner to
 * `state.context` so every downstream node inherits the locked
 * classification deterministically.
 *
 * MULTI-DOMAIN: the taxonomy is supplied by the runner via
 * `state.caseClassification`:
 *
 *   {
 *     domainName:    'Regulation E error',           // human label
 *     primaryStatute:'§1005.11(a)',                  // anchoring cite
 *     categories: [ { code, label, section, note? } ],
 *     guidance:   [ '<classification rule>', ... ],  // optional
 *     tierCode:   'i',   // the category whose presence triggers a liability
 *                        // tier / cap (for Reg E this is (i) unauthorized EFT)
 *   }
 *
 * When `state.caseClassification` is absent, the node falls back to the
 * built-in Regulation E §1005.11(a) taxonomy — so the original Reg E demo
 * keeps working unchanged.
 */

const { recordNode, safeParseJson, extractTokens } = require('./node-utils');

// Built-in Reg E taxonomy (default / backward-compat).
const REG_E_CLASSIFICATION = {
  domainName: 'Regulation E error',
  primaryStatute: '§1005.11(a)',
  tierCode: 'i',
  categories: [
    { code: 'i',   label: 'unauthorized EFT',        section: '§1005.2(m), §1005.6' },
    { code: 'ii',  label: 'incorrect EFT',           section: '§1005.11(a)(2)' },
    { code: 'iii', label: 'omission from statement', section: '§1005.11(a)(3)' },
    { code: 'iv',  label: 'bookkeeping error',       section: '§1005.11(a)(4)' },
    { code: 'v',   label: 'incorrect ATM amount',    section: '§1005.11(a)(5)' },
    { code: 'vi',  label: 'missing notice',          section: '§1005.11(a)(6), §1005.9, §1005.10(d)' },
    { code: 'vii', label: 'documentation request',   section: '§1005.11(a)(7)' },
    { code: 'out_of_scope', label: 'not an EFT under Reg E', section: '§1005.2(m) (definition not met)' },
  ],
  guidance: [
    'A duplicate posting by a merchant the consumer DID authorize is category (ii) incorrect EFT, NOT (i) unauthorized.',
    'A preauthorized transfer billed AFTER a stop-payment order is a §1005.10(c) violation; classify as category (i) only if the consumer disputes the underlying authorization, otherwise treat as (ii)/(vi) per the facts.',
    'A preauthorized transfer billed at a DIFFERENT amount than prior without the 10-day advance notice is category (vi) missing notice under §1005.10(d).',
    'A fee assessed under a separate disclosure (e.g. overdraft fee under §1005.17 opt-in dispute, or non-EFT fee schedule) is out_of_scope under Reg E error resolution.',
    'A Subpart B remittance error is category (ii) incorrect EFT but governed by §1005.33/.34; mark the section_anchor accordingly.',
    'Category (i) requires that the transfer was initiated by someone OTHER than the consumer WITHOUT actual authority (§1005.2(m)).',
  ],
};

function getSpec(state) {
  const spec = state.caseClassification && Array.isArray(state.caseClassification.categories)
    ? state.caseClassification
    : REG_E_CLASSIFICATION;
  return spec;
}

function buildSelectionPrompt(state) {
  const spec = getSpec(state);
  const caseText = typeof state.context === 'string' ? state.context : JSON.stringify(state.context || {}, null, 2);
  const list = spec.categories.map((c) => `  - ${c.code}: ${c.label} — primary rule ${c.section}`).join('\n');
  const guidance = (spec.guidance || []).map((g) => `  - ${g}`).join('\n');
  const codes = spec.categories.map((c) => `"${c.code}"`).join(' | ');

  return [
    `You are a ${spec.domainName} classifier. Your ONLY job is to assign this case`,
    `to exactly ONE category under ${spec.primaryStatute}, or to flag it as out-of-scope.`,
    '',
    `Categories (${spec.primaryStatute}):`,
    list,
    '',
    ...(guidance ? ['Classification rules:', guidance, ''] : []),
    'Case packet:',
    caseText,
    '',
    'CRITICAL: Return ONLY valid JSON with NO markdown formatting or extra text.',
    '',
    '{',
    `  "category": ${codes},`,
    '  "label": "<short human label grounded in the facts>",',
    '  "section_anchor": "<primary citation that governs this category>",',
    '  "reason": "<one-sentence justification grounded in the case facts>"',
    '}',
  ].join('\n');
}

function categoryBanner(cls, spec) {
  const isTier = spec.tierCode && cls.category === spec.tierCode;
  const isOutOfScope = cls.category === 'out_of_scope';
  const tierLine = isTier
    ? `This category DOES trigger the ${spec.domainName} liability tier / cap analysis.`
    : isOutOfScope
      ? `This dispute is OUT OF SCOPE for ${spec.domainName} error resolution; do NOT apply the in-scope remedy framework.`
      : `This category does NOT trigger liability-tier analysis — apply the category's own remedy framework. Use the category's own vocabulary, not the tier-category's.`;

  const codeLabel = isOutOfScope ? 'n/a — out of scope' : cls.category;
  return [
    '═══════════════════════════════════════════════════════════════════',
    `${spec.domainName.toUpperCase()} CATEGORY (LOCKED — do not re-classify downstream):`,
    `  Category: ${spec.primaryStatute} (${codeLabel}) — ${cls.label}`,
    `  Primary section anchor: ${cls.section_anchor}`,
    `  Classification rationale: ${cls.reason}`,
    `  ${tierLine}`,
    '═══════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

const classifyCaseNode = {
  id: 'classifyCase',
  type: 'case_classification',

  prepare(state) {
    return {
      ...state,
      classifyCaseInput: { selectionPrompt: buildSelectionPrompt(state) },
      currentPhase: 'classifyCase',
    };
  },

  async llmCall(state, llmClient) {
    const input = state.classifyCaseInput || {};
    if (!input.selectionPrompt) return { skipped: true };
    return llmClient.call(input.selectionPrompt, { node: 'classifyCase' });
  },

  process(state, llmResponse) {
    const spec = getSpec(state);
    let parsed = {};
    let tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    if (llmResponse && !llmResponse.skipped) {
      const content = typeof llmResponse === 'object' ? llmResponse.content : llmResponse;
      tokens = extractTokens(llmResponse);
      let text = typeof content === 'string' ? content.trim() : '';
      if (text.startsWith('```')) {
        text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
      }
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) text = braceMatch[0];
      parsed = safeParseJson(text) || {};
    }

    const validCodes = new Set(spec.categories.map((c) => c.code));
    // Default to the first category if the model returns nothing parseable.
    const fallbackCode = spec.categories[0]?.code || 'unknown';
    const category = validCodes.has(parsed.category) ? parsed.category : fallbackCode;
    const fallback = spec.categories.find((c) => c.code === category) || { label: 'unknown', section: '' };
    const classification = {
      category,
      label: parsed.label || fallback.label,
      section_anchor: parsed.section_anchor || fallback.section,
      reason: parsed.reason || `(no rationale returned; defaulted to ${fallback.label})`,
    };

    const banner = categoryBanner(classification, spec);
    const newContext = typeof state.context === 'string'
      ? `${banner}${state.context}`
      : banner + JSON.stringify(state.context || {}, null, 2);

    const node = {
      id: `node_classify_case_${state.iteration || 0}`,
      type: 'case_classification',
      goal: `Classify the dispute under ${spec.primaryStatute} categories (or out-of-scope) before strategy`,
      content: classification,
      raw_output: JSON.stringify(classification),
      status: 'completed',
      confidence: 0.95,
      tokens,
      timestamp: new Date().toISOString(),
    };

    const currentTokens = state.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const newTokens = {
      input_tokens: (currentTokens.input_tokens || 0) + (tokens.input_tokens || 0),
      output_tokens: (currentTokens.output_tokens || 0) + (tokens.output_tokens || 0),
      total_tokens: (currentTokens.total_tokens || 0) + (tokens.total_tokens || 0),
    };

    return recordNode(
      {
        ...state,
        regEErrorCategory: classification,
        caseCategory: classification,
        total_tokens_used: newTokens,
        context: newContext,
      },
      node,
      'classifyCase'
    );
  },
};

module.exports = classifyCaseNode;
