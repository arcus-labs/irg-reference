#!/usr/bin/env node
'use strict';

/**
 * Citation-Quality Benchmark (Citation_Application.md §13)
 *
 * Runs a fixed eval set through the citation path with a REAL model and
 * reports ALCE-style citation recall + precision (and F1), with variance
 * across repeated trials. These are the "defend our accuracy" numbers.
 *
 * For each case the harness:
 *   1. seeds the case's ground-truth verified claims as citations,
 *   2. runs memoryRecall → draft (real LLM) → citationApply → citationQuality
 *      (real LLM) — the exact production node path,
 *   3. records recall / precision / f1 + counts.
 *
 * Why seeded (not full live web-fetch)? Reproducibility. We fix the citable
 * set so the benchmark measures the MODEL's citing behavior, not the day's
 * web availability. A full-pipeline mode (live fetch + verify) can be added
 * later for an integration-grade number.
 *
 * Interpretation:
 *   - precision = of the citations the model placed, how many genuinely
 *     support their sentence (catches misattached tags). Headline quality.
 *   - recall = of the answer's claim-bearing sentences, how many are backed
 *     by a citation. Low recall = the model under-cites (asserts more than it
 *     attributes), even if precision is perfect.
 *
 * Usage:
 *   node bench/citation-bench.js [--provider groq] [--model <id>]
 *                                [--trials N] [--case <id>] [--out file.json]
 *                                [--json] [--mock]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { createLLMClient } = require('../core/llm');
const { canonicalizeClaim } = require('../core/external-fact-check/claim-parser');

const EVAL_SET_PATH = path.join(__dirname, 'citation-eval-set.json');
const PROMPTS_PATH = path.join(__dirname, '../core/prompts/irg-prompts.yaml');

// ---------------------------------------------------------------------------
// Pure aggregation (exported for testing)
// ---------------------------------------------------------------------------

function round(n) {
  return n == null ? null : Number(n.toFixed(3));
}

function stats(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return { mean: null, stdev: null, min: null, max: null, n: 0 };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return { mean: round(mean), stdev: round(Math.sqrt(variance)), min: round(Math.min(...nums)), max: round(Math.max(...nums)), n: nums.length };
}

/**
 * @param {Object[]} trials  per-trial results
 *   { case_id, recall, precision, f1, counts:{claim_bearing,cited_sentences,uncited_claims,misattributed_citations}, tags:{found,validated,dropped} }
 * @returns {Object} aggregate report
 */
function aggregate(trials) {
  const list = Array.isArray(trials) ? trials : [];
  const totals = list.reduce((acc, t) => ({
    claim_bearing: acc.claim_bearing + (t.counts?.claim_bearing || 0),
    cited: acc.cited + (t.counts?.cited_sentences || 0),
    uncited_claims: acc.uncited_claims + (t.counts?.uncited_claims || 0),
    misattributed: acc.misattributed + (t.counts?.misattributed_citations || 0),
    tags_found: acc.tags_found + (t.tags?.found || 0),
    tags_validated: acc.tags_validated + (t.tags?.validated || 0),
    tags_dropped: acc.tags_dropped + (t.tags?.dropped || 0),
  }), { claim_bearing: 0, cited: 0, uncited_claims: 0, misattributed: 0, tags_found: 0, tags_validated: 0, tags_dropped: 0 });

  const byCaseMap = {};
  for (const t of list) (byCaseMap[t.case_id] ||= []).push(t);
  const by_case = {};
  for (const [id, ts] of Object.entries(byCaseMap)) {
    by_case[id] = {
      trials: ts.length,
      recall: stats(ts.map((x) => x.recall)),
      precision: stats(ts.map((x) => x.precision)),
      f1: stats(ts.map((x) => x.f1)),
    };
  }

  return {
    trials: list.length,
    recall: stats(list.map((t) => t.recall)),
    precision: stats(list.map((t) => t.precision)),
    f1: stats(list.map((t) => t.f1)),
    totals,
    by_case,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const opts = { provider: 'groq', model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', trials: 1, case: null, out: null, json: false, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--mock') opts.mock = true;
    else if (a === '--provider') opts.provider = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--trials') opts.trials = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--case') opts.case = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return opts;
}

