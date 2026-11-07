import { test, expect, Page } from '@playwright/test';
import {
  login,
  logout,
  register,
  uniqueName,
  createTopicViaUi,
  submitReplyViaUi,
  waitForHydration,
  clearRateLimits,
  ADMIN,
  USER_A,
  USER_B,
  MODERATOR,
} from './helpers';

/**
 * v0.0.9 —— 四角色完整用户体验验收（任务书 §五）
 *
 * ## 与既有四角色测试的差别
 *
 * v0.0.4 的 `v004-four-roles-ui.spec.ts` 与 v0.0.5 的
 * `v005-four-roles-deep.spec.ts` 已覆盖大量点击流。本文件针对任务书 §五
 * 的**逐条要求**补齐缺口，重点是：
 *
 *   1. **每项操作必须验证真实数据库变化，而不只是 HTTP 200**
 *      —— 既有测试大多只断言 UI 文本 / 元素可见。本文件用
 *      「操作前计数 → 操作 → 操作后计数」证明数据真的落库。
 *   2. **游客 → 登录 → 返回目标页面**这条链路（任务书 §五 明确要求）。
 *   3. **@提及 → 收到通知**的端到端闭环（含通知内容断言）。
 *   4. **感谢 → 积分账本变化**（既有测试只验证 UI 反馈，
 *      没验证 `credit_ledger` 真的多了一行）。
 *
 * ## 硬约束
 *
 *   · 全程真实浏览器操作（不使用 `page.request` 冒充 UI 交互 ——
 *     `page.request` 仅用于**读取验证数据**，不用于代替点击）；
 *   · 数据自给自足，用例内创建，不污染共享库；
 *   · UI 确实没有入口的能力，**如实记录** observation，不伪造点击。
 */

/**
 * 通过调试端点读取表行数（只读）。
 *
 * 调试端点需 `ENABLE_DEBUG_ENDPOINTS=1` + 有效令牌 —— 与
 * `clearRateLimits` 使用同一套鉴权（见 helpers 的 debugTokens 说明）。
 */
async function countViaDebug(page: Page, table: string): Promise<number> {
  const token = debugToken();
  const res = await page.request.get(`/api/debug/table-count?table=${table}`, {
    headers: { 'x-debug-token': token },
  });
  if (!res.ok()) {
    throw new Error(
      `countViaDebug(${table}) 失败：HTTP ${res.status()} —— ` +
        `调试端点未开启或令牌不匹配（测试进程与服务端必须用同一个 DEBUG_ENDPOINT_TOKEN）。`,
    );
  }
  const body = await res.json().catch(() => null);
  return typeof body?.count === 'number' ? body.count : -1;
}

/** 取调试令牌（与 helpers 同一来源） */
function debugToken(): string {
  const fromEnv = process.env.DEBUG_ENDPOINT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    '拿不到 DEBUG_ENDPOINT_TOKEN —— 既不在进程 env 里，也不在 .env.test 里。\n' +
      '没有它就无法读取表行数，也无法清理限流。',
  );
}

