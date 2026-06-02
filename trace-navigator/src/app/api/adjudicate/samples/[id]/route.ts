import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireApiSession } from '@/lib/api-auth';
import { resolveDomain } from '@/lib/adjudication-domains';

// Returns the raw content of one sample case so the page can construct a
// File object client-side and attach it to the upload list. The id must be a
// safe slug — `^[\w-]+$` — to keep the lookup confined to the cases dir. The
// demo is selected by the validated ?domain= slug.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function casesDirFor(demoDir: string): string {
  return path.resolve(process.cwd(), '..', 'api-impl-js', 'demos', demoDir, 'cases');
}

const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id || !SLUG_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sample id' }, { status: 400 });
  }

  const domain = resolveDomain(_req.nextUrl.searchParams.get('domain'));
  if (!domain) return NextResponse.json({ error: 'Unknown domain' }, { status: 400 });

  const filename = `${id}.md`;
  const filepath = path.join(casesDirFor(domain.demoDir), filename);
  let content: string;
  try {
    content = await fs.readFile(filepath, 'utf8');
  } catch {
    return NextResponse.json({ error: 'Sample not found' }, { status: 404 });
  }

  return NextResponse.json({
    id,
    filename,
    type: 'markdown',
    size_bytes: Buffer.byteLength(content, 'utf8'),
    content,
  });
}
