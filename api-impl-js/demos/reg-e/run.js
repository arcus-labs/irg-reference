#!/usr/bin/env node
'use strict';

/**
 * Reg E demo runner.
 *
 * Pipeline (reuses the real IRG nodes + the ClaimIndex):
 *   1. seed the CFR knowledge pack into a fresh demo fact-store (embedded)
 *   2. semantically retrieve the rules relevant to the consumer's question
 *   3. draft an answer with the real `draft` node under a Reg E compliance
 *      posture (cite the rule, hedge, escalate, no legal determination)
 *   4. citationApply  → resolve durable IDs + build references[]
 *   5. citationQuality → ALCE-style recall / precision over the cited answer
 *
 * Produces a grounded, hedged, citation-backed answer plus a trace.
 *
 * Usage:
 *   node demos/reg-e/run.js [--scenario unauthorized-charge] [--provider groq] [--model <m>]
 *
 * Requires an LLM provider key (e.g. API_KEY_GROQ) in the repo-root .env.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Fresh, isolated demo fact-store (so re-runs always re-seed cleanly).
const DEMO_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-e-demo-'));
process.env.FACT_STORE_ROOT = DEMO_STORE;

const yaml = require('js-yaml');
const { createLLMClient } = require('../../core/llm');
const draftNode = require('../../core/nodes/draft-node');
const citationApplyNode = require('../../core/nodes/citation-apply-node');
const citationQualityNode = require('../../core/nodes/citation-quality-node');
const { seedKnowledge } = require('./lib/seed-knowledge');
const { retrieveCitable, retrieveCitableByLLM } = require('./lib/retrieve-citable');

const COMPLIANCE_ADDENDUM = `

REGULATORY COMPLIANCE POSTURE (Regulation E / consumer financial context):
- This is a consumer-support context. Provide GENERAL INFORMATION grounded in the cited regulation. Do NOT make a binding legal determination, promise an outcome, or guarantee a specific dollar liability or timeline for this individual.
- Cite the specific rule (use the provided Citable Claims) for every regulatory statement you make.
- State what the rule says, then note which facts are still needed and that the actual result depends on the institution's investigation and the consumer's specific circumstances.
- Direct the consumer to the concrete next step: formally report/dispute the item with the institution, and state the relevant reporting deadline from the cited rules.
- Do NOT invent dollar amounts, deadlines, or rights that are not in the cited claims.
- End with one short plain-language line noting this is general information, not legal advice.`;

function parseArgs(argv) {
  const o = {
    scenario: 'unauthorized-charge',
    provider: 'groq',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    // 'llm' = reasoning selects applicable rules (reliable with any provider);
    // 'semantic' = ClaimIndex embedding retrieval (best with OpenAI embeddings).
    retrieval: 'llm',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--provider') o.provider = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--retrieval') o.retrieval = argv[++i];
  }
  return o;
}

function loadScenario(id) {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenarios.json'), 'utf8'));
  const s = all.scenarios.find((x) => x.id === id);
  if (!s) {
    throw new Error(`Unknown scenario "${id}". Available: ${all.scenarios.map((x) => x.id).join(', ')}`);
  }
  return s;
}

// Shape the retrieved citable set as a memoryRecallResult so the real draft
// node's build-citable-set path produces it (uuid derivation, cit_N handles).
function asMemoryRecallResult(citable) {
  return {
    claims_checked: citable.length,
    recalled: citable.length,
    recalled_verified: citable.length,
    results: citable.map((c) => ({
      claim_text: c.claim_text,
      claim_key: c.claim_key,
      recall: {
        hit: true,
        verdict: c.verdict,
        verification_level: c.verification_level,
        verification_confidence: c.verification_confidence,
        citation_path: null,
        sources: c.sources,
      },
    })),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scenario = loadScenario(opts.scenario);

  console.log('============================================================');
  console.log('IRG · Regulation E demo —', scenario.title);
  console.log('============================================================');
  console.log('Scenario CFR:', scenario.cfr.join(', '));
  console.log('Demo fact-store:', DEMO_STORE);
  console.log('\nConsumer question:\n  ' + scenario.query + '\n');

  const llm = createLLMClient({ provider: opts.provider, model: opts.model });

  // 1. seed
  const seeded = await seedKnowledge();
  console.log(`[seed] ${seeded.claim_count} Reg E rules embedded into the demo fact-store.`);

  // 2. retrieve relevant rules
  const citable = opts.retrieval === 'semantic'
    ? await retrieveCitable(scenario.query, { topK: 5 })
    : await retrieveCitableByLLM(scenario.query, llm, { topK: 5 });
  console.log(`[retrieve · ${opts.retrieval}] ${citable.length} applicable rule(s):`);
  for (const c of citable) {
    const sim = c.similarity !== undefined ? `  (sim ${c.similarity})` : '';
    console.log(`   ${c.handle}  ${c.sources[0].title}${sim}  ${c.claim_text.slice(0, 64)}…`);
  }
  if (citable.length === 0) {
    console.error('No rules retrieved — aborting.');
    process.exit(1);
  }

  // 3. draft under the compliance posture (real LLM, real draft node)
  const prompts = yaml.load(fs.readFileSync(path.join(__dirname, '../../core/prompts/irg-prompts.yaml'), 'utf8'));
  prompts.draft.system += COMPLIANCE_ADDENDUM;

  let state = {
    originalQuery: scenario.query,
    context: scenario.context,
    iteration: 0,
    nodes: [],
    history: [],
    arbiterResult: {},
    clarifyResult: {},
    factCheckResult: { critical_claims: [], summary: '', generated_at: new Date().toISOString() },
    memoryRecallResult: asMemoryRecallResult(citable),
  };

  const prepared = draftNode.prepare(state, prompts);
  state = draftNode.process(prepared, await draftNode.llmCall(prepared, llm));

  // 4. citationApply
  state = citationApplyNode.process(citationApplyNode.prepare(state, prompts));

  // 5. citationQuality
  const cqPrepared = citationQualityNode.prepare(state, prompts);
  state = citationQualityNode.process(cqPrepared, await citationQualityNode.llmCall(cqPrepared, llm));

  // ---- report ----
  console.log('\n------------------------------------------------------------');
  console.log('ANSWER (citation-resolved):');
  console.log('------------------------------------------------------------');
  console.log(state.draftResult.response);

  console.log('\n------------------------------------------------------------');
  console.log('REFERENCES:');
  console.log('------------------------------------------------------------');
  for (const r of state.references) {
    const src = r.sources[0] || {};
    console.log(`  [${r.seq}] ${src.title || ''} — ${r.verdict} — ${src.url || ''}`);
    console.log(`      ${r.claim_text}`);
  }
  if (state.references.length === 0) console.log('  (model cited none)');

  const q = state.citationQualityResult || {};
  console.log('\n------------------------------------------------------------');
  console.log('CITATION QUALITY:', `recall ${q.citation_recall}  precision ${q.citation_precision}  f1 ${q.citation_f1}`);
  console.log('------------------------------------------------------------');

  // ---- save artifacts ----
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {
    scenario: scenario.id,
    title: scenario.title,
    cfr: scenario.cfr,
    query: scenario.query,
    context: scenario.context,
    retrieved: citable.map((c) => ({ handle: c.handle, section: c.sources[0].title, similarity: c.similarity })),
    answer: state.draftResult.response,
    references: state.references,
    citation_quality: state.citationQualityResult,
    generated_at: new Date().toISOString(),
    model: `${opts.provider}/${opts.model}`,
  };
  fs.writeFileSync(path.join(outDir, `${scenario.id}.json`), JSON.stringify(summary, null, 2));

  // Trace-navigator-compatible trace (drop into trace-navigator/traces to view).
  const trace = {
    session_id: `reg-e-${scenario.id}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    query: scenario.query,
    context: scenario.context,
    config: { model: `${opts.provider}/${opts.model}`, demo: 'reg-e', scenario: scenario.id },
    trace: state.nodes,
    draft_response: state.draftResult.response,
    references: state.references,
    citation_quality: state.citationQualityResult,
  };
  fs.writeFileSync(path.join(outDir, `${scenario.id}.trace.json`), JSON.stringify(trace, null, 2));

  console.log(`\n[saved] demos/reg-e/output/${scenario.id}.json  (summary)`);
  console.log(`[saved] demos/reg-e/output/${scenario.id}.trace.json  (trace-navigator viewable)`);

  fs.rmSync(DEMO_STORE, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('Demo failed:', err.stack || err.message);
  try { fs.rmSync(DEMO_STORE, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
