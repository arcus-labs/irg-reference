'use strict';

const { createHash } = require('crypto');

const DOMAIN_SIGNALS = {
  science: {
    tokens: { planet: 3.5, physics: 3.5, chemistry: 3.5, biology: 3, moon: 3, star: 3, climate: 3, orbit: 3, astronomical: 3 },
    phrases: { 'solar system': 4, 'scientific evidence': 2.5 },
  },
  law: {
    tokens: { law: 3.5, statute: 3.5, court: 3.5, judge: 3, regulation: 3, bill: 2.5, legal: 3, lawsuit: 3, constitutional: 3 },
    phrases: { 'supreme court': 4, 'legal standard': 3 },
  },
  finance: {
    tokens: { revenue: 3.5, earnings: 3.5, profit: 3.5, stock: 3, market: 2.5, gdp: 3.5, inflation: 3.5, economy: 3, pricing: 2.5 },
    phrases: { 'interest rate': 3.5, 'balance sheet': 3.5, 'gross domestic product': 4 },
  },
  technology: {
    tokens: { software: 3.5, ai: 4, algorithm: 3.5, model: 1.5, database: 3.5, api: 4, internet: 3, computer: 3, server: 3, cloud: 3, code: 3, hardware: 3, network: 2.5 },
    phrases: { 'artificial intelligence': 4.5, 'machine learning': 4, 'large language model': 4, 'neural network': 4, 'vector database': 4 },
  },
  history: {
    tokens: { century: 3.5, historical: 3.5, empire: 3.5, war: 3, dynasty: 3.5, discovered: 2.5, ancient: 3, medieval: 3 },
    phrases: { 'world war': 4, 'historical record': 3.5 },
  },
  geography: {
    tokens: { country: 3.5, city: 3.5, river: 3.5, mountain: 3.5, population: 3, capital: 3, province: 2.5, border: 2.5, region: 2.5 },
    phrases: { 'located in': 3, 'population of': 3.5 },
  },
  politics: {
    tokens: { election: 4, president: 3.5, senate: 3.5, minister: 3, government: 3, policy: 3, parliament: 3.5, democratic: 3, campaign: 3 },
    phrases: { 'public policy': 3.5, 'foreign policy': 3.5 },
  },
  health: {
    tokens: {
      antibiotic: 4.5,
      bacterial: 4,
      infection: 4,
      medical: 3.5,
      medicine: 3.5,
      clinical: 3.5,
      patient: 3,
      health: 3,
      disease: 3.5,
      drug: 3.5,
      vaccine: 3.5,
      treatment: 3.5,
      therapy: 3.5,
      physician: 3,
      symptom: 3,
      diagnosis: 3.5,
      infection: 4,
      dosage: 3,
      efficacy: 3,
      pathogen: 3.5,
    },
    phrases: {
      'bacterial infection': 4.5,
      'bacterial infections': 4.5,
      'medical knowledge': 3.5,
      'clinical evidence': 3.5,
      'public health': 3.5,
      'side effect': 3,
      'adverse effect': 3,
    },
  },
};

const CLAIM_KIND_SIGNALS = {
  ambiguity_scope: {
    tokens: { ambiguous: 4, ambiguity: 4, unclear: 4, scope: 3.5, definition: 3, meaning: 2.5, interpret: 3, interpretation: 3, context: 2 },
    phrases: { 'scope of': 4, 'may be unclear': 4.5, 'can be interpreted': 4, 'depends on how': 3.5 },
  },
  meta_reasoning: {
    tokens: { reasoning: 4, evidence: 3.5, knowledge: 3.5, perspective: 3.5, consensus: 3.5, rationale: 3, established: 2.5 },
    phrases: { 'domain reasoning': 4.5, 'balanced perspective': 4, 'medical knowledge': 4, 'clinical evidence': 4, 'established knowledge': 3.5 },
  },
  efficacy_relationship: {
    tokens: { effective: 4, efficacy: 4, treat: 3.5, works: 3, work: 2.5, support: 2.5, supports: 2.5, prevent: 3, reduces: 2.5, reduce: 2.5 },
    phrases: { 'effective against': 4.5, 'generally effective': 4, 'supports the use': 3 },
  },
  causal_mechanism: {
    tokens: { cause: 3.5, causes: 3.5, because: 3, mechanism: 4, due: 2.5, enables: 2.5, prevents: 2.5, why: 2 },
    phrases: { 'due to': 3.5, 'works by': 4, 'mechanism of action': 4.5 },
  },
  comparative: {
    tokens: { compared: 3, versus: 3.5, better: 3.5, worse: 3.5, higher: 3, lower: 3, more: 1.5, less: 1.5 },
    phrases: { 'more effective than': 4.5, 'less effective than': 4.5, 'compared with': 4 },
  },
};

