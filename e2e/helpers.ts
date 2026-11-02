import { Page, expect } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'admin12345' };
export const USER_A = { username: 'lisi', password: 'password123' };
export const USER_B = { username: 'wangwu', password: 'password123' };
export const MODERATOR = { username: 'moderator', password: 'password123' };

/**
 * 清理限流计数。
 * 限流是按 IP + 账号 / 用户 ID 计数的，测试连续运行会累积配额；
 * 每个需要写操作的测试组开始前调用，保证测试之间互不干扰。
 */
export async function clearRateLimits(page: Page) {
  const res = await page.request.post('/api/debug/reset-rate-limits');
  if (!res.ok()) {
    // 端点不可用时静默降级（生产环境该端点返回 404）
  }
}

/** 通过 UI 登录（走真实表单与 API，不走 cookie 注入） */
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
