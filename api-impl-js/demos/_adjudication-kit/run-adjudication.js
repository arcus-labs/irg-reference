'use strict';

/**
 * Shared adjudication runner kit.
 *
 * The Reg E adjudication demo proved a reusable shape: an evidence packet is
 * classified under a domain taxonomy, reasoned through the full System-2 IRG
 * (clarify → classify → strategy → adversary → arbiter → … → draft → cite →
 * evaluate → converge), then projected into a structured decision artifact
 * and a domain-specific output document (consumer notice, company response,
 * SAR narrative, …).
 *
 * The TOPOLOGY (graph) and the COMMITTED base prompts are identical across
 * domains. What changes per domain — the Implementation layer (prompt-pack
 * addenda) and the Substrate layer (rule citations + classification taxonomy)
 * — is supplied by a DOMAIN DESCRIPTOR. This file is the domain-agnostic
 * machinery; each domain is a small `domain.js`.
 *
 * This mirrors the Cognitive Engineering three-layer separation: one engine,
 * many cognitive behaviors, swapped by overlay + substrate rather than by
 * forking the runner.
 *
 * ---------------------------------------------------------------------------
 * Domain descriptor shape (see demos/<domain>/domain.js for examples):
 * ---------------------------------------------------------------------------
 *   {
 *     id:            'reg-z-billing-error',     // graph/session label
 *     regLabel:      'Regulation Z',            // human label for logs
 *     caseIdPrefix:  'reg-z',                   // auto-id prefix
 *     dirname:       __dirname (of the domain),  // for cases/ + output/ + provenance
 *     promptPack:    { clarify, classifyCase?, strategy, adversary, arbiter, draft },
 *     knowledgePath: '<abs path to claims json>',
 *     seederPath:    '<abs path to seeder>' | null,
 *     citationPackSubdir: 'reg-z-pack' | undefined,
 *     classification: { domainName, primaryStatute, categories, guidance, tierCode },
 *     framing:       (caseId) => '<originalQuery framing string>',
 *     buildDecisionPrompt:   ({ caseInfo, draftResponse, references, recall, category }) => string,
 *     buildOutputDocPrompt:  ({ caseInfo, decision, references, category }) => string,
 *     outputDocKey:  'notice_letter' | 'company_response' | 'sar_narrative',
 *     summarize:     (decision) => [ ['label','value'], ... ]   // console summary rows
 *   }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const yaml = require('js-yaml');
const { runLinearGraph } = require('../../core/execution/irg-interpreter-linear');
const { irgGraphRegEAdjudication } = require('../../graphs/irg-graph-reg-e-adjudication');
const nodeRegistry = require('../../core/execution/irg-node-registry');
const { createLLMClient } = require('../../core/llm');
const { formatTrace } = require('../../core/tracing/trace-formatter');
const { safeParseJson } = require('../../core/nodes/node-utils');
const { buildProvenance } = require('./provenance');
const { withIoSeal, finalizeSeal } = require('./io-seal');

const PROMPTS_PATH = path.resolve(__dirname, '..', '..', 'core', 'prompts', 'irg-prompts.yaml');
const GRAPH_PATH = path.resolve(__dirname, '..', '..', 'graphs', 'irg-graph-reg-e-adjudication.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// determinism wrapper — temperature 0 + fixed seed on every LLM call
// ---------------------------------------------------------------------------
function withDeterminism(llm, { temperature = 0, seed = 1, topP } = {}) {
  return {
    ...llm,
    call: (prompt, opts = {}) => llm.call(prompt, {
      ...opts,
      temperature: opts.temperature ?? temperature,
      seed: opts.seed ?? seed,
      ...(topP !== undefined ? { topP: opts.topP ?? topP } : {}),
    }),
  };
}

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv, domain) {
  const o = {
    case: domain.defaultCase || null,
    provider: 'groq',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    seed: true,
    artifacts: null,
    caseId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') o.case = argv[++i];
    else if (a === '--provider') o.provider = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--no-seed') o.seed = false;
    else if (a === '--artifacts') o.artifacts = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--case-id') o.caseId = argv[++i];
  }
  return o;
}

function generateCaseId(prefix) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rnd}`;
}

// ---------------------------------------------------------------------------
// case packet parsing — the [E*] evidence index becomes structured items;
// the remainder of the markdown is the `context` the IRG reads whole.
// ---------------------------------------------------------------------------
function parseEvidenceIndex(md) {
  const idxStart = md.indexOf('## Evidence Index');
  if (idxStart === -1) return [];
  const block = md.slice(idxStart);
  const items = [];
  const lineRe = /^- \[([Ee]\d+)\]\s+(.+)$/gm;
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    items.push({ id: m[1].toUpperCase(), type: 'fact-of-record', fact: m[2].trim() });
  }
  return items;
}

function loadCase(domain, caseId) {
  const filepath = path.join(domain.dirname, 'cases', `${caseId}.md`);
  if (!fs.existsSync(filepath)) throw new Error(`Case file not found: ${filepath}`);
  const md = fs.readFileSync(filepath, 'utf8');
  return { caseId, filepath, packet: md, evidence: parseEvidenceIndex(md) };
}

function loadFromArtifacts(paths, providedCaseId, prefix) {
  const artifacts = paths.map((p) => {
    const content = fs.readFileSync(p, 'utf8');
    const ext = path.extname(p).slice(1).toLowerCase();
    const type = ({ md: 'markdown', markdown: 'markdown', txt: 'text', csv: 'csv', json: 'json' }[ext]) || 'text';
    return {
      id: path.basename(p, path.extname(p)),
      name: path.basename(p),
      type,
      role: 'evidence',
      size_bytes: Buffer.byteLength(content, 'utf8'),
      content,
    };
  });
  const packet = artifacts.length === 1
    ? artifacts[0].content
    : artifacts.map((a) => `# Artifact: ${a.name} (${a.type})\n\n${a.content}`).join('\n\n---\n\n');
  const evidence = [];
  for (const a of artifacts) if (a.type === 'markdown') evidence.push(...parseEvidenceIndex(a.content));
  return { caseId: providedCaseId || generateCaseId(prefix), filepath: paths[0], packet, evidence, artifacts };
}

// ---------------------------------------------------------------------------
// prompt overlay + LLM IO helpers
// ---------------------------------------------------------------------------
function overlayPrompts(prompts, pack) {
  const cloned = JSON.parse(JSON.stringify(prompts));
  for (const [node, addendum] of Object.entries(pack)) {
    if (cloned[node] && typeof cloned[node].system === 'string') {
      cloned[node].system += addendum;
    }
  }
  return cloned;
}

async function llmJson(llm, prompt, opts) {
  const resp = await llm.call(prompt, opts || {});
  const content = typeof resp === 'object' ? resp.content : resp;
  let text = typeof content === 'string' ? content.trim() : '';
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  return safeParseJson(text) || {};
}

async function llmText(llm, prompt, opts) {
  const resp = await llm.call(prompt, opts || {});
  const content = typeof resp === 'object' ? resp.content : resp;
  let text = typeof content === 'string' ? content.trim() : '';
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  return text;
}

function autoSeed(seederPath, factStoreRoot, verbose = true) {
  if (!seederPath) return;
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [seederPath], {
    env: { ...process.env, FACT_STORE_ROOT: factStoreRoot },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error('Rule-citation seeder failed:\n' + r.stderr);
  if (verbose) console.log(r.stdout.trim().split('\n').slice(-3).join('\n'));
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------
async function runAdjudication(domain) {
  // Each run uses a fresh demo fact-store so the rule-citation seed is clean.
  const DEMO_STORE = fs.mkdtempSync(path.join(os.tmpdir(), `${domain.caseIdPrefix}-adj-`));
  process.env.FACT_STORE_ROOT = DEMO_STORE;

  const OUT_DIR = path.resolve(domain.dirname, 'output');
  const opts = parseArgs(process.argv.slice(2), domain);

  const caseInfo = opts.artifacts
    ? loadFromArtifacts(opts.artifacts, opts.caseId, domain.caseIdPrefix)
    : loadCase(domain, opts.case);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('========================================================');
  console.log(`IRG · ${domain.regLabel} Adjudication —`, caseInfo.caseId);
  console.log('========================================================');
  console.log('Demo fact-store:', DEMO_STORE);
  console.log(`Evidence items: ${caseInfo.evidence.length}`);
  console.log();

  if (opts.seed && domain.seederPath) {
    console.log(`[1/5] seeding ${domain.regLabel} rule citations …`);
    autoSeed(domain.seederPath, DEMO_STORE);
    console.log();
  }

  console.log('[2/5] overlaying adjudication prompt pack …');
  const basePrompts = yaml.load(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  const prompts = overlayPrompts(basePrompts, domain.promptPack);
  // Determinism wrapper, then I/O seal: every LLM call (graph nodes AND the
  // post-graph projections) is hash-chained into a tamper-evident log.
  const { client: llm, seal } = withIoSeal(
    withDeterminism(createLLMClient({ provider: opts.provider, model: opts.model }), { temperature: 0, seed: 1 }),
  );

  console.log('[3/5] running adjudication graph (real LLM) …');
  const knowledgePack = JSON.parse(fs.readFileSync(domain.knowledgePath, 'utf8'));
  const framing = domain.framing(caseInfo.caseId);

  const initialState = {
    originalQuery: framing,
    context: caseInfo.packet,
    iteration: 0,
    config: { maxIterations: 2, confidenceThreshold: 0.8 },
    caseEvidence: caseInfo.evidence,
    knowledgePack,
    caseClassification: domain.classification,
    citationPackSubdir: domain.citationPackSubdir,
  };

  const registryWrapper = { get: (id) => nodeRegistry.getNode(id) };
  const state = await runLinearGraph(irgGraphRegEAdjudication, initialState, llm, prompts, registryWrapper);

  const draftResponse = state.draftResult?.response || state.currentDraft || '';
  const references = Array.isArray(state.references) ? state.references : [];
  const recall = state.caseRecallResult || {};
  const category = state.caseCategory || state.regEErrorCategory || null;
  console.log(`        nodes: ${state.nodes?.length || 0}  ·  references: ${references.length}  ·  rules selected: ${(recall.regulation_rule_ids || []).length}`);

  console.log('[4/5] projecting decision artifact + output document …');
  const decision = await llmJson(llm, domain.buildDecisionPrompt({
    caseInfo, draftResponse, references, recall, category,
  }), { node: `${domain.caseIdPrefix}DecisionProjection` });

  const outputDoc = await llmText(llm, domain.buildOutputDocPrompt({
    caseInfo, decision, references, category,
  }), { node: `${domain.caseIdPrefix}OutputDoc` });

  console.log('[5/5] writing artifacts …');
  const sessionId = `${domain.id}-${caseInfo.caseId}-${Date.now()}`;
  const traceDoc = formatTrace(state, {
    sessionId,
    query: framing,
    context: caseInfo.packet,
    model: `${opts.provider}/${opts.model}`,
    graph: domain.id,
  });

  const provenance = buildProvenance({
    runId: traceDoc.session_id || sessionId,
    provider: opts.provider,
    model: opts.model,
    determinism: { temperature: 0, seed: 1 },
    runnerPath: path.resolve(domain.dirname, 'adjudicate.js'),
    promptsPath: PROMPTS_PATH,
    promptPackPath: path.resolve(domain.dirname, 'lib', 'prompt-pack.js'),
    graphPath: GRAPH_PATH,
    extraNodePaths: [
      path.resolve(__dirname, '..', '..', 'core', 'nodes', 'classify-case-node.js'),
      path.resolve(__dirname, '..', '..', 'core', 'nodes', 'case-recall-node.js'),
    ],
    knowledgePath: domain.knowledgePath,
    repoRoot: REPO_ROOT,
  });

  const outputKey = domain.outputDocKey || 'notice_letter';
  // Seal every model call made during this run (graph + projections) into the
  // provenance block — a tamper-evident, hash-linked log.
  provenance.io_seal = finalizeSeal(seal);

  traceDoc.references = references;
  traceDoc.citation_quality = state.citationQualityResult || null;
  traceDoc.provenance = provenance;
  traceDoc.adjudication = {
    case_id: caseInfo.caseId,
    domain: domain.id,
    decision,
    classification: category,
    reg_e_category: category, // back-compat field the navigator UI reads
    [outputKey]: outputDoc,
    notice_letter: outputDoc, // UI renders this key as the "output document"
    artifacts: Array.isArray(caseInfo.artifacts) && caseInfo.artifacts.length
      ? caseInfo.artifacts
      : [{
          id: 'case-packet',
          name: path.basename(caseInfo.filepath),
          type: 'markdown',
          role: 'evidence-packet',
          size_bytes: Buffer.byteLength(caseInfo.packet, 'utf8'),
          content: caseInfo.packet,
        }],
  };

  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.trace.json`), JSON.stringify(traceDoc, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.decision.json`), JSON.stringify(decision, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${caseInfo.caseId}.output.md`), outputDoc);

  // ---- console summary ----
  console.log();
  console.log('--------------------------------------------------------');
  console.log('DECISION ARTIFACT');
  console.log('--------------------------------------------------------');
  const rows = domain.summarize ? domain.summarize(decision) : Object.entries(decision).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  for (const [label, value] of rows) console.log(`  ${label.padEnd(16)} ${value}`);

  console.log();
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.trace.json')));
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.decision.json')));
  console.log('[saved]', path.relative(process.cwd(), path.join(OUT_DIR, caseInfo.caseId + '.output.md')));

  return { traceDoc, decision, outputDoc };
}

module.exports = { runAdjudication, parseEvidenceIndex, llmJson, llmText };
