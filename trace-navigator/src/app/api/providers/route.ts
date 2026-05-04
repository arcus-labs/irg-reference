import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getRequiredServerEnv } from '@/lib/server-env';

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  // Derive the IRG host from the configured webhook endpoint, then hit
  // /providers on the same host. This keeps configuration single-sourced.
  const irgEndpoint = getRequiredServerEnv('IRG_ENDPOINT');
  const providersUrl = (() => {
    try {
      const u = new URL(irgEndpoint);
      return `${u.protocol}//${u.host}/providers`;
    } catch {
      return null;
    }
  })();

  if (!providersUrl) {
    return NextResponse.json(
      { error: 'IRG_ENDPOINT is not a valid URL' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(providersUrl, { cache: 'no-store' });
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
