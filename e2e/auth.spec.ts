import { test, expect } from '@playwright/test';
import {
  ADMIN,
  USER_A,
  login,
  logout,
  register,
  uniqueName,
  clearRateLimits,
  apiPost,
  waitForHydration,
} from './helpers';

test.describe('账号体系', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('注册后自动登录并可访问设置页', async ({ page }) => {
    const username = uniqueName('reg');
    await register(page, username);

    await page.goto('/settings');
    // 设置页展示当前用户名的位置（只读文本，不是 input）
    await expect(page.locator('#Main')).toContainText(username);
    await expect(page.getByText('退出登录')).toBeVisible();
  });

  test('重复用户名注册被拒绝', async ({ page, browser }) => {
    const username = uniqueName('dup');

    // 第一个浏览器上下文注册成功
    await register(page, username);

    // 第二个独立上下文（未登录）尝试注册同名账号
    const ctx = await browser.newContext();
    const second = await ctx.newPage();
    await second.goto('/signup');
    // 同「错误密码」用例：必须等水合，否则原生表单提交会重载页面
    await waitForHydration(second, 'button[type="submit"]');
    await second.fill('#username', username);
    await second.fill('#password', 'password123');
    await second.fill('#confirm', 'password123');
    await second.click('button[type="submit"]');

    await expect(second.locator('#problem')).toContainText('已被使用');
    await ctx.close();
  });

  test('短密码注册被拒绝', async ({ page }) => {
    await page.goto('/signup');
    // 同「错误密码」用例：必须等水合
    await waitForHydration(page, 'button[type="submit"]');
    await page.fill('#username', uniqueName('short'));
    await page.fill('#password', '123');
    await page.fill('#confirm', '123');
    await page.click('button[type="submit"]');

    await expect(page.locator('#problem')).toContainText('至少 8 位');
  });

  test('错误密码登录失败并给出提示', async ({ page }) => {
    await page.goto('/signin');
    /*
     * ⚠️ v0.0.10：**必须**先等水合（CI 实测 firefox/1280x900 分片偶发失败）。
     *
     * 失败现象：`#problem` 元素 10 秒内始终不存在（`element(s) not found`）。
     * 根因：`SignInForm` 是客户端组件，`onSubmit` 由 React 绑定。若在
     * `hydrateRoot` 完成**之前**点击提交，浏览器会走**原生表单提交** ——
     * 该 `<form>` 没有 `action`，于是重新加载 `/signin` 自身，
     * 服务端永远收不到错误密码，`#problem` 自然不出现。
     *
     * 这不是产品缺陷（水合完成后一切正常），而是**测试与水合的竞态**：
     * 本机的 chromium 够快，CI 上 firefox + 多分片并行时就可能慢过临界点。
     * 断言本身**没有放宽**：仍然要求出现「用户名或密码不正确」。
     */
    await waitForHydration(page, 'button[type="submit"]');
    await page.fill('#username', USER_A.username);
    await page.fill('#password', 'definitely-wrong-password');
    await page.click('button[type="submit"]');

    await expect(page.locator('#problem')).toContainText('用户名或密码不正确');
  });

  test('登录后导航栏显示用户名，退出后恢复游客态', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    await expect(page.locator('.site-nav .tools')).toContainText(USER_A.username);

    await logout(page);
    await expect(page.locator('.site-nav .tools')).toContainText('登录');
    await expect(page.locator('.site-nav .tools')).not.toContainText(USER_A.username);
  });

  test('未登录访问受保护页面会跳转到登录页', async ({ page }) => {
    for (const path of ['/settings', '/notifications', '/bookmarks', '/go/new']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/signin\?next=/);
    }
  });

  test('登录限流生效', async ({ page }) => {
    const ip = '127.0.0.1';
    let sawRateLimit = false;

    for (let i = 0; i < 15; i++) {
      const res = await apiPost(page, '/api/auth/signin', { username: `ratelimit_${ip}`, password: 'wrong-password' });
      if (res.status() === 429) {
        sawRateLimit = true;
        expect(res.headers()['retry-after']).toBeTruthy();
        break;
      }
    }

    expect(sawRateLimit, '连续错误登录应触发 429 限流').toBe(true);
  });

  test('管理员账号可访问管理后台，普通用户不可', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);
    await page.goto('/admin');
    await expect(page.locator('#Main')).toContainText('概览');

    await logout(page);

    await login(page, USER_A.username, USER_A.password);
    await page.goto('/admin');
    await expect(page).toHaveURL('/');
  });
});
