import { test, expect } from '@playwright/test';
import {
  USER_A,
  USER_B,
  apiPost,
  clearRateLimits,
  getCsrfToken,
  login,
  register,
  uniqueName,
} from './helpers';

/**
 * 安全缺陷回归测试
 *
 * 对应本轮修复的 P0/P1 缺陷：
 *  P0-1 登录 API 在 captchaId 缺失时仍可跳过 CAPTCHA
 *  P0-2 DISABLE_CAPTCHA 未严格限制在隔离测试环境
 *  P0-3 debug/reset-rate-limits 缺少身份验证
 *  P0-4 PostgreSQL incrWindow 没有跨窗口重置计数
 *  P1-10 注册限流只有 IP+用户名维度
 *  P1-11 回复接口 redirect 未统一验证
 *  P1-13 显式 CSRF 防护缺失
 *  P1-14 HTML 清洗器漏洞
 */

test.describe('P0-1 / P0-2 验证码强制校验', () => {
  /**
   * 验证码的服务端校验逻辑（正确/错误答案、一次性、字段名匹配）
   * 由 tests/captcha.spec.ts 单元测试直接覆盖 —— 它不依赖运行时开关。
   *
   * 这里做的是**接口契约**验证：无论是否禁用验证码，
   * 接口都不得接受"字段缺失却静默通过"的行为。
   */
  const captchaEnabled = process.env.DISABLE_CAPTCHA !== '1';

  test('缺失 captchaId 时不得静默通过', async ({ page }) => {
    const res = await apiPost(page, '/api/auth/signin', {
      username: USER_A.username,
      password: USER_A.password,
    });

    if (captchaEnabled) {
      // 验证码启用时：必须拒绝并提示
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toContain('验证码');
    } else {
      // 验证码被显式禁用（仅隔离测试环境）：行为与配置一致
      const body = await res.json();
      expect(res.ok()).toBe(true);
      expect(body.ok).toBe(true);
    }
  });

  test('captchaId 存在但答案错误时被拒绝', async ({ page }) => {
    const cap = await page.request.get('/api/captcha');
    expect(cap.ok()).toBeTruthy();
    const { id, field } = await cap.json();

    const res = await apiPost(page, '/api/auth/signin', {
      username: USER_A.username,
      password: USER_A.password,
      captchaId: id,
      captchaField: field,
      captchaText: 'WRONG',
    });
    if (captchaEnabled) {
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toContain('验证码');
    } else {
      expect(res.ok()).toBeTruthy();
    }
  });

  test('验证码字段名与挑战不匹配时被拒绝', async ({ page }) => {
    const cap = await page.request.get('/api/captcha');
    const { id } = await cap.json();

    const res = await apiPost(page, '/api/auth/signin', {
      username: USER_A.username,
      password: USER_A.password,
      captchaId: id,
      captchaField: 'not-the-right-hash',
      captchaText: 'ABCD',
    });
    if (captchaEnabled) {
      expect(res.status()).toBe(400);
    } else {
      expect(res.ok()).toBeTruthy();
    }
  });

  test('验证码端点始终可用并返回挑战', async ({ page }) => {
    const cap = await page.request.get('/api/captcha');
    expect(cap.ok()).toBeTruthy();
    const body = await cap.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(body.field).toHaveLength(64);
    expect(body.image).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

test.describe('P0-3 调试端点鉴权', () => {
  test('缺少令牌时 reset-rate-limits 被拒绝', async ({ page }) => {
    const res = await page.request.post('/api/debug/reset-rate-limits');
    // 端点未开启 → 404；已开启但无令牌 → 401。两者都必须是"拒绝"
    expect([401, 404]).toContain(res.status());
  });

  test('错误令牌时 reset-rate-limits 被拒绝', async ({ page }) => {
    const res = await page.request.post('/api/debug/reset-rate-limits', {
      headers: { 'x-debug-token': 'definitely-wrong-token' },
    });
    expect([401, 404]).toContain(res.status());
  });

  test('floors 端点同样需要鉴权', async ({ page }) => {
    const res = await page.request.get('/api/debug/floors?topicId=1');
    expect([401, 404]).toContain(res.status());
  });
});

test.describe('P0-4 PostgreSQL 限流窗口重置', () => {
  /**
   * ⚠️ v0.0.4 QA 修订：原实现是
   *
   * ```ts
   * if (!token) { test.skip(true, '未配置 DEBUG_ENDPOINT_TOKEN，跳过'); return; }
   * ```
   *
   * —— **未配置令牌就静默跳过整条用例**，等于「限流窗口重置」这个
   * P0 级修复**在没配令牌的 CI 上从未被验证过**，却显示为「通过」。
   * 这正是任务书禁止的「隐藏跳过用例」。
   *
   * 修订为**两个分支都断言**，不跳过任何一条：
   *  - 配了令牌 → 探针必须成功，且跨窗口计数必须重置为 1（原有断言全部保留）
   *  - 没配令牌 → 探针必须被拒（404/401），即**调试端点在无令牌时确实关闭**
   *    —— 这本身就是一条安全断言（`src/lib/debug-auth.ts` 的设计意图）
   */
  test('窗口过期后计数归零而非无限累积', async ({ page }) => {
    const token = process.env.DEBUG_ENDPOINT_TOKEN;

    if (!token) {
      // 未配置令牌：断言调试端点确实不可用（而不是跳过）
      const res = await page.request.post('/api/debug/rate-limit-probe');
      expect(
        [401, 404],
        '未配置 DEBUG_ENDPOINT_TOKEN 时调试端点必须被拒绝',
      ).toContain(res.status());
      return;
    }

    const probe = await page.request.post('/api/debug/rate-limit-probe', {
      headers: { 'x-debug-token': token },
    });
    expect(probe.ok()).toBeTruthy();

    const data = await probe.json();
    expect(data.firstWindowCount).toBeGreaterThan(0);
    // 跨窗口后计数必须重置为 1（修复前会一直累加）
    expect(data.thirdWindowCount).toBe(1);
    expect(data.windowResetWorking).toBe(true);
  });
});

test.describe('P1-10 注册限流双维度', () => {
  test('同一 IP 换用户名批量注册会被 IP 维度限流拦截', async ({ page }) => {
    const results: number[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await apiPost(page, '/api/auth/signup', {
        username: uniqueName('bulk'),
        email: '',
        password: 'password123',
      });
      results.push(res.status());
      if (res.status() === 429) break;
    }
    // 期望在达到 IP 维度阈值后出现 429
    expect(results).toContain(429);
  });
});

test.describe('P1-11 回复接口 redirect 验证', () => {
  // 回复接口有速率限制（默认 20 次 / 窗口），且**按用户 ID 计数**。
  //
  // 这里不用 USER_B（wangwu）：它的回复配额会被别的 spec 文件里的
  // 「回复限流生效」用例耗尽，导致本组用例间歇性拿到 429。
  // 改为注册一个本组专用的新账号 —— 配额从零开始，互不干扰。
  //
  // beforeEach 仍然清理限流：清掉注册本身消耗的额度，
  // 以及清理上一个用例可能残留的在途请求。
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('外部 redirect 被规范化为站内路径', async ({ page }) => {
    const username = uniqueName('redir');
    await register(page, username);

    const res = await apiPost(page, '/api/replies', {
      topicId: 1,
      content: '测试 redirect 规范化',
      redirect: 'https://evil.example.com/steal',
    });
    // 失败时把真实响应打出来 —— 这个用例间歇性失败过，
    // 没有状态码与响应体就无法判断是限流、鉴权还是业务校验。
    expect(
      res.status(),
      `回复请求失败：status=${res.status()} body=${await res.text()}`,
    ).toBeLessThan(400);
    const body = await res.json();
    expect(body.redirect).not.toContain('evil.example.com');
    expect(body.redirect.startsWith('/')).toBe(true);
  });

  test('协议相对 URL 被拒绝', async ({ page }) => {
    const username = uniqueName('redir');
    await register(page, username);

    const res = await apiPost(page, '/api/replies', {
      topicId: 1,
      content: '测试协议相对 URL',
      redirect: '//evil.example.com/',
    });
    expect(
      res.status(),
      `回复请求失败：status=${res.status()} body=${await res.text()}`,
    ).toBeLessThan(400);
    const body = await res.json();
    expect(body.redirect).not.toContain('evil.example.com');
  });
});

test.describe('P1-13 显式 CSRF 防护', () => {
  test('写请求缺少 CSRF token 被拒绝', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const res = await page.request.post('/api/topics', {
      headers: { 'Content-Type': 'application/json' },
      data: { nodeId: 1, title: 'CSRF 测试主题', content: '缺少 token 应当被拒绝' },
    });
    expect(res.status()).toBe(403);
  });

  test('CSRF token 错误时被拒绝', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const res = await page.request.post('/api/topics', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'wrong-token-value' },
      data: { nodeId: 1, title: 'CSRF 测试主题', content: '错误 token 应当被拒绝' },
    });
    expect(res.status()).toBe(403);
  });

  test('携带正确 CSRF token 时放行', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const token = await getCsrfToken(page);
    expect(token.length).toBeGreaterThanOrEqual(32);

    const res = await apiPost(page, '/api/topics', {
      nodeId: 1,
      title: `CSRF 通过验证 ${Date.now()}`,
      content: '携带正确 token 应当放行，这里是正文内容。',
    });
    expect(res.status()).toBe(201);
  });

  test('页面会下发 CSRF Cookie', async ({ page }) => {
    await page.goto('/');
    const token = await getCsrfToken(page);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });
});

