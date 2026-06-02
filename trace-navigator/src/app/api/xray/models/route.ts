import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { listAllModels } from '@/lib/xray/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/xray/models — list LLM models + which providers are configured */
export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  return NextResponse.json({ models: listAllModels() });
}
