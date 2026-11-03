import { Page, expect } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'admin12345' };
export const USER_A = { username: 'lisi', password: 'password123' };
export const USER_B = { username: 'wangwu', password: 'password123' };
export const MODERATOR = { username: 'moderator', password: 'password123' };

/**
 * 清理限流计数。
 *
 * 限流是按 IP + 账号 / 用户 ID 计数的，测试连续运行会累积配额；
 * 每个需要写操作的测试组开始前调用，保证测试之间互不干扰。
 *
 * 调试端点需要令牌鉴权（见 src/lib/debug-auth.ts）。
 * 未配置 DEBUG_ENDPOINT_TOKEN 时静默跳过 —— 用例本身不依赖清理动作。
 */
export async function clearRateLimits(page: Page) {
  const token = process.env.DEBUG_ENDPOINT_TOKEN;
  if (!token) return;
  await page.request.post('/api/debug/reset-rate-limits', {
    headers: { 'x-debug-token': token },
  });
}

/** 从浏览器上下文读取 CSRF Cookie 的值 */
export async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === 'v2_csrf');
  return c?.value ?? '';
}

/**
 * 发起带 CSRF token 的 API 请求。
 *
 * 未携带 token 时服务端返回 403 —— 这正是 CSRF 防护的预期行为。
 * 用例若要验证"有 token 时放行"，必须走本 helper。
 */
export async function apiPost(
  page: Page,
  path: string,
  data: unknown,
  opts: { withCsrf?: boolean } = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.withCsrf !== false) {
    let token = await getCsrfToken(page);
    if (!token) {
      // CSRF Cookie 由 middleware 在页面响应时下发；
      // 若尚未访问过页面，先访问一次以取得 Cookie。
      // goto 可能因并发导航被中断，忽略该错误后重试读取 Cookie。
      await page.goto('/').catch(() => undefined);
      token = await getCsrfToken(page);
    }
    if (token) headers['x-csrf-token'] = token;
  }
  return page.request.post(path, { headers, data });
}

/**
 * 通过 UI 登录（走真实表单与 API，不走 cookie 注入）。
 *
 * 验证码说明：
 *  - 隔离测试环境（APP_RUNTIME_ENV=test 且 TEST_ENV_ISOLATED=1）下，
 *    登录页**不渲染**验证码输入框，因此可自动化。
 *  - 其他环境（生产/预发）登录页渲染并强制校验验证码，
 *    自动化无法解出图片内容 —— 该场景由生产模式专项测试覆盖。
 */
export async function login(page: Page, username: string, password: string) {
  await page.goto('/signin');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** 注册一个新用户（唯一用户名） */
export async function register(page: Page, username: string, password = 'password123') {
  await page.goto('/signup');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.fill('#confirm', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

export async function logout(page: Page) {
  await page.goto('/settings');
  const btn = page.getByRole('button', { name: '退出登录' });
  if (await btn.count()) {
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 }),
      btn.click(),
    ]);
  }
}

/** 唯一用户名，避免并发测试冲突 */
export function uniqueName(prefix = 'e2e') {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}
