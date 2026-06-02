import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getIrgHostBase } from '@/lib/irg-host';

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  let url: string;
  try {
    url = `${getIrgHostBase()}/providers`;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: 'Upstream /providers failed', status: res.status, detail },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reach IRG API', details: String(error) },
      { status: 502 }
    );
  }
}
