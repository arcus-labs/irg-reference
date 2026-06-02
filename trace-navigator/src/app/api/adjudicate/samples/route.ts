import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireApiSession } from '@/lib/api-auth';
import { resolveDomain } from '@/lib/adjudication-domains';

// Lists the canned sample cases shipped with an adjudication demo. Driven by
// directory listing so a new sample (added under
// api-impl-js/demos/<demoDir>/cases/<id>.md) appears in the UI automatically.
// The demo is selected by the validated ?domain= slug.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function casesDirFor(demoDir: string): string {
  return path.resolve(process.cwd(), '..', 'api-impl-js', 'demos', demoDir, 'cases');
}

function deriveMetadata(content: string, id: string): { label: string; description: string } {
  // Title — first `# ` heading.
  const titleLine = content.split('\n').find((l) => l.startsWith('# '));
  const label = titleLine ? titleLine.replace(/^#\s+/, '').trim() : id;

  // Description — pull the first `**Disputed amount:**` line if present;
  // otherwise the first non-empty content line after the title.
  let description = '';
  const stripBold = (s: string) => s.replace(/\*\*/g, '').trim();
  for (const line of content.split('\n')) {
    if (/disputed amount/i.test(line)) {
      description = stripBold(line).slice(0, 240);
      break;
    }
  }
  if (!description) {
    const after = content.split(/^# .*$/m)[1] || '';
    const para = after.split('\n').find((l) => l.trim() && !l.startsWith('**Status:**'));
    if (para) description = stripBold(para).slice(0, 240);
  }
  return { label, description };
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const domain = resolveDomain(req.nextUrl.searchParams.get('domain'));
  if (!domain) return NextResponse.json({ samples: [] });
  const CASES_DIR = casesDirFor(domain.demoDir);

  let entries: string[];
  try {
    entries = await fs.readdir(CASES_DIR);
  } catch {
    return NextResponse.json({ samples: [] });
  }

  const samples = await Promise.all(
    entries
      .filter((e) => e.endsWith('.md'))
      .sort()
      .map(async (filename) => {
        const id = filename.replace(/\.md$/, '');
        const fp = path.join(CASES_DIR, filename);
        const [stat, content] = await Promise.all([fs.stat(fp), fs.readFile(fp, 'utf8')]);
        const { label, description } = deriveMetadata(content, id);
        return {
          id,
          filename,
          label,
          description,
          size_bytes: stat.size,
        };
      }),
  );

  return NextResponse.json({ samples });
}
