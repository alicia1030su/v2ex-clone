import 'server-only';
import { cookies, headers } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { resolveClientIp } from '@/lib/client-ip';

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
    // 信任边界见 src/lib/client-ip.ts（默认不采信可伪造的代理头）
    ip: await resolveClientIp(),
  });
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

/**
 * 当前请求是否走 HTTPS
 *
 * ⚠️ v0.0.5：**不能**用 `NODE_ENV === 'production'` 判定 ——
 *    `next start`（含本地 HTTP 调试、非 HTTPS 部署）也会设
 *    `NODE_ENV=production`。
 *
 *    实测（v0.0.5 跨浏览器）：**WebKit** 在 HTTP 下会**直接拒绝存储**
 *    带 `Secure` 属性的 Cookie（Chromium / Firefox 对 localhost 有放宽），
 *    于是 `document.cookie` 读不到 ⇒ 所有写操作一律 403。
 *
 *    判定依据（按优先级）：
 *      1. `x-forwarded-proto: https`（反代后已是 HTTPS）
 *      2. `NEXTAUTH_URL` / `APP_URL` 是 https（配置层声明）
 *      3. 否则视为 HTTP
 *
 *    ⚠️ 安全影响：HTTP 部署下 Cookie 不带 `Secure` ⇒ 会随明文传输。
 *    这是 HTTP 部署的固有风险（会话 Cookie 同理），
 *    且 `SameSite=Lax` 仍能挡住绝大多数 CSRF。
 *    生产部署应当在**反向代理后用 HTTPS**。
 */
function isHttpsRequest(): boolean {
  // ① 反代声明（部署层最准）
  const forwardedProto = process.env.FORWARDED_PROTO?.split(',')[0]?.trim();
  if (forwardedProto) return forwardedProto === 'https';

  // ② 应用自身的公开地址（配置层声明）
  const appUrl = (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.PUBLIC_BASE_URL ??
    ''
  ).trim();
  if (appUrl.startsWith('https://')) return true;

  // ③ 未声明 ⇒ 视为 HTTP（本地开发 / 内网 HTTP 部署）
  return false;
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(),
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
