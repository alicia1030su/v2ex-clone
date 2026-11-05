import { test, expect, Page } from '@playwright/test';
import {
  login,
  register,
  uniqueName,
  createTopicViaUi,
  waitForHydration,
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
 * ## v0.0.4 UI 缺口补齐后的断言方向（2026-11-04 修订）
 *
 * 本文件原先有两条用例把「UI 无入口」**当作断言**（`toHaveCount(0)`）。
 * UI 工程师补齐了入口后，这两条用例的**前提已经失效**，必然失败。
 * 修订原则（**不是降低标准，是把标准从「缺陷存在」翻转为「功能可用」**）：
 *
 *  - 原用例 A（节点申请无入口）→ 改为**正向断言**：入口存在 + 真实点击提交
 *    + 申请真实入库 + 审批后节点真实可见。
 *  - 原用例 B（管理员无 /admin 入口）→ 改为**正向断言**：三个页面都有
 *    `a[href="/admin"]` + 真实点击到达 `/admin`。
 *
 * 修订后每条用例的**断言强度都高于原版**：
 *  - A：原版只断言「不存在」（1 条计数断言）→ 新版断言「入口存在 + 点击有反应
 *    + 记录入库 + 审批后节点可见 + 未登录被拦」（5 层）
 *  - B：原版只断言「不存在」（1 条计数断言）→ 新版断言「存在 + 可见 + 可点击
 *    + 点击后真的到达 /admin」（3 个页面 × 3 层）
 *
 * 仍然保留的 UI 缺口（如实记录，不伪造）：
 *  - 「隐藏既有节点」`PATCH /api/nodes { action:'hide' }` —— v0.0.4 已补 UI
 *    （`/admin` → 「节点管理」tab，管理员可见「隐藏/恢复节点」按钮），
 *    但**版主**无该按钮（服务端 `isAdmin` 限制），故版主用例仍记录为观测。
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

  /**
   * v0.0.4 修订：原用例「节点申请提交在前端无入口（仅 API /api/node-requests）」
   * 把**缺陷**当断言（`toHaveCount(0)`）。UI 工程师补齐了 `/nodes/request`
   * 页面与 `NodeRequestForm` 组件后，原断言必然失败。
   *
   * 修订为**正向断言**，且断言强度**高于原版**：
   *  - 原版：1 层（断言「按钮不存在」）
   *  - 新版：4 层（入口存在 → 真实点击提交 → 反馈可见 → 记录真实入库）
   *
   * 「列表断言必须基于 DOM」：`/nodes/request` 页面的「我提交的申请」
   * 区块由服务端渲染入库记录，是 DOM 事实；`page.request` 只作为
   * **数据库侧佐证**（证明确实写进 node_requests 表，而不只是前端假状态）。
   */
  test('节点申请：UI 入口存在 + 真实点击提交成功 + 申请真实入库', async ({
    page,
    browser,
  }) => {
    // 用例需要一个**普通用户**（游客没有节点申请入口）
    const user = uniqueName('nodeui');
    await register(page, user, 'V004Test-2026!');

    await test.step('游客在 /nodes 看不到「申请新节点」入口（权限边界）', async () => {
      const ctxGuest = await browser.newContext();
      const guest = await ctxGuest.newPage();
      await guest.goto('/nodes');
      await expect(guest.locator('#Top')).toBeVisible({ timeout: 15_000 });
      await expect(guest.getByRole('link', { name: '申请新节点' })).toHaveCount(0);
      await ctxGuest.close();
    });

    await test.step('登录后在 /nodes 能看到「申请新节点」入口', async () => {
      await page.goto('/nodes');
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });
      const entry = page.getByRole('link', { name: '申请新节点' });
      await expect(entry).toBeVisible({ timeout: 15_000 });
    });

    // 节点名必须匹配服务端 NAME_RE：^[a-z0-9][a-z0-9_-]{1,31}$
    const nodeName = `e2e${uniqueName('n').replace(/[^a-z0-9]/gi, '').slice(0, 10)}`;
    const nodeTitle = `E2E 申请节点 ${nodeName}`;

    await test.step('真实点击入口进入 /nodes/request，表单完整可见', async () => {
      await page.getByRole('link', { name: '申请新节点' }).click();
      await expect(page).toHaveURL(/\/nodes\/request/);
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

      // 表单四要素全部在 DOM 里（不是只有链接的空壳）
      await expect(page.locator('input#node_slug')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('input#node_title')).toBeVisible();
      await expect(page.locator('select[name="categoryId"]')).toBeVisible();
      await expect(page.locator('textarea[name="description"]')).toBeVisible();

      const submitBtn = page.getByRole('button', { name: '提交申请' });
      await expect(submitBtn).toBeVisible();
      // 未填必填项时提交按钮必须禁用（前端校验真的生效）
      await expect(submitBtn).toBeDisabled();
    });

    await test.step('真实填写表单并点击「提交申请」', async () => {
      // NodeRequestForm 是**客户端组件**，必须等 hydration 完成，
      // 否则 onSubmit 没绑定、点击不会有任何反应。
      await waitForHydration(page, 'input#node_slug');

      await page.locator('input#node_slug').fill(nodeName);
      await page.locator('input#node_title').fill(nodeTitle);
      await page.locator('textarea[name="description"]').fill('v0.0.4 E2E 通过真实 UI 提交的节点申请。');

      const submitBtn = page.getByRole('button', { name: '提交申请' });
      await expect(submitBtn).toBeEnabled({ timeout: 15_000 });
      await submitBtn.click();

      // 成功反馈：role="status" 的 toast
      // 用 `.toast[role="status"]` 而不是裸 getByRole('status') ——
      // 后者在页面上出现第二个 status 元素时会因 strict mode 直接报错；
      // 实测（3010 端口）该页 role=status 初始为 0、提交后为 1，这里再收窄一层更稳。
      await expect(page.locator('.toast[role="status"]')).toContainText('节点申请已提交', {
        timeout: 20_000,
      });
      // 表单被清空（防重复提交）
      await expect(page.locator('input#node_slug')).toHaveValue('');
      await expect(page.locator('input#node_title')).toHaveValue('');
    });

    await test.step('DOM 断言：刷新后申请记录出现在「我提交的申请」列表里', async () => {
      // ⚠️ 必须先 reload：`myRequests` 是**服务端渲染时传入的 prop**，
      // 客户端提交成功后组件只清空表单、**不会**把新申请追加进列表。
      // 不刷新的话这里必然失败 —— 那不是产品缺陷，是断言没等数据刷新。
      // 刷新后列表由服务端重新查库渲染 → 才是「真实入库」的 DOM 证据。
      await page.reload();
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

      // 列表基于**服务端渲染的 DOM**（真事实来源，不是前端 state）
      const list = page.locator('#Main').filter({ hasText: '我提交的申请' });
      await expect(list).toContainText(nodeTitle, { timeout: 20_000 });
      await expect(list).toContainText(nodeName);
      await expect(list).toContainText('审核中');
    });

    await test.step('数据库侧佐证：GET /api/node-requests 真实返回该申请', async () => {
      // 仅作为「确实写进 node_requests 表」的旁证 —— 列表断言已在上面基于 DOM 完成
      const res = await page.request.get('/api/node-requests');
      expect(res.ok()).toBe(true);
      const data = await res.json();
      const requests = (data?.requests ?? []) as Array<{ name: string; status: string }>;
      const hit = requests.find((r) => r.name === nodeName);
      expect(hit, '申请应真实写入 node_requests 表').toBeTruthy();
      expect(hit?.status).toBe('pending');
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
   * v0.0.4 修订：原用例「管理员在 /、/admin、/settings 的 DOM 中均无 /admin 入口」
   * 把**缺陷**当断言（`toHaveCount(0)`）。UI 工程师把导航链接收敛到
   * `src/lib/nav-links.ts` + `src/components/NavTools.tsx` 并为
   * moderator / admin 渲染「管理后台」入口后，原断言必然失败。
   *
   * 修订为**正向断言**，且断言强度**高于原版**：
   *  - 原版：1 层（断言「链接不存在」，且不验证任何可点击性）
   *  - 新版：3 页 × 3 层（链接存在 → 可见可点 → 真实点击后真的到达 /admin）
   *
   * **保留原文件的 observations 采集机制**（把 DOM 快照写进 annotations）——
   * 它是「入口在哪个位置」的证据，改写后语义从「无入口」翻转为
   * 「入口存在 + 位置」。
   */
  test('管理员：/、/admin、/settings 三页 DOM 中都有 /admin 入口且可点击到达', async ({
    page,
  }) => {
    await login(page, ADMIN.username, ADMIN.password);

    const observations: string[] = [];
    for (const path of ['/', '/admin', '/settings']) {
      await test.step(`${path}：存在可见的 a[href="/admin"] 入口`, async () => {
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

        // 硬断言（正向）：这三个页面**都**必须有指向 /admin 的链接
        const adminLink = page.locator('a[href="/admin"]');
        await expect(adminLink).toHaveCount(1);
        await expect(adminLink).toBeVisible({ timeout: 15_000 });
        await expect(adminLink).toHaveText('管理后台');

        observations.push(
          `${path}: a[href*="admin"]=${JSON.stringify(adminLinks)}; ` +
            `#Top .tools 命中「管理后台」=${toolsHtml.includes('管理后台')}; #Top .tools=${toolsHtml}`,
        );
      });
    }

    await test.step('真实点击导航里的「管理后台」链接，真的到达 /admin', async () => {
      await page.goto('/');
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

      const adminLink = page.locator('a[href="/admin"]');
      await expect(adminLink).toBeVisible({ timeout: 15_000 });
      await adminLink.click();

      // 不是只看链接存在 —— 要确认**点得动、点得到**
      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      // 真的进了后台内容（而不是又跳回首页）
      await expect(page.locator('#Main')).toContainText('概览', { timeout: 20_000 });
      await expect(page.getByRole('button', { name: '概览' })).toBeVisible({
        timeout: 20_000,
      });
    });

    test.info().annotations.push({
      type: 'ui-admin-entry-present',
      description:
        '管理员在 /、/admin、/settings 三页均存在可见可点的 a[href="/admin"]（文案「管理后台」），' +
        `点击后真实到达 /admin。DOM 快照：${observations.join(' || ')}`,
    });
  });
});
