import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getIrgHostBase } from '@/lib/irg-host';

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';
  let url: string;
  try {
    url = `${getIrgHostBase()}/fact-store/sweep${dryRun ? '?dry_run=1' : ''}`;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  try {
    const res = await fetch(url, { method: 'POST', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Upstream /fact-store/sweep failed', status: res.status, detail: data },
        { status: 502 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reach IRG API', details: String(error) },
      { status: 502 }
    );
  }
}
