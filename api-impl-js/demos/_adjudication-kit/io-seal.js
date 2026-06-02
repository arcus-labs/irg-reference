'use strict';

/**
 * I/O sealing layer.
 *
 * Wraps an LLM client so every `call(prompt, opts)` records a tamper-evident
 * entry: the SHA-256 of the prompt bytes, the SHA-256 of the response bytes,
 * and a chain hash that folds in the previous entry's chain hash. The result
 * is a hash-linked log (a degenerate Merkle/blockchain) of the entire model
 * conversation for one adjudication run.
 *
 * Why this matters (the regulator story): true reproducibility against a
 * hosted model is hard (vendors rarely expose immutable snapshots). The seal
 * answers a DIFFERENT, achievable question — "is this an unforgeable record
 * of exactly what the model was asked and what it answered?" Any later edit
 * to a prompt or response in the trace breaks the chain at that point and
 * every entry after it, so tampering is detectable by recomputing the chain.
 *
 * This is provider-independent: it works on top of Groq, Together, Azure, a
 * self-hosted model, anything. Pair it with a TEE attestation (proves WHICH
 * model ran) or an RFC-3161 timestamp on the chain root (proves WHEN) for the
 * full governance package.
 *
 * Verification (an examiner re-runs this offline against the trace):
 *   prev = genesis
 *   for each entry in order:
 *     assert entry.prev_hash === prev
 *     assert entry.chain_hash === sha256(prev + prompt_sha256 + response_sha256)
 *     prev = entry.chain_hash
 *   assert prev === seal.chain_root
 */

const crypto = require('crypto');

function sha256Hex(input) {
  const buf = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(buf, 'utf8').digest('hex');
}

const GENESIS = 'sha256:' + sha256Hex('IRG-IO-SEAL-GENESIS-v1');

/**
 * Wrap an LLM client with a hash-chained seal recorder.
 * @returns {{ client: object, seal: object }} `client` is a drop-in
 *   replacement for `llm`; `seal` accumulates entries and is finalized later.
 */
function withIoSeal(llm) {
  const entries = [];
  let prev = GENESIS;

  const seal = {
    algorithm: 'sha256-chain',
    description: 'Hash-linked log of every LLM call. chain_hash[n] = sha256(chain_hash[n-1] + prompt_sha256[n] + response_sha256[n]); chain_hash[-1] is the genesis constant.',
    genesis: GENESIS,
    entries,
    // chain_root / call_count are filled by finalizeSeal()
  };

  const client = {
    ...llm,
    call: async (prompt, opts = {}) => {
      const resp = await llm.call(prompt, opts);
      const content = typeof resp === 'object' && resp !== null ? resp.content : resp;
      const promptSha = 'sha256:' + sha256Hex(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
      const responseSha = 'sha256:' + sha256Hex(typeof content === 'string' ? content : JSON.stringify(content ?? ''));
      const chain = 'sha256:' + sha256Hex(prev + promptSha + responseSha);
      entries.push({
        seq: entries.length + 1,
        node: opts.node || null,
        timestamp: new Date().toISOString(),
        prompt_bytes: Buffer.byteLength(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), 'utf8'),
        response_bytes: Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content ?? ''), 'utf8'),
        prompt_sha256: promptSha,
        response_sha256: responseSha,
        prev_hash: prev,
        chain_hash: chain,
      });
      prev = chain;
      return resp;
    },
  };

  return { client, seal };
}

/** Finalize: stamp call_count + chain_root. Returns the same seal object. */
function finalizeSeal(seal) {
  seal.call_count = seal.entries.length;
  seal.chain_root = seal.entries.length ? seal.entries[seal.entries.length - 1].chain_hash : seal.genesis;
  seal.sealed_at = new Date().toISOString();
  return seal;
}

/**
 * Independently verify a seal (used by tests / examiner tooling). Recomputes
 * the chain from genesis and checks every link + the root.
 * @returns {{ ok: boolean, brokenAt: number|null, reason: string|null }}
 */
function verifySeal(seal) {
  if (!seal || !Array.isArray(seal.entries)) return { ok: false, brokenAt: null, reason: 'no seal' };
  let prev = seal.genesis || GENESIS;
  for (const e of seal.entries) {
    if (e.prev_hash !== prev) return { ok: false, brokenAt: e.seq, reason: 'prev_hash mismatch' };
    const expect = 'sha256:' + sha256Hex(prev + e.prompt_sha256 + e.response_sha256);
    if (e.chain_hash !== expect) return { ok: false, brokenAt: e.seq, reason: 'chain_hash mismatch' };
    prev = e.chain_hash;
  }
  if (seal.chain_root && seal.chain_root !== prev) return { ok: false, brokenAt: null, reason: 'chain_root mismatch' };
  return { ok: true, brokenAt: null, reason: null };
}

module.exports = { withIoSeal, finalizeSeal, verifySeal, sha256Hex, GENESIS };
