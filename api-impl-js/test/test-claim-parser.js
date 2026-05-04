'use strict';

const assert = require('assert');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');

function runTest() {
  const antibioticClaim = canonicalizeClaim('Antibiotics are generally effective against bacterial infections.');
  assert.equal(antibioticClaim.domain, 'health');
  assert.equal(antibioticClaim.claim_kind, 'efficacy_relationship');
  assert.ok(antibioticClaim.domain_confidence >= 0.6);
  assert.ok(antibioticClaim.domain_match_terms.some((term) => term.includes('antibiotic')));

  const ambiguityClaim = canonicalizeClaim(
    "The scope of 'effective' may be unclear.",
    {},
    { originalQuery: 'Why are antibiotics effective on bacterial infections?' }
  );
  assert.equal(ambiguityClaim.domain, 'health');
  assert.equal(ambiguityClaim.claim_kind, 'ambiguity_scope');
  assert.equal(ambiguityClaim.predicate, 'may');
  assert.ok(ambiguityClaim.domain_match_terms.some((term) => term.startsWith('context:')));

  const metaClaim = canonicalizeClaim('Established medical knowledge supports the use of antibiotics against bacterial infections.');
  assert.equal(metaClaim.domain, 'health');
  assert.equal(metaClaim.claim_kind, 'meta_reasoning');

  const technologyClaim = canonicalizeClaim('The API server stores model embeddings in a vector database.');
  assert.equal(technologyClaim.domain, 'technology');
  assert.notEqual(technologyClaim.domain, 'health');

  console.log('✓ claim parser classification heuristics validated');
}

try {
  runTest();
} catch (error) {
  console.error('❌ claim parser test failed');
  console.error(error.stack || error.message);
  process.exit(1);
}