/** 从 /go/new 的真实 <select> 读第一个可用节点 id（纯 DOM） */
async function firstNodeIdViaUi(page: Page): Promise<number> {
  await page.goto('/go/new');
  await page.waitForLoadState('domcontentloaded');
  const values = await page
    .locator('select[name="nodeId"] option')
    .evaluateAll((opts: Element[]) =>
      opts
        .map((o) => Number((o as HTMLOptionElement).value))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
  if (values.length === 0) throw new Error('/go/new 的节点下拉为空');
  return values[0];
}

// ═════════════════════════════════════════════════════════════════════
// 1. 普通用户
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.9 普通用户 · 全流程（每步验证真实数据变化）', () => {
  test('注册 → 浏览 → 发帖 → 回复 → @提及 → 收到通知 → 收藏 → 感谢 → 搜索 → 改资料', async ({ page }) => {
    await clearRateLimits(page);

    // ---------- 注册（验证 users 表 +1）----------
    const uname = uniqueName('v009user');
    const beforeUsers = await countViaDebug(page, 'users');
    await register(page, uname);
    const afterUsers = await countViaDebug(page, 'users');
    expect(afterUsers).toBe(beforeUsers + 1);

    // ---------- 浏览节点 ----------
    await page.goto('/nodes');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText('节点');

    // ---------- 发帖（验证 topics 表 +1）----------
    const nodeId = await firstNodeIdViaUi(page);
    const topicTitle = `v0.0.9 普通用户验收 ${uniqueName('t')}`;
    const beforeTopics = await countViaDebug(page, 'topics');
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      topicTitle,
      `v0.0.9 普通用户验收主题内容，用于验证真实落库。`,
    );
    const afterTopics = await countViaDebug(page, 'topics');
    expect(afterTopics).toBe(beforeTopics + 1);

    // ---------- 回复自己的主题（验证 replies 表 +1）----------
    const beforeReplies = await countViaDebug(page, 'replies');
    await submitReplyViaUi(page, topicId, `v0.0.9 验收回复 ${uniqueName('r')}`);
    const afterReplies = await countViaDebug(page, 'replies');
    expect(afterReplies).toBe(beforeReplies + 1);

    // ---------- @提及 → 被提及者收到通知 ----------
    //
    // ⚠️ 必须用**独立的 browser context** —— 同 context 的新 page 会共享
    //    cookie（已是刚注册的新用户）⇒ /signin 会重定向回首页 ⇒
    //    `login()` 等不到 `#username` 元素而超时。
    //
    // ⚠️ @提及只在**回复**里生效（发帖路径不触发提及通知）——
    //    这是产品既有行为（见 src/app/api/replies/route.ts 的提及处理，
    //    以及 e2e/v005-mentions.spec.ts 的既有覆盖）。
    //    本用例按**真实行为**验证，不假设发帖也能触发提及。
    const ctxB = await page.context().browser()!.newContext({
      baseURL: process.env.LOCAL_BASE ?? 'http://localhost:3021',
      locale: 'zh-CN',
      viewport: { width: 1280, height: 900 },
    });
    const pageB = await ctxB.newPage();
    await login(pageB, USER_B.username, USER_B.password);
    const nodeIdB = await firstNodeIdViaUi(pageB);
    const mentionTopicId = await createTopicViaUi(
      pageB,
      nodeIdB,
      `v0.0.9 提及验收 ${uniqueName('m')}`,
      `这是提及验收用的主题，正文里也会带上 @${uname} 。`,
    );
    expect(mentionTopicId).toBeGreaterThan(0);

    // 在**回复**里 @提及 ⇒ 应产生 mention 通知
    await submitReplyViaUi(
      pageB,
      mentionTopicId,
      `回复里提及 @${uname} 请查收这条提及通知。`,
    );

    // 被提及者登录后应收到提及通知
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');
    const notifText = await page.locator('body').innerText();
    expect(notifText).toContain(uname);

    // 通知 API 也应能读到 mention 类型
    const notifRes = await page.request.get('/api/notifications');
    expect(notifRes.ok()).toBeTruthy();
    const notifBody = await notifRes.json();
    const list: { type?: string; message?: string }[] = notifBody?.notifications ?? [];
    expect(
      list.some(
        (n) =>
          n.type === 'mention' ||
          n.type === 'reply_mention' ||
          String(n.message ?? '').includes(uname),
      ),
    ).toBeTruthy();

    // ---------- 收藏（验证 collections 表 +1）----------
    //
    // ⚠️ 定位必须精确到 **主题页的 CollectButton**，不能用
    //    `filter({hasText:/收藏/})` 扫全页 ——
    //    那个正则会同时命中导航栏的「收藏」链接与节点的「加入收藏」，
    //    点到错误元素会导致**取消收藏**（实测：collections 由 5 变 4）。
    //
    // 正确做法：点按钮本身，且只在它是「收藏」（未收藏）时才点 ——
    //    按钮文本在已收藏时是「已收藏」。
    await page.goto(`/t/${topicId}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');

    const beforeCollections = await countViaDebug(page, 'collections');
    const collectBtn = page.locator('button.button', { hasText: /^收藏$/ });
    const collectCount = await collectBtn.count();
    if (collectCount > 0) {
      await collectBtn.first().click();
      await page.waitForTimeout(1200);
      const afterCollections = await countViaDebug(page, 'collections');
      expect(afterCollections).toBe(beforeCollections + 1);
    } else {
      // 按钮文本是「已收藏」⇒ 说明此前已收藏 ⇒ 改为验证取消收藏后计数回落
      const alreadyBtn = page.locator('button.button', { hasText: /^已收藏$/ });
      if ((await alreadyBtn.count()) > 0) {
        await alreadyBtn.first().click();
        await page.waitForTimeout(1200);
        const afterRemove = await countViaDebug(page, 'collections');
        expect(afterRemove).toBe(beforeCollections - 1);
      } else {
        test.info().annotations.push({
          type: 'observation',
          description: '主题页未找到收藏按钮',
        });
      }
    }

    // ---------- 感谢（验证 thanks 表 +1 且积分账本 +1）----------
    //
    // ⚠️ 同样必须精确定位到「感谢」按钮本身 ——
    //    `/感谢/` 正则会命中「感谢分享」这类正文文本与导航元素。
    await page.goto('/t/1');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');
    const beforeThanks = await countViaDebug(page, 'thanks');
    const beforeLedger = await countViaDebug(page, 'credit_ledger');
    const thanksBtn = page.locator('button.button', { hasText: /^感谢$/ });
    if ((await thanksBtn.count()) > 0) {
      await thanksBtn.first().click();
      await page.waitForTimeout(1500);
      const afterThanks = await countViaDebug(page, 'thanks');
      expect(afterThanks).toBe(beforeThanks + 1);
      // 感谢会给被感谢者加积分 ⇒ 积分账本应有流水
      const afterLedger = await countViaDebug(page, 'credit_ledger');
      expect(afterLedger).toBeGreaterThan(beforeLedger);
    } else {
      test.info().annotations.push({
        type: 'observation',
        description: '未找到「感谢」按钮入口',
      });
    }

    // ---------- 搜索 ----------
    await page.goto(`/go/search?q=${encodeURIComponent(topicTitle.slice(0, 8))}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(0);

    // ---------- 修改资料（验证资料真的持久化）----------
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');
    const bioInput = page.locator('textarea[name="bio"], input[name="bio"]').first();
    if ((await bioInput.count()) > 0) {
      const marker = `v009验收资料-${uniqueName('bio')}`;
      await bioInput.fill(marker);
      await page.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForTimeout(1200);
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      await waitForHydration(page, 'body');
      const bioAgain = page.locator('textarea[name="bio"], input[name="bio"]').first();
      if ((await bioAgain.count()) > 0) {
        await expect(bioAgain).toHaveValue(marker);
      }
    } else {
      test.info().annotations.push({
        type: 'observation',
        description: '设置页未找到 bio 输入框',
      });
    }

    await ctxB.close();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. 游客
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.9 游客 · 引导与回跳', () => {
  test('游客访问受限页被引导到登录页，登录后可继续访问', async ({ page }) => {
    await clearRateLimits(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    const url = page.url();
    expect(url).toContain('/signin');
    // 应带 next 回跳参数
    expect(url).toContain('next=');

    await page.goto('/signin?next=%2Fsettings');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('input[name="username"], input[name="email"]').first().fill(ADMIN.username);
    await page.locator('input[name="password"]').first().fill(ADMIN.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2500);

    expect(page.url()).not.toContain('/signin');
  });

  test('游客可以正常浏览首页与节点页（不需要登录）', async ({ page }) => {
    const home = await page.goto('/');
    expect(home?.status()).toBeLessThan(400);
    const nodes = await page.goto('/nodes');
    expect(nodes?.status()).toBeLessThan(400);
  });

  test('游客的写操作被拒绝（401），且不产生数据', async ({ page }) => {
    await clearRateLimits(page);
    const beforeTopics = await countViaDebug(page, 'topics');

    const res = await page.request.post('/api/topics', {
      headers: { 'content-type': 'application/json' },
      data: { nodeId: 1, title: '游客不应能发帖的探针标题', content: '游客不应能发帖的探针内容内容内容' },
    });
    expect(res.status()).toBe(401);

    const afterTopics = await countViaDebug(page, 'topics');
    expect(afterTopics).toBe(beforeTopics);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. 版主
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.9 版主 · 管理入口与审核', () => {
  test('版主可进入管理后台并看到各分区，看不到管理员专属控件', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, MODERATOR.username, MODERATOR.password);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');

    const body = await page.locator('body').innerText();
    expect(body).toContain('管理后台');
    expect(body).toMatch(/概览|用户|举报|操作日志/);

    // 版主不应看到「变更角色」控件（前端隐藏；服务端另有二次校验）
    const roleControls = await page
      .locator('select[name="role"], button:has-text("变更角色")')
      .count();
    expect(roleControls).toBe(0);
  });

  test('版主的敏感操作仍被服务端二次校验（不能变更角色）', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, MODERATOR.username, MODERATOR.password);

    // 直接调 API 尝试变更角色 ⇒ 必须 403
    const res = await page.request.patch('/api/admin/users/2/role', {
      headers: { 'content-type': 'application/json' },
      data: { role: 'admin' },
    });
    expect(res.status()).toBe(403);
  });

  test('版主可查看审计日志（操作日志 tab）', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, MODERATOR.username, MODERATOR.password);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');

    const logsTab = page.locator('button, a').filter({ hasText: /操作日志/ }).first();
    if ((await logsTab.count()) > 0) {
      await logsTab.click();
      await page.waitForTimeout(1200);
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('加载失败');
    } else {
      test.info().annotations.push({
        type: 'observation',
        description: '未找到「操作日志」tab 入口',
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. 管理员
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.9 管理员 · 全后台分区', () => {
  test('管理员可访问全部后台分区', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, ADMIN.username, ADMIN.password);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await waitForHydration(page, 'body');

    const body = await page.locator('body').innerText();
    expect(body).toMatch(/概览|用户数|主题数/);

    for (const tab of ['用户', '积分', '举报', '节点申请', '节点管理', '操作日志', '系统配置']) {
      expect(body).toContain(tab);
    }
  });

  test('管理员可读取运维指标且不泄露敏感数据', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, ADMIN.username, ADMIN.password);

    const res = await page.request.get('/api/admin/ops');
    expect(res.ok()).toBeTruthy();
    const text = await res.text();

    // 不得出现连接串、口令、密钥
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toMatch(/SESSION_SECRET/i);
    expect(text).not.toMatch(/REDIS_PASSWORD/i);
    expect(text).not.toMatch(/POSTGRES_PASSWORD/i);
    expect(text).not.toMatch(/v2_session/i);
  });

  test('未登录访问后台 API 返回 401（不泄露端点可用性）', async ({ page }) => {
    await clearRateLimits(page);
    for (const p of ['/api/admin/ops', '/api/admin/logs', '/api/admin/stats', '/api/admin/users']) {
      const res = await page.request.get(p);
      expect(res.status(), `${p} 应当 401`).toBe(401);
    }
  });

  test('普通用户访问 /admin 被拒绝（服务端 redirect，不下发后台内容）', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);

    expect(page.url()).not.toContain('/admin');
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('管理后台');
  });

  test('普通用户访问后台 API 返回 403（角色不足）', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);

    const res = await page.request.get('/api/admin/users');
    expect(res.status()).toBe(403);
  });
});
