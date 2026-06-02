import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { requireApiSession } from '@/lib/api-auth';
import { resolveDomain } from '@/lib/adjudication-domains';

// Node runtime — we spawn the adjudication runner as a child process and
// touch the local filesystem. Allow up to 5 minutes; a full live-LLM run is
// 60–180s.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const REPO_ROOT = path.resolve(process.cwd(), '..');
const API_IMPL_JS = path.join(REPO_ROOT, 'api-impl-js');

function sanitizeFilename(name: string): string {
  return (name || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'artifact';
}

function isAllowedExt(name: string): boolean {
  return /\.(md|markdown|txt|csv|json)$/i.test(name);
}

async function newestTraceUnder(dir: string, after: number): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const entries = await fs.readdir(dir);
  const traces = entries.filter((e) => e.endsWith('.trace.json'));
  const stats = await Promise.all(
    traces.map(async (f) => ({ f, m: (await fs.stat(path.join(dir, f))).mtimeMs })),
  );
  // Only count files written by the run we just spawned.
  const after5s = after - 5_000;
  const recent = stats.filter((s) => s.m >= after5s).sort((a, b) => b.m - a.m);
  return recent[0]?.f ?? null;
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  // Resolve which domain (Reg E / Reg Z / CFPB / SAR) to run. The slug is
  // validated against the allowlist; only its demoDir touches the filesystem.
  const domainSlug = String(formData.get('domain') || 'adjudication').trim();
  const domain = resolveDomain(domainSlug);
  if (!domain) {
    return NextResponse.json({ error: `Unknown adjudication domain: ${domainSlug}` }, { status: 400 });
  }
  const RUNNER_REL = `demos/${domain.demoDir}/adjudicate.js`;
  const OUTPUT_REL = `demos/${domain.demoDir}/output`;

  const files = formData.getAll('files').filter((v) => v instanceof File) as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: 'Attach at least one evidence file.' }, { status: 400 });
  }
  for (const f of files) {
    if (!isAllowedExt(f.name)) {
      return NextResponse.json({ error: `Unsupported file type: ${f.name} (allowed: .md, .txt, .csv, .json)` }, { status: 400 });
    }
  }
  const caseIdInput = String(formData.get('case_id') || '').trim();

  // Stage uploads to a temp dir so the runner can read them as plain files.
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-e-adj-up-'));
  const artifactPaths: string[] = [];
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const safeName = sanitizeFilename(f.name);
    const dest = path.join(tempRoot, safeName);
    await fs.writeFile(dest, bytes);
    artifactPaths.push(dest);
  }

  const args = [RUNNER_REL, '--artifacts', artifactPaths.join(',')];
  if (caseIdInput) args.push('--case-id', caseIdInput);

  const startedAt = Date.now();
  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(process.execPath, args, { cwd: API_IMPL_JS, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });

  // Cleanup uploaded staging files.
  try { await fs.rm(tempRoot, { recursive: true, force: true }); } catch {}

  if (result.code !== 0) {
    console.error('[adjudicate] runner failed:', result.stderr);
    return NextResponse.json(
      { error: 'Adjudication runner failed', detail: result.stderr.slice(-1200) || result.stdout.slice(-1200) },
      { status: 500 },
    );
  }

  // The runner writes the trace into demos/reg-e-adjudication/output/<caseId>.trace.json.
  // Find the newest one produced during this invocation and copy it into the
  // navigator's traces folder so the trace detail page can load it.
  const outDir = path.join(API_IMPL_JS, OUTPUT_REL);
  const newest = await newestTraceUnder(outDir, startedAt);
  if (!newest) {
    return NextResponse.json({ error: 'Adjudication ran but no trace artifact was found.' }, { status: 500 });
  }
  const caseId = newest.replace(/\.trace\.json$/, '');
  const destName = `${domain.tracePrefix}-${caseId}.json`;
  const navTracesDir = path.join(process.cwd(), 'traces');
  await fs.mkdir(navTracesDir, { recursive: true });
  await fs.copyFile(path.join(outDir, newest), path.join(navTracesDir, destName));

  return NextResponse.json({ success: true, filename: destName, caseId, durationMs: Date.now() - startedAt });
}
