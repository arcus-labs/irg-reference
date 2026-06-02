import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sample X-ray packets ship with the demo at
// api-impl-js/demos/xray/samples/<id>.json. Listed by directory scan so adding
// a new sample needs no code change.
function samplesDir(): string {
  return path.resolve(process.cwd(), '..', 'api-impl-js', 'demos', 'xray', 'samples');
}

/** GET /api/xray/samples — list available sample packets */
export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  let entries: string[];
  try {
    entries = await fs.readdir(samplesDir());
  } catch {
    return NextResponse.json({ samples: [] });
  }

  const samples = await Promise.all(
    entries.filter((e) => e.endsWith('.json')).sort().map(async (filename) => {
      try {
        const raw = await fs.readFile(path.join(samplesDir(), filename), 'utf8');
        const m = JSON.parse(raw);
        return { id: m.id || filename.replace(/\.json$/, ''), label: m.label || m.id, description: m.description || '' };
      } catch {
        return null;
      }
    }),
  );
  return NextResponse.json({ samples: samples.filter(Boolean) });
}
