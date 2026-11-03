import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * 显式 CSRF 防护（双提交 Cookie 模式）
 *
 * 原实现仅依赖 SameSite=Lax Cookie + 会话校验，属于纵深防御的一层，
 * 但缺少显式的 CSRF token 校验。本次补齐为标准双提交模式：
 *
 *  1. 服务端在会话 Cookie 旁下发一个不可读的 csrf Cookie（随机值）
 *  2. 页面渲染时把同一个 token 放进表单隐藏字段 / 请求头
 *  3. 写操作时校验：请求头或表单字段中的 token 必须与 Cookie 中的值一致
 *
 * 双提交模式的依据：攻击者无法读取目标站点的 Cookie（Same-Origin Policy），
 * 因此无法构造出携带正确 token 的跨站请求。
 */

const CSRF_COOKIE = 'v2_csrf';

/** 生成 CSRF token */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** 读取当前 CSRF Cookie 值 */
export async function getCsrfCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? null;
}

/**
 * 读取当前请求的 CSRF Cookie 值（只读，不修改 Cookie）。
 *
 * 服务端组件用它给原生 HTML 表单注入隐藏字段 ——
 * 原生表单无法像 fetch 那样自动加请求头，必须通过隐藏字段传递 token。
 */
export async function readCsrfToken(): Promise<string> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? '';
}

/**
 * 校验请求携带的 CSRF token。
 *
 * @param request 待校验请求
 * @returns 通过返回 true
 */
export async function verifyCsrf(request: Request): Promise<boolean> {
  const cookieToken = await getCsrfCookie();
  if (!cookieToken) return false;

  // 优先从请求头取（fetch/XHR），其次从表单字段取
  const headerToken =
    request.headers.get('x-csrf-token') ??
    request.headers.get('x-xsrf-token') ??
    null;

  let formToken: string | null = null;
  if (!headerToken) {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      // JSON 请求体：由调用方在 JSON 中携带 csrfToken 字段
      formToken = null;
    } else {
      const form = await getFormData(request);
      formToken = form?.get('csrfToken')?.toString() ?? null;
    }
  }

  const provided = (headerToken ?? formToken ?? '').trim();
  if (!provided) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(cookieToken, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 已解析请求体的缓存。
 *
 * Request 的 body 只能读取一次。CSRF 校验会读取表单体，
 * 业务处理器随后还要再读一次 —— 直接调用 request.formData()
 * 会抛出 "Body is unusable: Body has already been read"。
 *
 * 这里用 WeakMap 按 Request 实例缓存解析结果，
 * 让 CSRF 校验与业务处理共享同一份数据。
 */
const formDataCache = new WeakMap<Request, Promise<FormData | null>>();

/** 读取（并缓存）请求的表单数据 */
export async function getFormData(request: Request): Promise<FormData | null> {
  let cached = formDataCache.get(request);
  if (!cached) {
    cached = request.formData().catch(() => null);
    formDataCache.set(request, cached);
  }
  return cached;
}

/** 校验失败时返回 403 */
export function csrfForbidden() {
  return new Response(
    JSON.stringify({ ok: false, error: 'CSRF 校验失败，请刷新页面后重试' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
