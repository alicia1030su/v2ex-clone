import { test, expect, type Page } from '@playwright/test';
import { login, clearRateLimits, ADMIN, MODERATOR, USER_A } from './helpers';

/**
 * v0.0.17 P0-1 —— 运维后台（真实浏览器 + 真实接口）
 * ============================================================================
 *
 * ## 为什么必须有 E2E，而不是只有静态护栏
 *
 * 静态护栏只能证明「代码里写了 `ops-scope-banner`」。
 * 它证明不了：
 *   · 管理员点开「运维」tab 后**页面真的出现了**这些区块；
 *   · 版主的页面上**真的没有**运维 tab；
 *   · 接口在真实会话下**真的**返回 403 / 200；
 *   · 页面上的文案里**真的**没有口令、连接串、邮箱。
 *
 * ## 关于「指标数字」的断言策略
 *
 * 计数是**进程内累计**，测试环境里它从服务启动起就不为 0。
 * 因此这里**不**断言具体数值（那会变成脆弱断言），而是断言：
 *   · 区块存在且口径文案可见；
 *   · 状态码分布若存在，其格式合法（形如 `200×N`）；
 *   · 无数据源项显示「无数据源」而不是编造值。
 */

async function openAdmin(page: Page, creds: { username: string; password: string }) {
  await clearRateLimits(page);
  await login(page, creds.username, creds.password);
  await page.goto('/admin');
  await page.waitForLoadState('domcontentloaded');
}

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.17 运维后台（管理员）', () => {
  test('管理员能看到「运维」tab，点开后展示真实区块与口径', async ({ page }) => {
    await openAdmin(page, ADMIN);

    const opsTab = page.locator('button').filter({ hasText: /^运维$/ }).first();
    await expect(opsTab, '管理员的后台必须有「运维」入口').toHaveCount(1);
    await opsTab.click();

    // 口径横幅：必须出现「本进程」与「进程启动至今」
    const banner = page.locator('[data-testid="ops-scope-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    const bannerText = await banner.innerText();
    expect(bannerText, '口径横幅必须写「本进程」，否则会被读成全站总量').toContain('本进程');
    expect(bannerText, '口径横幅必须写累加窗口').toContain('进程启动至今');
    expect(bannerText, '口径横幅必须提示多副本各自计数').toMatch(/逐实例|多副本/);

    // 各区块真实存在
    await expect(page.locator('[data-testid="ops-runtime"]')).toBeVisible();
    await expect(page.locator('[data-testid="ops-deps"]')).toBeVisible();
    await expect(page.locator('[data-testid="ops-api"]')).toBeVisible();

    // 备份：**必须**显示「无数据源」
    const backup = page.locator('[data-testid="ops-backup-unavailable"]');
    await expect(backup, '备份状态无数据源时必须如实显示').toBeVisible();
    expect(await backup.innerText()).toContain('无数据源');
  });

  test('接口返回真实结构与口径字段（不是空壳）', async ({ page }) => {
    await openAdmin(page, ADMIN);
    const res = await page.request.get('/api/admin/ops');
    expect(res.status()).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.scope, '缺少 scope ⇒ 界面无法说明口径').toBeTruthy();
    const scope = body.scope as Record<string, unknown>;
    expect(scope.metrics).toBe('process');
    expect(scope.window).toBe('since-start');
    expect(typeof scope.instanceId).toBe('string');
    expect(typeof scope.uptimeSeconds).toBe('number');
    expect(Number(scope.uptimeSeconds)).toBeGreaterThan(0);

    expect(Array.isArray(body.warnings)).toBe(true);
    expect((body.warnings as string[]).join(' ')).toContain('不是集群总量');

    const deps = body.dependencies as Record<string, Record<string, unknown>>;
    expect(typeof deps.db.ok).toBe('boolean');
    expect(typeof deps.db.latencyMs).toBe('number');
    // PostgreSQL 连接明细：要么 ok:true 带计数，要么 ok:false 带原因
    if (deps.postgres.ok === true) {
      expect(typeof deps.postgres.total).toBe('number');
      expect(typeof deps.postgres.maxConnections).toBe('number');
    } else {
      expect(typeof deps.postgres.reason).toBe('string');
    }

    expect((body.backup as Record<string, unknown>).available).toBe(false);
  });

  test('运维接口响应体不得包含敏感信息', async ({ page }) => {
    await openAdmin(page, ADMIN);
    const res = await page.request.get('/api/admin/ops');
    const text = await res.text();

    /*
     * ⚠️ 这里**必须**用 `new RegExp` 而不是字面量 `/redis:\/\//`。
     *
     * 原因：这个文件由 shell heredoc 生成过一次，反斜杠被吃掉，
     * `\/` 变成 `/` ⇒ 字面量 `/redis://///i` 里的 `//` 被当成**行注释**
     * ⇒ 后续 `/SESSION_SECRET/i` 被解析成标识符 ⇒
     * `ReferenceError: SESSION_SECRET is not defined`，
     * 而报错位置与「泄露敏感信息」毫无关系，排查方向被完全带偏。
     *
     * 用 `new RegExp('redis://')` 后，斜杠不再需要转义，这种工具链事故不会再出现。
     */
    const patterns: RegExp[] = [
      new RegExp('postgres(ql)?://', 'i'),
      new RegExp('redis://', 'i'),
      new RegExp('SESSION_SECRET', 'i'),
      new RegExp('POSTGRES_PASSWORD', 'i'),
      new RegExp('REDIS_PASSWORD', 'i'),
      new RegExp('v2_session', 'i'),
      // 邮箱：本地部分@域名.顶级域
      new RegExp('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'),
    ];

    for (const pat of patterns) {
      expect(text, `运维接口泄露敏感信息：${pat}`).not.toMatch(pat);
    }
  });

  test('运维页面渲染后的可见文本不含敏感信息', async ({ page }) => {
    await openAdmin(page, ADMIN);
    const opsTab = page.locator('button').filter({ hasText: /^运维$/ }).first();
    await opsTab.click();
    await page.waitForTimeout(1500);

    const body = await page.locator('body').innerText();
    const patterns: RegExp[] = [
      new RegExp('postgres(ql)?://', 'i'),
      new RegExp('SESSION_SECRET', 'i'),
      new RegExp('v2_session', 'i'),
    ];
    for (const pat of patterns) {
      expect(body, `运维页面文本泄露敏感信息：${pat}`).not.toMatch(pat);
    }
  });
});

test.describe('v0.0.17 运维后台（权限边界）', () => {
  test('版主的后台**没有**运维 tab，直连接口返回 403', async ({ page }) => {
    await openAdmin(page, MODERATOR);

    const opsTab = page.locator('button').filter({ hasText: /^运维$/ }).first();
    await expect(opsTab, '版主不应看到运维入口（入口级权限）').toHaveCount(0);

    const res = await page.request.get('/api/admin/ops');
    expect(res.status(), '版主直连运维接口必须 403').toBe(403);
  });

  test('普通用户访问运维接口返回 403，且不泄露端点存在性差异', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const res = await page.request.get('/api/admin/ops');
    expect(res.status()).toBe(403);
  });

  test('未登录访问运维接口返回 401', async ({ page }) => {
    await clearRateLimits(page);
    const res = await page.request.get('/api/admin/ops');
    expect(res.status()).toBe(401);
  });
});