const PREDICATE_PATTERNS = [
  /^(.*?)\s+(is|are|was|were)\s+(.+)$/i,
  /^(.*?)\s+(has|have|had)\s+(.+)$/i,
  /^(.*?)\s+(can|could|may|might|will|would|should|must)\s+(.+)$/i,
  /^(.*?)\s+(includes|include|contains|contain|uses|use|supports|support|provides|provide|shows|show|suggests|suggest|indicates|indicate|reduces|reduce|treats|treat)\s+(.+)$/i,
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeValue(value) {
  return normalizeWhitespace(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.?!]+$/g, '')
    .toLowerCase();
}

function normalizeForMatching(value) {
  return normalizeValue(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function singularizeToken(token) {
  if (!token) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function buildTokenSet(value) {
  const tokens = normalizeForMatching(value).split(' ').filter(Boolean);
  return tokens.reduce((set, token) => {
    set.add(token);
    set.add(singularizeToken(token));
    return set;
  }, new Set());
}

function normalizeContextValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeContextValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, nextValue]) => [key, normalizeContextValue(nextValue)])
      .filter(Boolean)
      .join(' ');
  }
  return String(value);
}

function sortObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.keys(value).sort().reduce((acc, key) => {
    const nextValue = value[key];
    acc[key] = typeof nextValue === 'string'
      ? normalizeValue(nextValue)
      : sortObjectKeys(nextValue);
    return acc;
  }, {});
}

