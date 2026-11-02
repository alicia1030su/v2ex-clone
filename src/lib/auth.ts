import 'server-only';
import { cookies, headers } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export { hashPassword, verifyPassword } from './password';

const SESSION_COOKIE = 'v2_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 天

export type SessionUser = {
  id: number;
  username: string;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  balance: number;
  avatar: string | null;
};

export async function createSession(userId: number): Promise<string> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const hdrs = await headers();
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: hdrs.get('user-agent'),
    ip:
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      hdrs.get('x-real-ip') ??
      '127.0.0.1',
  });
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      status: schema.users.status,
      balance: schema.users.balance,
      avatar: schema.users.avatar,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  if (row.status !== 'active') return null;

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    balance: row.balance,
    avatar: row.avatar,
  };
}

export function isStaff(user: SessionUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'moderator';
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'admin';
}

/** 用于 CSRF 校验：基于会话 ID 的哈希 */
export async function csrfTokenFor(sessionId: string): Promise<string> {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  return createHash('sha256')
    .update(`${sessionId}:${secret}`)
    .digest('hex');
}
