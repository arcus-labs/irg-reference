import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { isEmailAllowed } from '@/lib/access-control';
import { authOptions } from '@/lib/auth-options';

export async function requireApiSession() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}