function slugifyFragment(value) {
  const normalized = normalizeValue(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
}

function scoreSignalSet(text, tokenSet, signalSet, source, multiplier = 1) {
  const matches = [];
  let score = 0;

  for (const [phrase, weight] of Object.entries(signalSet.phrases || {})) {
    if (text.includes(phrase)) {
      score += weight * multiplier;
      matches.push({ term: phrase, score: weight * multiplier, source });
    }
  }

  for (const [token, weight] of Object.entries(signalSet.tokens || {})) {
    if (tokenSet.has(token)) {
      score += weight * multiplier;
      matches.push({ term: token, score: weight * multiplier, source });
    }
  }

  return { score, matches };
}

function buildConfidence(topScore, secondScore, defaultConfidence) {
  if (topScore <= 0) return defaultConfidence;
  const spread = Math.max(topScore - secondScore, 0);
  const confidence = 0.4 + (Math.min(topScore, 6) * 0.05) + (Math.min(spread, 4) * 0.04);
  return Number(Math.max(defaultConfidence, Math.min(0.99, confidence)).toFixed(2));
}

function rankSignals(signalMap, text, tokenSet, contextText = '', contextTokenSet = new Set()) {
  return Object.entries(signalMap)
    .map(([label, signalSet]) => {
      const primary = scoreSignalSet(text, tokenSet, signalSet, 'claim', 1);
      const contextual = contextText
        ? scoreSignalSet(contextText, contextTokenSet, signalSet, 'context', 0.35)
        : { score: 0, matches: [] };

      return {
        label,
        score: primary.score + contextual.score,
        matches: [...primary.matches, ...contextual.matches].sort((a, b) => b.score - a.score),
      };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function analyzeDomain(rawClaim, options = {}) {
  const text = normalizeForMatching(rawClaim);
  const tokenSet = buildTokenSet(rawClaim);
  const contextText = normalizeForMatching([
    options.originalQuery,
    normalizeContextValue(options.context),
  ].filter(Boolean).join(' '));
  const contextTokenSet = buildTokenSet(contextText);
  const ranked = rankSignals(DOMAIN_SIGNALS, text, tokenSet, contextText, contextTokenSet);
  const [top, second] = ranked;

  if (!top || top.score < 2.2) {
    return {
      domain: 'other',
      domain_confidence: 0.2,
      domain_match_terms: [],
    };
  }

  const matchTerms = [...new Set(top.matches.slice(0, 5).map((match) => `${match.source}:${match.term}`))];
  return {
    domain: top.label,
    domain_confidence: buildConfidence(top.score, second?.score || 0, 0.35),
    domain_match_terms: matchTerms,
  };
}

function analyzeClaimKind(rawClaim) {
  const text = normalizeForMatching(rawClaim);
  const tokenSet = buildTokenSet(rawClaim);
  const ranked = rankSignals(CLAIM_KIND_SIGNALS, text, tokenSet);
  const [top, second] = ranked;

  if (!top || top.score < 2.5) {
    return {
      claim_kind: 'factual_assertion',
      claim_kind_confidence: 0.35,
      claim_kind_match_terms: [],
    };
  }

  return {
    claim_kind: top.label,
    claim_kind_confidence: buildConfidence(top.score, second?.score || 0, 0.4),
    claim_kind_match_terms: [...new Set(top.matches.slice(0, 5).map((match) => match.term))],
  };
}

function inferDomain(rawClaim, options = {}) {
  return analyzeDomain(rawClaim, options).domain;
}

function inferClaimKind(rawClaim) {
  return analyzeClaimKind(rawClaim).claim_kind;
}

function splitClaim(rawClaim) {
  const normalized = normalizeWhitespace(rawClaim).replace(/[.?!]+$/g, '');

  for (const pattern of PREDICATE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        subject: match[1],
        predicate: match[2],
        object: match[3],
      };
    }
  }

  const words = normalized.split(' ').filter(Boolean);
  const pivot = Math.min(Math.max(words.length > 6 ? 4 : 2, 1), words.length);
  return {
    subject: words.slice(0, pivot).join(' '),
    predicate: 'states',
    object: words.slice(pivot).join(' ') || normalized,
  };
}

function canonicalizeClaim(rawText, qualifiers = {}, options = {}) {
  const normalizedRawText = normalizeWhitespace(rawText);
  const parts = splitClaim(normalizedRawText);
  const normalizedQualifiers = sortObjectKeys(qualifiers || {});
  const domainAnalysis = analyzeDomain(normalizedRawText, options);
  const claimKindAnalysis = analyzeClaimKind(normalizedRawText);

  const structuredClaim = {
    raw_text: normalizedRawText,
    domain: domainAnalysis.domain,
    domain_confidence: domainAnalysis.domain_confidence,
    domain_match_terms: domainAnalysis.domain_match_terms,
    claim_kind: claimKindAnalysis.claim_kind,
    claim_kind_confidence: claimKindAnalysis.claim_kind_confidence,
    claim_kind_match_terms: claimKindAnalysis.claim_kind_match_terms,
    subject: slugifyFragment(parts.subject),
    predicate: slugifyFragment(parts.predicate),
    object: normalizeValue(parts.object),
    qualifiers: normalizedQualifiers,
  };

  const canonicalClaim = [
    structuredClaim.domain,
    structuredClaim.subject,
    structuredClaim.predicate,
    structuredClaim.object,
    JSON.stringify(normalizedQualifiers),
  ].join('::');

  return {
    ...structuredClaim,
    canonical_claim: canonicalClaim,
    claim_key: createHash('sha256').update(canonicalClaim).digest('hex'),
  };
}

module.exports = {
  analyzeClaimKind,
  analyzeDomain,
  canonicalizeClaim,
  inferDomain,
  inferClaimKind,
  normalizeWhitespace,
};