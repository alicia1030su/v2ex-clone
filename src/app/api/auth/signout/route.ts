import { NextResponse } from 'next/server';
import { guardCsrf } from '@/lib/csrf-guard';
import { cookies } from 'next/headers';
import { destroySession, clearSessionCookie } from '@/lib/auth';
import { guardCommunityAction } from '@/lib/community-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;

  const store = await cookies();
  const sessionId = store.get('v2_session')?.value;

  // v0.0.5：退出频率限制（防退出接口被脚本打爆）。
  //
  // ⚠️ 这里用 **sessionId** 而非 userId 作为限流标识 ——
  // 退出接口在销毁会话前就拿不到 userId（`getSessionUser()` 会多查一次库），
  // 而 sessionId 本身已是足够好的「每会话」标识。
  const rl = await guardCommunityAction('signout', null, sessionId ?? undefined);
  if (rl) return rl;

  if (sessionId) await destroySession(sessionId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: '/' });
}
