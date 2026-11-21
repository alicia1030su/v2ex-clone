import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { guardCsrf } from '@/lib/csrf-guard';
import { getSessionUser } from '@/lib/auth';
import { guardCommunityAction } from '@/lib/community-rate-limit';
import {
  parseReplyDisplayMode,
  parseThemePreference,
  updateUserPreferences,
  getUserPreferences,
} from '@/server/reply-preferences';

export const dynamic = 'force-dynamic';

const THEME_COOKIE = 'v2_theme';
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function secureCookie(): boolean {
  const forwarded = process.env.FORWARDED_PROTO?.split(',')[0]?.trim();
  if (forwarded) return forwarded === 'https';
  const appUrl = (process.env.APP_URL ?? process.env.PUBLIC_BASE_URL ?? '').trim();
  return appUrl.startsWith('https://');
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const preferences = await getUserPreferences(user.id);
  return NextResponse.json({ ok: true, preferences });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }
  const csrfDenied = await guardCsrf(request);
  if (csrfDenied) return csrfDenied;
  const limited = await guardCommunityAction('profile_update', user.id);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    replyDisplayMode?: unknown;
    themePreference?: unknown;
  } | null;
  const replyDisplayMode = body?.replyDisplayMode === undefined
    ? undefined
    : parseReplyDisplayMode(body.replyDisplayMode);
  const themePreference = body?.themePreference === undefined
    ? undefined
    : parseThemePreference(body.themePreference);
  if (body?.replyDisplayMode !== undefined && !replyDisplayMode) {
    return NextResponse.json({ ok: false, error: '回复展示模式无效' }, { status: 400 });
  }
  if (body?.themePreference !== undefined && !themePreference) {
    return NextResponse.json({ ok: false, error: '主题偏好无效' }, { status: 400 });
  }
  if (!replyDisplayMode && !themePreference) {
    return NextResponse.json({ ok: false, error: '没有需要更新的偏好' }, { status: 400 });
  }

  const preferences = await updateUserPreferences(user.id, {
    ...(replyDisplayMode ? { replyDisplayMode } : {}),
    ...(themePreference ? { themePreference } : {}),
  });

  if (themePreference) {
    const store = await cookies();
    store.set(THEME_COOKIE, themePreference, {
      httpOnly: false,
      sameSite: 'lax',
      secure: secureCookie(),
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE,
    });
  }

  return NextResponse.json({ ok: true, preferences });
}
