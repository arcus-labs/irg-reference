import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getCase } from '@/lib/xray/case-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/xray/cases/[id] — fetch a single X-ray case */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid case id' }, { status: 400 });
    }
    const xrayCase = getCase(id);
    if (!xrayCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    return NextResponse.json({ case: xrayCase });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get case', details: String(error) }, { status: 500 });
  }
}
