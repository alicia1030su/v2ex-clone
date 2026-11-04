import { test, expect, Page } from '@playwright/test';
import {
  login,
  register,
  uniqueName,
  createTopicViaUi,
  ADMIN,
  USER_A,
  MODERATOR,
} from './helpers';

/**
 * v0.0.4 —— 四种身份的**真实浏览器 UI 验收**补齐
 *
 * ## 本文件的硬约束
 *
 *  1. 全程 `page.goto` + locator 点击 / 可见性 / 文本断言。
 *     **禁止 `page.request.*` / `apiPost()` / `getCsrfToken()` /
 *     `clearRateLimits()` / `pickNodeId()`** —— 后者都会退化成 API 层验证。
 *     节点 id 与主题链接一律从真实 DOM 读取。
 *  2. 身份账号来自 `helpers.ts` 的 `ADMIN` / `USER_A` / `MODERATOR`，
 *     `login()` 走真实登录表单（不是 cookie 注入）。
 *  3. 若某操作在 UI 上确实没有按钮，**如实记录「UI 无入口，功能仅 API 层」**，
 *     不伪造点击、不改 src/**、不为了让测试通过去调 API。
 *
 * ## 已知的 UI 缺口（本文件会验证并在报告中列出）
 *
 *  - `SiteNav.tsx` 对**任何角色**都不渲染 `/admin` 链接 —— 后台只能靠直达 URL，
 *    所以「导航栏无后台入口」对游客/普通用户成立，但对管理员同样成立（这是产品缺口，
 *    不是权限正确性的证据）。
 *  - 节点申请**提交**在前端无表单/按钮（`/nodes` 页无入口），只有
 *    `/api/node-requests`；后台「节点申请」tab 只有审批按钮。
 *  - 「隐藏既有节点」(`PATCH /api/nodes { action:'hide' }`) 在 UI 上无任何入口，
 *    因此 `feature.spec.ts:157` 的「非管理员不能审核节点」是 **API 层结论**，
 *    不能冒充 UI 验收；它与「审批节点申请」是两个不同操作。
 *  - 找回密码 / SMTP 真实投递、多视口交互：不在本文件范围。
 *
 * 数据自给自足：封禁目标用户与版主操作用的主题都在用例内用 UI 创建，
 * 且封禁后会解封、锁定后会解锁，尽量不污染共享测试库。
 */

/** 从 /go/new 的真实 <select> 里读第一个可用节点 id（纯 DOM，不发 API 请求） */
async function firstNodeIdViaUi(page: Page): Promise<number> {
  await page.goto('/go/new');
  await page.waitForLoadState('networkidle');
  const values = await page
    .locator('select[name="nodeId"] option')
    .evaluateAll((opts: Element[]) =>
      opts
        .map((o) => (o as HTMLOptionElement).value)
        .filter((v) => /^\d+$/.test(v)),
    );
  if (!values.length) throw new Error('/go/new 的节点下拉里没有可用的数字 id');
  return Number(values[0]);
}

/** 从首页真实 DOM 读第一个主题链接（纯 UI，不依赖 seed 的具体 id） */
async function firstTopicHrefViaUi(page: Page): Promise<string> {
  await page.goto('/');
  const link = page.locator('a[href^="/t/"]').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('首页没有可访问的主题链接');
  return href;
}

