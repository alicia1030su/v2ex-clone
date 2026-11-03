import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { cookies } from 'next/headers';
import { destroySession, clearSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const store = await cookies();
  const sessionId = store.get('v2_session')?.value;
  if (sessionId) await destroySession(sessionId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: '/' });
}
