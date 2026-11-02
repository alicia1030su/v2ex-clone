import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, clearSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const store = await cookies();
  const sessionId = store.get('v2_session')?.value;
  if (sessionId) await destroySession(sessionId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: '/' });
}
