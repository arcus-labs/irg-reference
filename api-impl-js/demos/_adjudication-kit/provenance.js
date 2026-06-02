'use strict';

/**
 * Provenance capture for a Reg E adjudication run.
 *
 * Produces an immutable record of WHAT ran, against WHICH CODE, with WHICH
 * MODEL and PROMPTS, so that an examiner can verify the trace was produced by
 * the artifact the institution claims (and could, in principle, re-run it
 * against the pinned artifacts). This is the substrate of the §SR 11-7 /
 * NIST AI RMF / OCC 2023-17 governance story.
 *
 * What it captures (best-effort, no network):
 *   - run.timestamp / run.run_id
 *   - run.determinism (temperature, seed, top_p)
 *   - model.provider, model.model_id  (vendor snapshot id when available)
 *   - code.git_sha + code.git_branch + code.dirty
 *   - artifacts: SHA-256 of every file that materially shapes the reasoning
 *       (prompt-pack, base prompts YAML, graph definition, classifyCase node,
 *        caseRecall node, the runner itself, the rule-citation pack)
 *
 * The hash function is deliberately the boring kind (sha256 of file bytes) —
 * an examiner with a checkout can re-hash and compare without trusting any
 * special tool.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function sha256OfFile(filepath) {
  try {
    const buf = fs.readFileSync(filepath);
    return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function gitInfo(repoDir) {
  const out = {};
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
  };
  out.git_sha = run('git rev-parse HEAD');
  out.git_short_sha = out.git_sha ? out.git_sha.slice(0, 12) : null;
  out.git_branch = run('git rev-parse --abbrev-ref HEAD');
  const status = run('git status --porcelain');
  out.dirty = status ? status.length > 0 : null;
  return out;
}

/**
 * Build a provenance record.
 * @param {Object} opts
 * @param {string} opts.runId         — a stable id for this run
 * @param {string} opts.provider      — e.g. 'groq'
 * @param {string} opts.model         — e.g. 'openai/gpt-oss-20b'
 * @param {Object} opts.determinism   — { temperature, seed, top_p? }
 * @param {string} opts.runnerPath    — absolute path to adjudicate.js
 * @param {string} opts.promptsPath   — absolute path to prompts.yaml (base)
 * @param {string} opts.promptPackPath — absolute path to prompt-pack.js (overlay)
 * @param {string} opts.graphPath     — absolute path to the graph definition
 * @param {string[]} [opts.extraNodePaths] — additional node files worth hashing
 * @param {string} opts.knowledgePath — absolute path to reg-e-knowledge-pack.json
 * @param {string} opts.repoRoot      — absolute path to the repo root (for git)
 */
function buildProvenance(opts) {
  const {
    runId, provider, model, determinism,
    runnerPath, promptsPath, promptPackPath, graphPath,
    extraNodePaths = [], knowledgePath, repoRoot,
  } = opts;

  const artifacts = {
    runner:        { path: relTo(repoRoot, runnerPath),       sha: sha256OfFile(runnerPath) },
    base_prompts:  { path: relTo(repoRoot, promptsPath),      sha: sha256OfFile(promptsPath) },
    prompt_pack:   { path: relTo(repoRoot, promptPackPath),   sha: sha256OfFile(promptPackPath) },
    graph:         { path: relTo(repoRoot, graphPath),        sha: sha256OfFile(graphPath) },
    knowledge_pack:{ path: relTo(repoRoot, knowledgePath),    sha: sha256OfFile(knowledgePath) },
  };
  extraNodePaths.forEach((p, i) => {
    const key = `node_${path.basename(p, path.extname(p)).replace(/[^a-z0-9]/gi, '_')}`;
    artifacts[key] = { path: relTo(repoRoot, p), sha: sha256OfFile(p) };
  });

  return {
    run: {
      run_id: runId,
      timestamp: new Date().toISOString(),
      determinism,
      reproducibility_note: 'Identical input + identical artifacts (above SHAs) + same provider model snapshot → byte-equal trace, modulo vendor-side non-determinism. Groq honors `seed` on best-effort basis.',
    },
    model: {
      provider,
      model_id: model,
      snapshot_id: null,
      snapshot_id_note: 'Vendor-side immutable snapshot ID. Most hosted providers do not expose one; pin via vendor SLA or self-host weights for true reproducibility.',
    },
    code: gitInfo(repoRoot),
    artifacts,
  };
}

function relTo(root, p) {
  if (!p) return null;
  try { return path.relative(root, p); } catch { return p; }
}

module.exports = { buildProvenance, sha256OfFile, gitInfo };