function seedCitation(root, claim) {
  const structured = canonicalizeClaim(claim.claim_text);
  const dir = path.join(root, 'citations', '2026-05');
  fs.mkdirSync(dir, { recursive: true });
  const citation = {
    claim_key: structured.claim_key,
    claim: structured,
    verdict: claim.verdict,
    verification_level: 'verified',
    verification_status: `verified_${claim.verdict}`,
    created_at: '2026-05-01T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    verified_at: '2026-05-01T00:00:00.000Z',
    confidence: 0.9,
    retrieval_mode: 'fetched_unverified',
    retrieval_deferred: false,
    sources: (claim.sources || []).map((s) => ({
      url: s.url,
      title: s.title || null,
      verification: { verdict: claim.verdict, confidence: 0.9, quoted_excerpt: s.supporting_span || null, llm_used: true },
    })),
  };
  const fname = `${structured.claim_key.slice(0, 12)}-${Math.random().toString(36).slice(2, 7)}.json`;
  fs.writeFileSync(path.join(dir, fname), JSON.stringify(citation, null, 2));
}

// A deterministic stand-in model for --mock smoke runs (no API key needed).
function makeMockClient() {
  return {
    async call(prompt, opts) {
      const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      if (opts?.node === 'draft') {
        // Only the rendered citable-claims block uses the "handle": "cit_N"
        // shape; the prompt's instructions/examples also mention cit_1/cit_2
        // in prose, so scan for the JSON handle form to avoid phantom handles.
        const handles = [...new Set((prompt.match(/"handle":\s*"(cit_\d+)"/g) || [])
          .map((m) => /cit_\d+/.exec(m)[0]))];
        const body = handles.map((h, i) => `Fact ${i + 1}: <citation ref="${h}">verified statement ${i + 1}</citation>.`).join(' ');
        return { content: JSON.stringify({ response: `## Answer\n\n${body || 'No verified facts.'}`, confidence: 0.9 }), usage };
      }
      if (opts?.node === 'citationQuality') {
        const seqs = [...new Set((prompt.match(/seq="(\d+)"/g) || []))];
        const sentences = seqs.map((s) => ({ text: s, claim_bearing: true, has_citation: true, citation_supports: true, cited_seqs: [Number(/\d+/.exec(s)[0])] }));
        return { content: JSON.stringify({ sentences }), usage };
      }
      throw new Error(`mock: unexpected node ${opts?.node}`);
    },
  };
}

async function runTrial(caseObj, llm, prompts, nodes) {
  const { memoryRecallNode, draftNode, citationApplyNode, citationQualityNode } = nodes;
  let state = {
    originalQuery: caseObj.query,
    context: caseObj.context || {},
    iteration: 0,
    nodes: [],
    history: [],
    factCheckResult: {
      critical_claims: caseObj.verified_claims.map((c) => ({ claim: c.claim_text, importance: caseObj.domain, assessment: 'true' })),
      generated_at: new Date().toISOString(),
    },
  };

  let p = memoryRecallNode.prepare(state, prompts);
  state = await memoryRecallNode.process(p, await memoryRecallNode.llmCall(p));

  p = draftNode.prepare(state, prompts);
  state = draftNode.process(p, await draftNode.llmCall(p, llm));

  state = citationApplyNode.process(citationApplyNode.prepare(state, prompts));

  p = citationQualityNode.prepare(state, prompts);
  // When the model emitted no citations, hasCitations is false and process()
  // returns an inert (null-scored) result regardless of the llmResult arg.
  const qualityResult = p.citationQualityInput.hasCitations
    ? await citationQualityNode.llmCall(p, llm)
    : null;
  state = citationQualityNode.process(p, qualityResult);

  const q = state.citationQualityResult || {};
  const apply = state.citationApplyResult || {};
  return {
    case_id: caseObj.id,
    recall: q.citation_recall,
    precision: q.citation_precision,
    f1: q.citation_f1,
    counts: q.counts || {},
    tags: { found: apply.tags_found || 0, validated: apply.tags_validated || 0, dropped: apply.refs_dropped || 0 },
  };
}

function fmt(v) { return v == null ? ' n/a ' : v.toFixed(3); }

