# Trace Navigator

A Next.js app for submitting queries to the IRG API and exploring the resulting reasoning traces. Renders each node of the graph as an interactive timeline with color-coded steps, confidence scores, diffs across iterations, and structured markdown output.

## Local development

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:2000`. Production defaults use port `3000`.

You'll also need the IRG API server running (see `../api-impl-js/IRG_API.md`) — by default at `http://localhost:2100`.

## Required environment variables

Create a `.env.local` (or set them in your deployment environment):

```env
# Where the trace navigator forwards user queries
IRG_ENDPOINT=http://localhost:2100/webhook/irg-process

# Google OAuth
NEXTAUTH_URL=http://localhost:2000
NEXTAUTH_SECRET=<random-string>
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>

# Access allowlist — REQUIRED for anyone to be able to sign in.
# Set at least one of the following. Comma-separated, case-insensitive.
TRACE_NAVIGATOR_ALLOWED_DOMAINS=example.com,partner.org
TRACE_NAVIGATOR_ALLOWED_EMAILS=specific.user@gmail.com
```

**Important:** if neither `TRACE_NAVIGATOR_ALLOWED_DOMAINS` nor `TRACE_NAVIGATOR_ALLOWED_EMAILS` is set, **no one will be able to sign in**. This is intentional — it prevents an open deployment from accepting any Google account by default.

## Tests

```bash
npm test
```

## Build

```bash
npm run build
npm start
```
