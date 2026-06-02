import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

function xrayDir(): string {
  return path.resolve(process.cwd(), '..', 'api-impl-js', 'demos', 'xray');
}

/**
 * GET /api/xray/samples/[id] — return the sample's form fields + its image
 * inlined as base64 so the page can pre-fill the form and attach the file in
 * one request.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id || !SLUG_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sample id' }, { status: 400 });
  }

  let manifest: any;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(xrayDir(), 'samples', `${id}.json`), 'utf8'));
  } catch {
    return NextResponse.json({ error: 'Sample not found' }, { status: 404 });
  }

  const imageName = String(manifest.image || '');
  if (!imageName || !SLUG_RE.test(imageName)) {
    return NextResponse.json({ error: 'Sample image missing or invalid' }, { status: 400 });
  }

  let imageBase64: string;
  try {
    const buf = await fs.readFile(path.join(xrayDir(), 'sample-images', imageName));
    imageBase64 = buf.toString('base64');
  } catch {
    return NextResponse.json({ error: 'Sample image file not found' }, { status: 404 });
  }

  const ext = path.extname(imageName).toLowerCase();
  return NextResponse.json({
    id: manifest.id || id,
    label: manifest.label || id,
    fields: manifest.fields || {},
    image: { filename: imageName, mime: MIME[ext] || 'image/jpeg', base64: imageBase64 },
  });
}