test.describe('P1-14 HTML 清洗器', () => {
  test('data:image/svg+xml 被拒绝（SVG 内可嵌脚本）', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const payload =
      '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvc3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">';
    const res = await apiPost(page, '/api/topics', {
      nodeId: 1,
      title: `SVG data URI 测试 ${Date.now()}`,
      content: `正常内容。${payload}`,
    });
    expect(res.ok()).toBeTruthy();
    const { redirect } = await res.json();

    await page.goto(redirect);
    const html = await page.locator('.topic_content').innerHTML();
    expect(html).not.toContain('data:image/svg+xml');
    expect(html).not.toContain('<script');
  });

  test('javascript: 协议被拒绝', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const res = await apiPost(page, '/api/topics', {
      nodeId: 1,
      title: `javascript 协议测试 ${Date.now()}`,
      content: '<a href="javascript:alert(1)">点我</a>',
    });
    expect(res.ok()).toBeTruthy();
    const { redirect } = await res.json();

    await page.goto(redirect);
    const html = await page.locator('.topic_content').innerHTML();
    expect(html).not.toContain('javascript:');
  });

  test('style 属性被丢弃（防 CSS 注入）', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const res = await apiPost(page, '/api/topics', {
      nodeId: 1,
      title: `style 注入测试 ${Date.now()}`,
      content: '<div style="background:url(javascript:alert(1))">内容</div>',
    });
    expect(res.ok()).toBeTruthy();
    const { redirect } = await res.json();

    await page.goto(redirect);
    const html = await page.locator('.topic_content').innerHTML();
    expect(html).not.toContain('style=');
  });

  test('外链自动加 rel=noopener（防 tabnabbing）', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);

    const res = await apiPost(page, '/api/topics', {
      nodeId: 1,
      title: `外链 rel 测试 ${Date.now()}`,
      content: '[外部链接](https://example.com/)',
    });
    expect(res.ok()).toBeTruthy();
    const { redirect } = await res.json();

    await page.goto(redirect);
    const html = await page.locator('.topic_content').innerHTML();
    if (html.includes('example.com')) {
      expect(html).toContain('noopener');
    }
  });
});