// ---------------------------------------------------------------------------
// 1. 游客 / 未登录
// ---------------------------------------------------------------------------
test.describe('四身份 UI 验收 · 游客', () => {
  test('游客访问 /go/new 被服务端重定向到登录页', async ({ page }) => {
    await page.goto('/go/new');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  });

  test('游客直达 /admin 被重定向到登录页，不泄露后台内容', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.locator('body')).not.toContainText('管理后台');
  });

  test('游客在主题页看不到回复表单，导航栏无后台入口', async ({ page }) => {
    await test.step('主题页：无回复表单、有登录引导', async () => {
      const href = await firstTopicHrefViaUi(page);
      await page.goto(href);
      await expect(page.locator('textarea[name="content"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '提交回复' })).toHaveCount(0);
      await expect(page.locator('#topic-replies')).toContainText(/后回复/);
    });

    await test.step('导航栏：无 /admin 链接、无「管理后台」字样', async () => {
      await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
      await expect(page.locator('#Top')).not.toContainText('管理后台');
    });
  });

  test('UI 缺口：节点申请提交在前端无入口（仅 API /api/node-requests）', async ({ page }) => {
    await page.goto('/nodes');
    await expect(page.getByRole('button', { name: /申请节点|申请新节点/ })).toHaveCount(0);
    await expect(page.locator('form[action*="node-requests"]')).toHaveCount(0);
    test.info().annotations.push({
      type: 'ui-no-entry',
      description: '节点申请「提交」无 UI 入口；只有 /api/node-requests 与后台审批 tab',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. 普通注册用户
// ---------------------------------------------------------------------------
test.describe('四身份 UI 验收 · 普通注册用户', () => {
  test('普通用户：/admin 直达被拒、导航无后台入口、主题页无管理按钮', async ({ page }) => {
    await test.step('真实表单登录，确认登录态', async () => {
      await login(page, USER_A.username, USER_A.password);
      await page.goto('/');
      await expect(page.locator('#Top')).toContainText(USER_A.username);
    });

    await test.step('直达 /admin 被重定向回首页', async () => {
      await page.goto('/admin');
      await expect(page).toHaveURL('/');
    });

    await test.step('导航栏无后台入口', async () => {
      await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
      await expect(page.locator('#Top')).not.toContainText('管理后台');
    });

    await test.step('主题页不渲染锁定/置顶/恢复等管理按钮', async () => {
      const href = await firstTopicHrefViaUi(page);
      await page.goto(href);
      await expect(page.getByRole('button', { name: '锁定主题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '置顶主题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '恢复主题' })).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. 版主 moderator
// ---------------------------------------------------------------------------
test.describe('四身份 UI 验收 · 版主 moderator', () => {
  test('版主：主题管理真实点击流 + /admin 权限边界 + 节点申请 tab 反馈', async ({ page }) => {
    await test.step('真实表单登录版主账号', async () => {
      await login(page, MODERATOR.username, MODERATOR.password);
      await page.goto('/');
      await expect(page.locator('#Top')).toContainText(MODERATOR.username);
    });

    await test.step('在自己创建的主题页真实点击「锁定 → 解锁」', async () => {
      const nodeId = await firstNodeIdViaUi(page);
      const topicId = await createTopicViaUi(
        page,
        nodeId,
        `版主UI验收 ${uniqueName('mod')}`,
        '用于验证版主在真实浏览器里点击锁定与解锁按钮，正文长度满足最小要求。',
      );
      await page.goto(`/t/${topicId}`);

      const lockBtn = page.getByRole('button', { name: '锁定主题' });
      const pinBtn = page.getByRole('button', { name: '置顶主题' });
      await expect(lockBtn).toBeVisible({ timeout: 15_000 });
      await expect(pinBtn).toBeVisible({ timeout: 15_000 });

      await lockBtn.click();
      await expect(page.getByRole('button', { name: '解锁主题' })).toBeVisible({
        timeout: 15_000,
      });

      // 还原，避免把新主题留在锁定状态污染共享库
      await page.getByRole('button', { name: '解锁主题' }).click();
      await expect(page.getByRole('button', { name: '锁定主题' })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step('/admin 可见（版主是 staff），但无「变更角色」控件（admin 独有）', async () => {
      await page.goto('/admin');
      await expect(page.getByRole('button', { name: '概览' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#Rightbar')).toContainText('版主');

      await page.getByRole('button', { name: '用户', exact: true }).click();
      await expect(page.getByRole('button', { name: '搜索用户', exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('select[aria-label^="变更"]')).toHaveCount(0);
    });

    await test.step('节点申请 tab 的 UI 反馈（如实观测，不伪造点击）', async () => {
      await page.getByRole('button', { name: '节点申请' }).click();
      await expect(page.getByRole('button', { name: '待审批' })).toBeVisible({ timeout: 15_000 });

      // 「隐藏既有节点」在 UI 上完全没有入口 —— 这是 API 层结论的边界
      await expect(page.locator('button[aria-label*="隐藏节点"]')).toHaveCount(0);

      const approveCount = await page
        .locator('button[aria-label^="批准节点申请"]')
        .count();
      test.info().annotations.push({
        type: 'ui-observation',
        description:
          `版主可见「节点申请」tab 与「待审批」筛选；当前 pending 申请的批准按钮数=${approveCount}。` +
          '按 AdminConsole.tsx L30 的矩阵，版主本就可审批节点申请；' +
          'feature.spec.ts:157 的「非管理员不能审核节点」实为 PATCH /api/nodes {action:hide}（隐藏既有节点），' +
          '该操作 UI 无入口，属 API 层结论，不能冒充 UI 验收。',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 4. 管理员 admin
// ---------------------------------------------------------------------------
test.describe('四身份 UI 验收 · 管理员 admin', () => {
  test('管理员：/admin 真实点击「封禁 → 解封」+ 配置页无明文口令', async ({ page, browser }) => {
    // 目标用户：用真实注册表单在独立 context 创建，避免封禁 seed 演示账号
    const ctxT = await browser.newContext();
    const pageT = await ctxT.newPage();
    const target = uniqueName('banui');
    await register(pageT, target, 'V004Test-2026!');

    try {
      await test.step('真实表单登录管理员，/admin 概览可见', async () => {
        await login(page, ADMIN.username, ADMIN.password);
        await page.goto('/admin');
        await expect(page.getByRole('button', { name: '概览' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#Rightbar')).toContainText('管理员');
      });

      await test.step('用户 tab：admin 独有「变更角色」下拉可见', async () => {
        await page.getByRole('button', { name: '用户', exact: true }).click();
        await expect(page.getByRole('button', { name: '搜索用户', exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await page.getByRole('textbox', { name: '搜索用户' }).fill(target);
        await page.getByRole('button', { name: '搜索用户', exact: true }).click();
        await expect(page.locator(`a[href="/member/${target}"]`)).toBeVisible({
          timeout: 15_000,
        });
        await expect(
          page.locator(`select[aria-label="变更 ${target} 的角色"]`),
        ).toBeVisible({ timeout: 15_000 });
      });

      await test.step('真实点击「封禁」（含 prompt 对话框）', async () => {
        page.once('dialog', (d) => d.accept('v0.0.4 四身份 UI 验收'));
        await page.getByRole('button', { name: `封禁 ${target}` }).click();
        await expect(page.getByRole('button', { name: `解封 ${target}` })).toBeVisible({
          timeout: 15_000,
        });
      });

      await test.step('观测：被封禁用户在浏览器里的会话状态（不硬断言）', async () => {
        await pageT.goto('/settings');
        test.info().annotations.push({
          type: 'ui-observation',
          description: `封禁后目标用户访问 /settings → ${pageT.url()}（会话是否失效取决于服务端实现，此处只记录不判定）`,
        });
      });

      await test.step('真实点击「解封」，还原为可封禁状态', async () => {
        await page.getByRole('button', { name: `解封 ${target}` }).click();
        await expect(page.getByRole('button', { name: `封禁 ${target}` })).toBeVisible({
          timeout: 15_000,
        });
      });

      await test.step('系统配置页：数据库/SMTP 口令已脱敏，无明文', async () => {
        await page.getByRole('button', { name: '系统配置' }).click();
        const dbRow = page.locator('tr').filter({ hasText: '数据库口令' });
        await expect(dbRow).toBeVisible({ timeout: 15_000 });
        const dbText = await dbRow.innerText();
        expect(dbText).not.toContain('v2ex_password');
        expect(dbText).toMatch(/\*\*\*\*|—/);

        const smtpRow = page.locator('tr').filter({ hasText: '账号 / 口令' });
        await expect(smtpRow).toBeVisible({ timeout: 15_000 });
        const smtpText = await smtpRow.innerText();
        expect(smtpText).not.toContain('v2ex_password');
      });
    } finally {
      await ctxT.close();
    }
  });

  /**
   * team-lead 追问：管理员是否真的「完全无后台入口」？
   * 这条用例用真实浏览器逐个访问页面，把导航区 DOM 与全页 a[href*="admin"]
   * 列表记进 annotations，作为「入口在别处 / 完全无入口」的判定依据。
   */
  test('UI 缺口实证：管理员在 /、/admin、/settings 的 DOM 中均无 /admin 入口', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);

    const observations: string[] = [];
    for (const path of ['/', '/admin', '/settings']) {
      await page.goto(path);
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

      const toolsHtml = (await page.locator('#Top .tools').innerHTML())
        .replace(/\s+/g, ' ')
        .slice(0, 260);
      const adminLinks = await page
        .locator('a[href*="admin"]')
        .evaluateAll((els) =>
          els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
        );

      // 硬断言：这三个页面都不存在指向 /admin 的链接
      await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
      observations.push(
        `${path}: a[href*="admin"]=${JSON.stringify(adminLinks)}; #Top .tools=${toolsHtml}`,
      );
    }

    test.info().annotations.push({
      type: 'ui-admin-entry-dom',
      description: observations.join(' || '),
    });
  });
});
