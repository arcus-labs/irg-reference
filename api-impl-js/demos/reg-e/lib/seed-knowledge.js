'use strict';

/**
 * Seed the Reg E knowledge pack into a fact-store.
 *
 * Writes each CFR rule (knowledge/reg-e-claims.json) as an embedded claim
 * artifact so it becomes part of the ClaimIndex corpus — the relevant rules
 * for a consumer's question are then retrieved semantically (see
 * retrieve-citable.js) and offered to the drafting model as citable, verified
 * evidence.
 *
 * Caller must set FACT_STORE_ROOT to the demo store before requiring the
 * fact-store modules.
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_PATH = path.join(__dirname, '..', 'knowledge', 'reg-e-claims.json');

function loadPack() {
  return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
}

/**
 * Embed + persist the knowledge pack's claims into the configured fact-store.
 * Returns the writer result (artifact metadata).
 */
async function seedKnowledge() {
  const pack = loadPack();
  const { writeFactCheckClaimsArtifact } = require('../../../core/external-fact-check/claim-store');

  const criticalClaims = pack.claims.map((c) => ({
    claim: c.claim,
    importance: c.section,
    assessment: 'true',
    reasoning: `Reg E rule (${c.section}).`,
  }));

  const result = await writeFactCheckClaimsArtifact({
    criticalClaims,
    summary: pack.regulation,
    confidence: 1,
    originalQuery: 'reg-e knowledge pack',
    context: { pack: pack.pack },
    iteration: 0,
    sourceNode: 'regEKnowledgeSeed',
  });

  return { pack, result, claim_count: criticalClaims.length };
}

module.exports = { seedKnowledge, loadPack, KNOWLEDGE_PATH };
