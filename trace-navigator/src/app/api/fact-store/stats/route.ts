import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getIrgHostBase } from '@/lib/irg-host';

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  let url: string;
  try {
    url = `${getIrgHostBase()}/fact-store/stats`;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Upstream /fact-store/stats failed', status: res.status, detail: data },
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
