import { test, expect } from '@playwright/test';
import { USER_A, USER_B, login, register, uniqueName , clearRateLimits } from './helpers';

test.describe('安全性', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('主题正文中的脚本被执行前被清洗（XSS）', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const payload = '<script>window.__xss__ = true;</script><img src=x onerror="window.__xss2__=true">';
    const res = await page.request.post('/api/topics', {
      data: {
        nodeId: 1,
        title: `XSS 测试主题 ${Date.now()}`,
        content: `正常内容开头。${payload}正常内容结尾。`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const { redirect } = await res.json();

    await page.goto(redirect);
    // 脚本未执行
    const executed = await page.evaluate(() => ({
      a: (window as unknown as { __xss__?: boolean }).__xss__,
      b: (window as unknown as { __xss2__?: boolean }).__xss2__,
    }));
    expect(executed.a).toBeUndefined();
    expect(executed.b).toBeUndefined();

    // script 标签被移除
    const html = await page.locator('.topic_content').innerHTML();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    // 但正文文字保留
    await expect(page.locator('.topic_content')).toContainText('正常内容开头');
  });

  test('回复中的脚本被清洗（XSS）', async ({ page }) => {
    // 使用独立账号，避免与其他测试共享回复限流配额
    const username = uniqueName('xssreply');
    await register(page, username);

    const res = await page.request.post('/api/replies', {
      data: {
        topicId: 1,
        content: '<script>window.__rxss__=true;</script><b onclick="window.__rxss2__=true">粗体</b>',
      },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto('/t/1');
    const executed = await page.evaluate(() => ({
      a: (window as unknown as { __rxss__?: boolean }).__rxss__,
      b: (window as unknown as { __rxss2__?: boolean }).__rxss2__,
    }));
    expect(executed.a).toBeUndefined();
    expect(executed.b).toBeUndefined();
  });

  test('用户名中的 HTML 被转义而非执行', async ({ page }) => {
    const username = uniqueName('xss');
    await register(page, username);

    await page.goto(`/member/${username}`);
    const html = await page.locator('#Rightbar').innerHTML();
    expect(html).not.toContain('<script');
  });

  test('会话 Cookie 为 HttpOnly', async ({ page, context }) => {
    await login(page, USER_A.username, USER_A.password);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'v2_session');
    expect(session).toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe('Lax');
  });

  test('登录 next 参数不允许开放重定向', async ({ page }) => {
    await page.goto('/signin?next=https://evil.example.com/');
    await page.fill('#username', USER_A.username);
    await page.fill('#password', USER_A.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    expect(page.url()).not.toContain('evil.example.com');
    // 重定向后必须仍在本站（localhost），而非外部站点
    const host = new URL(page.url()).host;
    expect(host).toContain('localhost');
  });

  test('回复接口无法引用不存在的主题（防注入/越权）', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await page.request.post('/api/replies', {
      data: { topicId: '1; DROP TABLE topics;--', content: '注入尝试' },
    });
    expect(res.status()).toBe(400);
  });

  test('设置接口拒绝非法 URL 协议', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await page.request.post('/api/settings/profile', {
      data: { url: 'javascript:alert(1)' },
    });
    expect(res.status()).toBe(400);
  });

  test('响应包含安全头', async ({ page }) => {
    const res = await page.request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers()['referrer-policy']).toBeTruthy();
  });

  test('未登录状态下的写操作全部被拒绝', async ({ page }) => {
    const calls = [
      page.request.post('/api/topics', { data: { nodeId: 1, title: 'x'.repeat(20), content: 'y'.repeat(20) } }),
      page.request.post('/api/replies', { data: { topicId: 1, content: '未登录回复' } }),
      page.request.post('/api/collections', { data: { target: 'topic', id: 1 } }),
      page.request.post('/api/nodes', { data: { name: 'x', title: 'y' } }),
      page.request.post('/api/settings/profile', { data: { tagline: 'x' } }),
      page.request.post('/api/settings/password', { data: { current: 'a', next: 'bbbbbbbb' } }),
    ];
    for (const p of calls) {
      const res = await p;
      expect(res.status()).toBe(401);
    }
  });
});
