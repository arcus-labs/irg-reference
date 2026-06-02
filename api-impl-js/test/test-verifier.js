/**
 * Tests for the citation verifier.
 *
 * Uses a mock LLM client (returns canned JSON based on a per-source
 * verdict map) and pre-seeded citation + markdown fixtures so we
 * never make a real LLM call.
 *
 * Covers:
 *   - supported / refuted / inconclusive / off_topic verdicts pass through
 *   - source without markdown_file → 'unreachable' without LLM call
 *   - source with fetch error → 'unreachable' without LLM call
 *   - aggregation: supported, refuted, contested, inconclusive
 *   - citation JSON updated in place (verification_level, verdict,
 *     verification_status, per-source verification)
 *   - idempotency: a second run skips already-verified sources
 *   - unknown LLM verdict normalized to 'inconclusive'
 *   - bulk verifier returns aggregated totals
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-store-verifier-test-'));
process.env.FACT_STORE_ROOT = tmpRoot;

const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');
const { verifyCitation, verifyManyCitations, aggregateVerdicts } = require('../core/external-fact-check/verifier');

const promptsPath = path.resolve(__dirname, '..', 'core', 'prompts', 'irg-prompts.yaml');
const prompts = yaml.load(fs.readFileSync(promptsPath, 'utf8'));
const verifyPromptTemplate = prompts.citationVerify;

let passed = 0;
let failed = 0;

function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); if (extra !== undefined) console.log('    →', extra); }
}

// ---------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------

function makeMockLlm({ verdictByContent, tokenUsage }) {
  let callCount = 0;
  return {
    callCount() { return callCount; },
    call: async (prompt) => {
      callCount++;
      const responseFor = pickResponse(prompt, verdictByContent);
      return {
        content: JSON.stringify(responseFor),
        usage: tokenUsage || { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      };
    },
  };
}

function pickResponse(prompt, verdictByContent) {
  const lower = String(prompt).toLowerCase();
  for (const [needle, response] of Object.entries(verdictByContent)) {
    if (lower.includes(needle.toLowerCase())) return response;
  }
  // Default fallback if no needle matched
  return {
    verdict: 'inconclusive',
    confidence: 0.5,
    reasoning: 'No matching fixture',
    quoted_excerpt: null,
  };
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

function writeMarkdownFile(filename, content) {
  const dir = path.join(tmpRoot, 'sources', 'markdown');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, filename);
  fs.writeFileSync(target, content, 'utf8');
  return path.relative(tmpRoot, target);
}

function writeCitation(claimText, sources) {
  const structured = canonicalizeClaim(claimText);
  const citationDir = path.join(tmpRoot, 'citations', '2026-04');
  fs.mkdirSync(citationDir, { recursive: true });
  const filename = `${structured.claim_key.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}.json`;
  const fullPath = path.join(citationDir, filename);
  const citation = {
    claim_key: structured.claim_key,
    created_at: '2026-04-01T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    claim: structured,
    verdict: 'inconclusive',
    confidence: 0.5,
    sources,
    verification_level: 'provisional',
    verification_status: 'candidate_sources_fetched_unverified',
    retrieval_mode: 'fetched_unverified',
    retrieval_deferred: false,
  };
  fs.writeFileSync(fullPath, JSON.stringify(citation, null, 2));
  return {
    absolute: fullPath,
    relative: path.relative(tmpRoot, fullPath),
    claimText,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================');
  console.log('Verifier test');
  console.log('========================================');
  console.log('Temp fact-store: ' + tmpRoot);
  ok('verifyPromptTemplate loaded from YAML', !!verifyPromptTemplate);

  // 1. Mixed verdicts across one citation
  console.log('\n1. Per-source verdicts pass through to citation');
  const mdSup  = writeMarkdownFile('a.md', 'Saturn has rings made of ice and rock fragments.');
  const mdRef  = writeMarkdownFile('b.md', 'Saturn has no rings, it is a featureless gas giant.');
  const mdInc  = writeMarkdownFile('c.md', 'This article is about Saturn but does not discuss its rings.');

  const c1 = writeCitation('Saturn has rings.', [
    { url: 'https://a.example/sup',  rank: 1, source_type: 'reference', stance: 'candidate', markdown_file: mdSup,  retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
    { url: 'https://b.example/ref',  rank: 2, source_type: 'reference', stance: 'candidate', markdown_file: mdRef,  retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
    { url: 'https://c.example/inc',  rank: 3, source_type: 'reference', stance: 'candidate', markdown_file: mdInc,  retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
    { url: 'https://d.example/fail', rank: 4, source_type: 'reference', stance: 'candidate', error: 'Timeout after 10000ms' },
  ]);

  const llm1 = makeMockLlm({
    verdictByContent: {
      'made of ice and rock':            { verdict: 'supported',    confidence: 0.9, reasoning: 'explicit', quoted_excerpt: 'Saturn has rings…' },
      'no rings':                        { verdict: 'refuted',      confidence: 0.85, reasoning: 'direct contradiction', quoted_excerpt: 'has no rings' },
      'does not discuss its rings':      { verdict: 'inconclusive', confidence: 0.6, reasoning: 'on-topic but silent', quoted_excerpt: null },
    },
  });

  const r1 = await verifyCitation({
    citationPath: c1.relative,
    llmClient: llm1,
    promptTemplate: verifyPromptTemplate,
  });

  ok('returned a verdict',          typeof r1.verdict === 'string');
  ok('verdict is contested',         r1.verdict === 'contested');
  ok('breakdown.supported = 1',      r1.breakdown.supported === 1);
  ok('breakdown.refuted = 1',        r1.breakdown.refuted === 1);
  ok('breakdown.inconclusive = 1',   r1.breakdown.inconclusive === 1);
  ok('breakdown.unreachable = 1',    r1.breakdown.unreachable === 1);
  ok('llm_calls = 3 (skipped unreachable)', r1.llm_calls === 3);
  ok('LLM was called 3 times',       llm1.callCount() === 3);

  // 2. Citation written back to disk with updated metadata
  console.log('\n2. Citation JSON updated in place');
  const after = JSON.parse(fs.readFileSync(c1.absolute, 'utf8'));
  ok('verification_level = verified',      after.verification_level === 'verified');
  ok('verdict = contested',                 after.verdict === 'contested');
  ok('verification_status = verified_contested', after.verification_status === 'verified_contested');
  ok('verified_at populated',               typeof after.verified_at === 'string');
  ok('per-source verification[0] supported', after.sources[0].verification?.verdict === 'supported');
  ok('per-source verification[1] refuted',   after.sources[1].verification?.verdict === 'refuted');
  ok('per-source verification[2] inconclusive', after.sources[2].verification?.verdict === 'inconclusive');
  ok('per-source verification[3] unreachable', after.sources[3].verification?.verdict === 'unreachable');
  ok('unreachable source has llm_used=false', after.sources[3].verification?.llm_used === false);
  ok('supported source has llm_used=true',    after.sources[0].verification?.llm_used === true);

  // 3. Idempotency: second run skips already-verified sources
  console.log('\n3. Idempotency');
  const llm2 = makeMockLlm({ verdictByContent: { 'X': { verdict: 'supported', confidence: 0.5 } } });
  const r2 = await verifyCitation({
    citationPath: c1.relative,
    llmClient: llm2,
    promptTemplate: verifyPromptTemplate,
  });
  ok('LLM not re-invoked on already-verified',    llm2.callCount() === 0);
  ok('verified = 0 (already done)',                r2.verified === 0);
  ok('skipped = 3 (the three already-verified)',  r2.skipped === 3);

  // 4. All-supported citation
  console.log('\n4. All-supported aggregation');
  const mdAll = writeMarkdownFile('all-sup.md', 'Antibiotics treat bacterial infections. They do not work on viruses.');
  const c4 = writeCitation('Antibiotics treat bacterial infections.', [
    { url: 'https://a.example/1', rank: 1, markdown_file: mdAll, retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
    { url: 'https://a.example/2', rank: 2, markdown_file: mdAll, retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
  ]);
  const llm4 = makeMockLlm({
    verdictByContent: {
      'treat bacterial': { verdict: 'supported', confidence: 0.9, reasoning: 'matches', quoted_excerpt: 'Antibiotics treat' },
    },
  });
  const r4 = await verifyCitation({
    citationPath: c4.relative, llmClient: llm4, promptTemplate: verifyPromptTemplate,
  });
  ok('verdict = supported', r4.verdict === 'supported');
  ok('verification_status = verified_supported', r4.verification_status === 'verified_supported');

  // 5. All unreachable (no markdown_file anywhere)
  console.log('\n5. All-unreachable aggregation');
  const c5 = writeCitation('Pluto is the ninth planet.', [
    { url: 'https://x.example/1', rank: 1 },
    { url: 'https://x.example/2', rank: 2, error: 'HTTP 503' },
  ]);
  const llm5 = makeMockLlm({ verdictByContent: {} });
  const r5 = await verifyCitation({
    citationPath: c5.relative, llmClient: llm5, promptTemplate: verifyPromptTemplate,
  });
  ok('verdict = unverified',                   r5.verdict === 'unverified');
  ok('verification_status = verification_unreachable',
                                                 r5.verification_status === 'verification_unreachable');
  ok('llm_calls = 0',                          llm5.callCount() === 0);
  const after5 = JSON.parse(fs.readFileSync(c5.absolute, 'utf8'));
  ok('citation level remains provisional',     after5.verification_level === 'provisional');

  // 6. Unknown verdict from LLM → coerced to inconclusive
  console.log('\n6. Unknown LLM verdict normalized');
  const mdWeird = writeMarkdownFile('weird.md', 'Some text about weird claim.');
  const c6 = writeCitation('A weird claim that tests verdict normalization.', [
    { url: 'https://w.example', rank: 1, markdown_file: mdWeird, retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
  ]);
  const llm6 = makeMockLlm({
    verdictByContent: { 'weird claim': { verdict: 'tea-leaves-say-maybe', confidence: 0.4, reasoning: 'not a known label', quoted_excerpt: null } },
  });
  const r6 = await verifyCitation({
    citationPath: c6.relative, llmClient: llm6, promptTemplate: verifyPromptTemplate,
  });
  const after6 = JSON.parse(fs.readFileSync(c6.absolute, 'utf8'));
  ok('per-source verdict normalized to inconclusive', after6.sources[0].verification.verdict === 'inconclusive');
  ok('reasoning mentions LLM returned unrecognized verdict',
                                                       after6.sources[0].verification.reasoning.toLowerCase().includes('unrecognized'));

  // 7. Bulk verifier aggregates totals
  console.log('\n7. verifyManyCitations aggregates');
  // Re-seed two fresh citations so prior idempotency doesn't dominate
  const md7a = writeMarkdownFile('seven-a.md', 'Photosynthesis converts light energy to chemical energy.');
  const md7b = writeMarkdownFile('seven-b.md', 'Plants use photosynthesis to make food from sunlight.');
  const c7a = writeCitation('Photosynthesis is how plants make energy.', [
    { url: 'https://p.example/a', rank: 1, markdown_file: md7a, retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
  ]);
  const c7b = writeCitation('Photosynthesis is how plants make energy.', [
    { url: 'https://p.example/b', rank: 1, markdown_file: md7b, retrieved_at: '2026-04-01T00:00:00Z', status_code: 200 },
  ]);
  const llm7 = makeMockLlm({
    verdictByContent: { 'photosynthesis': { verdict: 'supported', confidence: 0.85, reasoning: 'direct', quoted_excerpt: 'Photosynthesis converts' } },
  });
  const r7 = await verifyManyCitations({
    citationPaths: [c7a.relative, c7b.relative],
    llmClient: llm7,
    promptTemplate: verifyPromptTemplate,
  });
  ok('citations_processed = 2',  r7.citations_processed === 2);
  ok('aggregate supported = 2',  r7.supported === 2);
  ok('aggregate llm_calls = 2',  r7.llm_calls === 2);
  ok('all results have verdict=supported',
    r7.results.every((r) => r.verdict === 'supported'));

  // 8. aggregateVerdicts unit-tested for fun
  console.log('\n8. aggregateVerdicts edge cases');
  ok('all supported → supported',
    aggregateVerdicts([{ verification: { verdict: 'supported', llm_used: true } }]).verdict === 'supported');
  ok('mix supp+ref → contested',
    aggregateVerdicts([
      { verification: { verdict: 'supported', llm_used: true } },
      { verification: { verdict: 'refuted', llm_used: true } },
    ]).verdict === 'contested');
  ok('only inconclusive → inconclusive',
    aggregateVerdicts([{ verification: { verdict: 'inconclusive', llm_used: true } }]).verdict === 'inconclusive');
  ok('only unreachable → unverified',
    aggregateVerdicts([{ verification: { verdict: 'unreachable', llm_used: false } }]).verdict === 'unverified');
  ok('empty array → unverified',
    aggregateVerdicts([]).verdict === 'unverified');

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
});
