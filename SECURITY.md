# Security

This repository is a **reference implementation**. It is intended to be cloned, run locally, and used as a starting point for building governed reasoning pipelines. It is not hardened for direct exposure to the public internet.

## Operator responsibilities

If you deploy this anywhere reachable from outside your machine, **you** are responsible for:

### Authentication & authorization
- The IRG API server (`api-impl-js`) has no authentication. Anyone who can reach the port can call it.
- The trace navigator has Google OAuth + an email/domain allowlist (`TRACE_NAVIGATOR_ALLOWED_DOMAINS`, `TRACE_NAVIGATOR_ALLOWED_EMAILS`). With no allowlist set, **no one can sign in** — this is intentional. Set the allowlist explicitly before exposing the navigator publicly.

### Rate limiting (none built in)
- **There is no rate limiter on the API server.** A single bad-faith caller can drain your provider quotas (Groq, OpenAI, Anthropic, etc.) — these all bill per token.
- Recommended: put the API server behind a reverse proxy (nginx, Caddy, Cloudflare) with per-IP and per-token rate limits. Match the limits to your provider budgets.
- Consider adding application-level limits if your reverse proxy can't see the request shape (e.g. limit by user, by query length, by provider).

### Cost controls
- Each `/webhook/irg-process` call may make 10+ LLM calls across multiple iterations. Costs add up fast.
- Set hard spending limits with each provider directly (Anthropic, OpenAI, etc. all support this).
- Consider lower-cost provider/model defaults (Groq's free tier, smaller Mistral / Gemini models, or local Ollama) for public-facing deployments.

### Secret handling
- API keys live in `.env` at the repo root. Don't commit them, don't print them, don't pipe them to logs.
- Rotate keys you've shared with collaborators or pasted into chat tools.
- Trace files written to `trace-navigator/traces/` contain the original user query verbatim. If your queries are sensitive, treat the trace store as sensitive data.

### Filesystem write paths
- The fact-check pipeline writes JSON artifacts under `_fact-store/`. Filenames are derived from claim hashes, so untrusted user input does not directly become a path component, but the directory grows unbounded — set up rotation or pruning if you run continuously. The CLI `npm run fact-store -- prune` and the scheduled sweep handle expired citations automatically.
- The citation fetcher writes HTTP responses to `_fact-store/sources/html/` and extracted markdown to `_fact-store/sources/markdown/`. Filenames are SHA-256 hashes of source URLs (no user-controlled path components).
- Trace files write to `trace-navigator/traces/` named by ISO timestamp. Same caveat: prune periodically.

### Outbound HTTP (citation fetcher)
- The `citationFetch` node makes HTTP requests to URLs that the LLM suggested as candidate sources. These URLs are operator-trusted at best — they're whatever the model produced based on the user's question.
- **The fetcher does NOT honor robots.txt.** Operators running this against arbitrary public URLs at scale should add a robots-respecting policy layer before deploying publicly. For reference / research use, the existing defaults (10s timeout, 5 MB cap, 5-redirect limit, identifying User-Agent) are sufficient.
- **Bandwidth.** Each external-facts run can fetch up to ~3 URLs per critical claim. A run with 10 claims and 5 MB caps can pull 150 MB of HTTP traffic. Make sure your egress budget is sized for it.
- **SSRF risk.** The fetcher does not block private IP ranges, localhost, or cloud metadata endpoints (e.g. `169.254.169.254`). If you deploy this on infrastructure that has access to internal services, an attacker can ask a question whose "candidate sources" target those internal endpoints. Either run the fetcher in a sandboxed network namespace, or add a deny-list at the fetcher entry point.

### Prompt injection
- This is a reasoning system. User input flows into LLM prompts by design.
- The graph itself contains an adversary node and an assessor node intended to surface bad reasoning, but **these are not security mechanisms** and should not be treated as such. They will not catch every prompt injection attack.
- Don't grant the IRG access to tools (filesystem, shell, APIs) that you wouldn't want a user to control via a crafted query.

## Reporting a vulnerability

If you find a security issue in this repository:

- **Do not** open a public GitHub issue.
- Email a description to **security@arcusx.ai** with steps to reproduce.
- Allow at least 14 days for a response before disclosing publicly.

We'll acknowledge within 3 business days and aim to ship a fix or mitigation within 30 days for confirmed issues.

## Out of scope

The following are not considered security vulnerabilities for this reference implementation:

- Lack of rate limiting (documented above; operator's responsibility).
- LLM hallucination, jailbreak, or prompt injection of an LLM provider you've configured (report those to the provider).
- DoS via expensive queries (operator's responsibility — see "Cost controls").
- Issues in third-party LLM providers' APIs.
- Issues that require an attacker to already have your `.env` file or write access to your repo.