function printReport(opts, agg, evalMeta) {
  console.log('========================================================');
  console.log('Citation-Quality Benchmark');
  console.log('========================================================');
  console.log(`eval set : ${evalMeta.description ? '' : ''}v${evalMeta.version} (${Object.keys(agg.by_case).length} cases × ${opts.trials} trial(s))`);
  console.log(`model    : ${opts.mock ? 'MOCK (no LLM)' : `${opts.provider}/${opts.model}`}`);
  console.log('');
  console.log('Overall (mean ± stdev over all trials):');
  console.log(`  precision : ${fmt(agg.precision.mean)} ± ${fmt(agg.precision.stdev)}   (n=${agg.precision.n})`);
  console.log(`  recall    : ${fmt(agg.recall.mean)} ± ${fmt(agg.recall.stdev)}   (n=${agg.recall.n})`);
  console.log(`  f1        : ${fmt(agg.f1.mean)} ± ${fmt(agg.f1.stdev)}   (n=${agg.f1.n})`);
  console.log('');
  console.log('Totals across trials:');
  console.log(`  claim-bearing sentences : ${agg.totals.claim_bearing}`);
  console.log(`  cited sentences         : ${agg.totals.cited}`);
  console.log(`  uncited claims (recall gaps)        : ${agg.totals.uncited_claims}`);
  console.log(`  misattributed citations (precision) : ${agg.totals.misattributed}`);
  console.log(`  citation tags found/validated/dropped: ${agg.totals.tags_found}/${agg.totals.tags_validated}/${agg.totals.tags_dropped}`);
  console.log('');
  console.log('Per case (precision / recall / f1):');
  for (const [id, c] of Object.entries(agg.by_case)) {
    console.log(`  ${id.padEnd(22)} P ${fmt(c.precision.mean)}  R ${fmt(c.recall.mean)}  F1 ${fmt(c.f1.mean)}`);
  }
  console.log('========================================================');
}

async function main() {
  const opts = parseFlags(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node bench/citation-bench.js [--provider P] [--model M] [--trials N] [--case ID] [--out file] [--json] [--mock]');
    process.exit(0);
  }

  const evalSet = JSON.parse(fs.readFileSync(EVAL_SET_PATH, 'utf8'));
  const prompts = yaml.load(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  let cases = evalSet.cases;
  if (opts.case) cases = cases.filter((c) => c.id === opts.case);
  if (!cases.length) { console.error(`No cases match --case ${opts.case}`); process.exit(2); }

  // One temp fact-store seeded with every case's ground-truth citations.
  // memoryRecall only looks up the claim_keys it is asked about per case, so
  // there is no cross-case contamination of citable sets.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-bench-'));
  process.env.FACT_STORE_ROOT = root;
  for (const c of cases) for (const claim of c.verified_claims) seedCitation(root, claim);

  // Require nodes AFTER FACT_STORE_ROOT is set.
  const nodes = {
    memoryRecallNode: require('../core/nodes/memory-recall-node'),
    draftNode: require('../core/nodes/draft-node'),
    citationApplyNode: require('../core/nodes/citation-apply-node'),
    citationQualityNode: require('../core/nodes/citation-quality-node'),
  };

  const llm = opts.mock ? makeMockClient() : createLLMClient({ provider: opts.provider, model: opts.model });

  const trials = [];
  for (let t = 0; t < opts.trials; t++) {
    for (const c of cases) {
      try {
        trials.push(await runTrial(c, llm, prompts, nodes));
      } catch (err) {
        console.error(`[bench] case ${c.id} trial ${t} failed: ${err.message}`);
        trials.push({ case_id: c.id, recall: null, precision: null, f1: null, counts: {}, tags: { found: 0, validated: 0, dropped: 0 }, error: err.message });
      }
    }
  }

  fs.rmSync(root, { recursive: true, force: true });

  const agg = aggregate(trials);
  const report = { generated_at: new Date().toISOString(), model: opts.mock ? 'mock' : `${opts.provider}/${opts.model}`, trials_per_case: opts.trials, eval_version: evalSet.version, aggregate: agg, raw_trials: trials };

  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printReport(opts, agg, evalSet);
}

if (require.main === module) {
  main().catch((err) => { console.error('[bench] fatal:', err.stack || err.message); process.exit(1); });
}

module.exports = { aggregate, stats };
