# Contributing to IRG Reference

Thanks for your interest. This repository is the open reference implementation of Iterative Reasoning Graphs (IRG) — a JavaScript runtime, a trace viewer, and supporting design notes. Contributions are welcome.

By submitting a contribution you agree that it is licensed under the same terms as the rest of the repository: **CC BY-SA 4.0**.

## Ways to contribute

- **File an issue** — bugs, broken examples, unclear docs, missing edge cases.
- **Submit a pull request** — fixes, new providers, better tests, doc updates.
- **Write or refine docs** — the `_docs/` folder is intentionally protocol-shaped and benefits from precise prose.

## Before opening a PR

1. **Discuss large changes first.** Open an issue describing the change you want to make so we can agree on direction before you spend time on implementation. Small fixes can go straight to a PR.

2. **Keep PRs focused.** One concern per PR. If you find yourself bundling a refactor with a bug fix, split them.

3. **Don't drop test coverage.** When you change behavior, update or add the test that exercises it. The existing tests live under `api-impl-js/test/` (Node scripts) and `trace-navigator/src/lib/*.test.ts` (Jest).

4. **Don't commit secrets.** `.env` is gitignored; double-check before pushing.

## Local development

```bash
# API
cd api-impl-js
npm install
npm run api

# Trace Navigator
cd trace-navigator
npm install
npm run dev
```

Required: Node.js 20+, plus an API key for at least one supported LLM provider. See `.env.example` at the repo root.

## Running tests

```bash
# API tests
cd api-impl-js
npm test

# Trace Navigator tests
cd trace-navigator
npm test
```

## Code style

- The Node side is plain CommonJS, no transpiler. Match the existing pattern (e.g. `'use strict'` at the top, `module.exports`).
- The Next.js side uses TypeScript and Tailwind. Match the surrounding component conventions.
- No build step beyond what `npm` already does — keep it that way unless there's a strong reason.

## Adding a new LLM provider

1. Create `api-impl-js/core/llm/providers/<name>.js`.
2. Export a class with `call(prompt, opts) → { content, usage }`.
3. Set the static fields: `providerName`, `envKey`, `modelPrefixes`, `defaultModel`, `curatedModels`.
4. Register it in `api-impl-js/core/llm/provider-registry.js` by adding to `ALL_PROVIDERS`.
5. Document the new env var in `.env.example`.
6. Submit a PR with at least one real-API smoke test result in the description.

For OpenAI-compatible endpoints (most providers), extend `OpenAICompatibleClient`. For native APIs (like Anthropic and Google), implement directly.

## Reporting security issues

Don't open a public issue. See `SECURITY.md`.

## Code of conduct

Be kind. Critique work, not people. We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Behavior that makes the project less welcoming to others may result in a request to step away from the project.
