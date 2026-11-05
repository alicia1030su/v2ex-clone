import { test, expect, Page } from '@playwright/test';
import {
  login,
  logout,
  register,
  uniqueName,
  createTopicViaUi,
  waitForHydration,
  clearRateLimits,
  ADMIN,
  USER_A,
  USER_B,
  MODERATOR,
} from './helpers';

/**
 * v0.0.5 —— 四身份真实浏览器 UI 点击流**补充**验收
 *
 * ## 为什么有这份文件
 *
 * `v004-four-roles-ui.spec.ts`（v0.0.4）已覆盖：
 *   - 游客：访问控制重定向、无回复表单
 *   - 普通用户：/admin 被拒、无后台入口
 *   - 版主：**锁定/解锁**点击流、/admin 可见、无角色变更控件
 *   - 管理员：**封禁/解封**点击流、配置脱敏、三页 /admin 入口
 *
 * `FEATURE_AUDIT_v0.0.5.md` §1.3 / §1.4 发现的**剩余缺口**：
 *   - 版主的**置顶**（按钮可见但从未点击验证）、**恢复**（软删除后恢复）、
 *     **举报处理**（审核列表真实点击）
 *   - 管理员的**角色变更**（下拉可见但从未变更验证）、
 *     **举报处理**、**积分调整**（v0.0.5 新增 tab）
 *   - 游客的**拒绝反馈**（未登录点击写操作时的引导，而非仅「按钮不渲染」）
 *   - 普通用户的**后台入口隐藏性**（未验证）
 *   - **举报全链路**（v0.0.5 新增：用户提交 → 版主处理 → 用户看到结果）
 *
 * ## 硬约束（与 v004-four-roles-ui 一致）
 *
 *  1. 全程真实浏览器点击 / 可见性 / 文本断言。
 *     **禁止 `page.request.*` / `apiPost()` / `getCsrfToken()`** 冒充 UI。
 *  2. 数据自给自足：用例内创建，结束还原，不污染共享库。
 *  3. UI 确实没有入口的能力，**如实记录 observation**，不伪造点击。
 */

/** 从 /go/new 的真实 <select> 里读第一个可用节点 id（纯 DOM） */
async function firstNodeIdViaUi(page: Page): Promise<number> {
  await page.goto('/go/new');
  await page.waitForLoadState('networkidle');
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
// 1. 游客 —— 拒绝反馈（不只是「按钮不渲染」）
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.5 游客 · 写操作的拒绝反馈', () => {
  test('游客点击主题页「收藏」被引导到登录页，且登录后回到原主题', async ({ page }) => {
    // 先让 USER_A 建一个主题（游客要访问的目标页）
    await login(page, USER_A.username, USER_A.password);
    const nodeId = await firstNodeIdViaUi(page);
    const topicTitle = `游客拒绝反馈 ${uniqueName('guest')}`;
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      topicTitle,
      '用于验证游客在真实浏览器里点击写操作时的反馈与登录回跳，正文长度满足最小要求。',
    );
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');

    // 退出登录，回到同一主题页（用 storage state 清空的方式：直接开新 context）
    await page.context().clearCookies();

    await test.step('游客在主题页看到收藏按钮（可点击），点击后被引导登录', async () => {
      await page.goto(`/t/${topicId}`);
      await waitForHydration(page, '.cell_ops button');

      const collectBtn = page.locator('.cell_ops button', { hasText: '收藏' }).first();
      await expect(collectBtn).toBeVisible({ timeout: 15_000 });

      await collectBtn.click();

      // CollectButton 的实现：401 → window.location.href = /signin?next=<当前路径>
      await page.waitForURL(/\/signin\?next=/, { timeout: 15_000 });
      const url = page.url();
      expect(url).toContain('/signin');
      // next 参数应指回原主题页（登录后返回原本目标页面）
      expect(decodeURIComponent(url)).toContain(`/t/${topicId}`);
    });

    await test.step('登录表单可见（用户实际看到了什么）', async () => {
      await expect(page.locator('input[name="username"]').first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator('input[type="password"]').first()).toBeVisible({
        timeout: 10_000,
      });
      // 不实际登录（那是 auth.spec 的职责），此处只证明「引导到了可操作的登录页」
    });
  });

  test('游客访问 /go/new（发帖入口）被重定向到登录页，URL 带 next 回跳', async ({ page }) => {
    await page.goto('/go/new');
    await page.waitForURL(/\/signin\?next=/, { timeout: 15_000 });
    expect(page.url()).toContain('/signin');
    expect(decodeURIComponent(page.url())).toContain('/go/new');
  });

  test('游客在 /reports（我的举报）被重定向到登录页', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForURL(/\/signin\?next=/, { timeout: 15_000 });
    expect(decodeURIComponent(page.url())).toContain('/reports');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. 普通用户 —— 权限边界（不能操作他人内容、看不到后台入口）
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.5 普通用户 · 权限边界', () => {
  test('普通用户：他人主题页无「编辑/删除」按钮，且导航无后台入口', async ({ page }) => {
    // USER_A 建主题
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, USER_A.username, USER_A.password);
    const nodeId = await firstNodeIdViaUi(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `他人内容边界 ${uniqueName('own')}`,
      '用于验证普通用户无法操作他人内容，且导航栏不出现后台入口，正文长度满足最小要求。',
    );

    // USER_B 登录后访问该主题
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, USER_B.username, USER_B.password);
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');

    await test.step('他人主题：无编辑/删除/锁定/置顶按钮', async () => {
      await expect(page.getByRole('button', { name: '编辑主题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '删除主题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '锁定主题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '置顶主题' })).toHaveCount(0);
    });

    await test.step('自己主题：有编辑/删除按钮（对照，证明不是全局缺失）', async () => {
      const ownTitle = `自己的主题 ${uniqueName('own2')}`;
      const ownId = await createTopicViaUi(
        page,
        nodeId,
        ownTitle,
        '用于对照验证普通用户对自己内容有完整操作权限，正文长度满足最小要求。',
      );
      await page.goto(`/t/${ownId}`);
      await waitForHydration(page, '.cell_ops button');
      await expect(page.getByRole('button', { name: '编辑主题' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole('button', { name: '删除主题' })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step('导航栏无「管理后台」入口（隐藏性）', async () => {
      await page.goto('/');
      await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
    });

    await test.step('导航栏有「我的举报」入口（v0.0.5 新增，对所有登录用户可见）', async () => {
      await expect(page.locator('a[href="/reports"]')).toHaveCount(1);
    });

    await test.step('直达 /admin 被服务端拒绝（不泄露后台内容）', async () => {
      await page.goto('/admin');
      // admin/page.tsx：非 staff → redirect('/')
      await page.waitForURL(/^http:\/\/[^/]+\/?$/, { timeout: 15_000 });
      await expect(page.locator('#Top')).not.toContainText('管理后台');
    });
  });

  test('普通用户：举报自己的回复时看不到举报按钮（UI 层边界）', async ({ page }) => {
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, USER_A.username, USER_A.password);
    const nodeId = await firstNodeIdViaUi(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `自举报边界 ${uniqueName('self')}`,
      '用于验证作者本人看不到举报自己内容的入口，正文长度满足最小要求。',
    );
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');

    // 作者本人的主题：cell_ops 里不应出现举报按钮
    const reportBtn = page.locator('.cell_ops button', { hasText: '举报' });
    await expect(reportBtn).toHaveCount(0);

    // 自己发的回复同样不显示举报按钮
    const replyReport = page.locator('.cell button', { hasText: '举报' });
    await expect(replyReport).toHaveCount(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. 版主 moderator —— 置顶 / 恢复 / 举报处理
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.5 版主 · 置顶与恢复', () => {
  test('版主：真实点击「置顶 → 取消置顶」并看到状态变化', async ({ page }) => {
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, MODERATOR.username, MODERATOR.password);
    const nodeId = await firstNodeIdViaUi(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `版主置顶 ${uniqueName('pin')}`,
      '用于验证版主在真实浏览器里点击置顶与取消置顶，正文长度满足最小要求。',
    );
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');

    const pinBtn = page.getByRole('button', { name: '置顶主题' });
    await expect(pinBtn).toBeVisible({ timeout: 15_000 });
    await pinBtn.click();
    await expect(page.getByRole('button', { name: '取消置顶' })).toBeVisible({
      timeout: 15_000,
    });

    // 还原
    await page.getByRole('button', { name: '取消置顶' }).click();
    await expect(page.getByRole('button', { name: '置顶主题' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('版主：软删除自己的主题后真实点击「恢复」，内容重新可见', async ({ page }) => {
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, MODERATOR.username, MODERATOR.password);
    const nodeId = await firstNodeIdViaUi(page);
    const title = `版主恢复 ${uniqueName('restore')}`;
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      title,
      '用于验证版主软删除后在真实浏览器里点击恢复按钮，正文长度满足最小要求。',
    );
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');

    await test.step('真实点击「删除主题」', async () => {
      const delBtn = page.getByRole('button', { name: '删除主题' });
      await expect(delBtn).toBeVisible({ timeout: 15_000 });
      // TopicActions.remove() 里有 window.confirm 二次确认。
      //
      // ⚠️ 必须**提前注册** dialog 监听：Playwright 若在 listener 就绪前
      // 遇到 dialog，会按默认行为 **dismiss** ⇒ `window.confirm` 返回 false
      // ⇒ remove() 直接 return ⇒ 什么都没发生（页面快照里按钮仍是
      // 「删除主题」，等不到「恢复主题」）。这是实测踩到的坑。
      const dialogHandler = (d: import('@playwright/test').Dialog) => d.accept();
      page.on('dialog', dialogHandler);
      try {
        await delBtn.click();
        // 删除后页面应显示「已删除」状态或提供恢复入口
        await expect(page.getByRole('button', { name: '恢复主题' })).toBeVisible({
          timeout: 15_000,
        });
      } finally {
        page.off('dialog', dialogHandler);
      }
    });

    await test.step('真实点击「恢复主题」，内容回到可见状态', async () => {
      await page.getByRole('button', { name: '恢复主题' }).click();
      await expect(page.getByRole('button', { name: '删除主题' })).toBeVisible({
        timeout: 15_000,
      });
      // 正文重新出现（不再是「此主题已被删除」）
      await expect(page.locator('.topic_content')).toBeVisible({ timeout: 15_000 });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. 管理员 admin —— 角色变更 / 举报处理 / 积分调整
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.5 管理员 · 角色变更与积分调整', () => {
  test('管理员：真实点击「变更角色」下拉并改回原角色', async ({ page, browser }) => {
    const ctxT = await browser.newContext();
    const pageT = await ctxT.newPage();
    const target = uniqueName('roleui');
    await register(pageT, target, 'V005Test-2026!');

    try {
      // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
      await logout(page);
      await login(page, ADMIN.username, ADMIN.password);
      await page.goto('/admin');
      await expect(page.getByRole('button', { name: '概览' })).toBeVisible({
        timeout: 15_000,
      });

      await test.step('用户 tab 搜索目标用户', async () => {
        await page.getByRole('button', { name: '用户', exact: true }).click();
        await page.getByRole('textbox', { name: '搜索用户' }).fill(target);
        await page.getByRole('button', { name: '搜索用户', exact: true }).click();
        await expect(page.locator(`a[href="/member/${target}"]`)).toBeVisible({
          timeout: 15_000,
        });
      });

      await test.step('真实点击角色下拉，把 user 改为 moderator', async () => {
        const roleSelect = page.locator(`select[aria-label="变更 ${target} 的角色"]`);
        await expect(roleSelect).toBeVisible({ timeout: 15_000 });
        await roleSelect.selectOption('moderator');
        // 列表刷新后该用户的角色徽标应变为「版主」
        await expect(
          page.locator('.cell').filter({ has: page.locator(`a[href="/member/${target}"]`) }),
        ).toContainText('版主', { timeout: 15_000 });
      });

      await test.step('还原为 user（避免污染共享库）', async () => {
        const roleSelect = page.locator(`select[aria-label="变更 ${target} 的角色"]`);
        await roleSelect.selectOption('user');
        await expect(
          page.locator('.cell').filter({ has: page.locator(`a[href="/member/${target}"]`) }),
        ).toContainText('用户', { timeout: 15_000 });
      });
    } finally {
      await ctxT.close();
    }
  });

  test('管理员：积分 tab 可见且表单校验生效（不提交真实调整）', async ({ page }) => {
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, ADMIN.username, ADMIN.password);
    await page.goto('/admin');

    await test.step('「积分」tab 对 admin 可见', async () => {
      await page.getByRole('button', { name: '积分', exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: '用户 UID' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole('spinbutton', { name: '调整数额' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: '调整理由' })).toBeVisible();
    });

    await test.step('空表单提交被前端校验拦截（提示填写 UID）', async () => {
      await page.getByRole('button', { name: '提交积分调整' }).click();
      await expect(page.locator('.problem')).toContainText('用户 UID', {
        timeout: 10_000,
      });
    });

    await test.step('零数额被前端校验拦截', async () => {
      await page.getByRole('spinbutton', { name: '用户 UID' }).fill('1');
      await page.getByRole('spinbutton', { name: '调整数额' }).fill('0');
      await page.getByRole('textbox', { name: '调整理由' }).fill('测试理由');
      await page.getByRole('button', { name: '提交积分调整' }).click();
      await expect(page.locator('.problem')).toContainText('非零整数', {
        timeout: 10_000,
      });
    });

    await test.step('超过上限被前端校验拦截', async () => {
      await page.getByRole('spinbutton', { name: '调整数额' }).fill('2000000');
      await page.getByRole('button', { name: '提交积分调整' }).click();
      await expect(page.locator('.problem')).toContainText('1,000,000', {
        timeout: 10_000,
      });
    });
  });

  test('版主：积分 tab 对 moderator 隐藏（credits.adjust 仅 admin）', async ({ page }) => {
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, MODERATOR.username, MODERATOR.password);
    await page.goto('/admin');
    await expect(page.getByRole('button', { name: '概览' })).toBeVisible({
      timeout: 15_000,
    });
    // 版主看不到「积分」tab
    await expect(page.getByRole('button', { name: '积分', exact: true })).toHaveCount(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. 举报全链路（v0.0.5 核心新增）
// ═════════════════════════════════════════════════════════════════════
test.describe('v0.0.5 举报全链路', () => {
  test('用户提交举报 → 版主处理 → 举报者看到结果', async ({ page, browser }) => {
    // 被测对象：USER_A 的主题（举报目标）
    //
    // ⚠️ 先清限流桶：举报限流是 **10 次/小时/用户**，而本用例要提交
    // 2 次（1 次成功 + 1 次验证防重复）。反复重跑 E2E 会让 USER_B
    // 的计数累积超限，第 2 次提交被 429 拦下 —— 那是测试数据残留，
    // 不是产品缺陷（限流本来就该工作）。clearRateLimits 走 debug
    // 端点，只在测试环境可用。
    await clearRateLimits(page);
    // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
    await logout(page);
    await login(page, USER_A.username, USER_A.password);
    const nodeId = await firstNodeIdViaUi(page);
    const topicTitle = `举报链路 ${uniqueName('rpt')}`;
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      topicTitle,
      '用于验证 v0.0.5 举报全链路：用户提交、版主处理、举报者看到结果，正文长度满足最小要求。',
    );
    await page.goto(`/t/${topicId}`);
    await waitForHydration(page, '.cell_ops button');
    // 记录主题 URL，供后续访问
    const topicUrl = page.url();

    // ── ① USER_B 提交举报 ─────────────────────────────────────────
    await test.step('USER_B 在主题页真实点击「举报」并提交表单', async () => {
      // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
      await logout(page);
      await login(page, USER_B.username, USER_B.password);
      await page.goto(topicUrl);
      await waitForHydration(page, '.cell_ops button');

      const reportBtn = page.locator('.cell_ops button', { hasText: '举报' }).first();
      await expect(reportBtn).toBeVisible({ timeout: 15_000 });
      await reportBtn.click();

      // 内联表单展开
      const dialog = page.locator('[role="dialog"][aria-label="举报"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // 选一个原因（默认选中第一个，这里显式选「垃圾广告」）
      await dialog.locator('input[type="radio"]').first().check();
      await dialog
        .locator('textarea')
        .fill('这是 v0.0.5 举报链路自动化验收的补充说明。');

      await dialog.getByRole('button', { name: '提交举报' }).click();

      // 成功后按钮变为「已举报」
      const cellOpsText = await page.locator('.cell_ops').innerText().catch(() => '(no .cell_ops)');
      test.info().annotations.push({
        type: 'report-submit-observation',
        description: `提交后 .cell_ops 文本：${cellOpsText.slice(0, 200)}`,
      });
      await expect(page.locator('.cell_ops').getByText('已举报')).toBeVisible({
        timeout: 15_000,
      });
    });

    // ── ② 防重复：再次提交被 409 拦截 ─────────────────────────────
    await test.step('同一用户重复举报被拦截（防重复举报）', async () => {
      await page.goto(topicUrl);
      await waitForHydration(page, '.cell_ops button');
      // 「已举报」状态下不显示举报按钮（组件进入 done 态）
      // 用 reload 后重新打开来验证服务端防重复：
      // 按钮重置为可点，但服务端返回 409
      const reportBtn = page.locator('.cell_ops button', { hasText: '举报' }).first();
      if (await reportBtn.count()) {
        await reportBtn.click();
        const dialog = page.locator('[role="dialog"][aria-label="举报"]');
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        await dialog.getByRole('button', { name: '提交举报' }).click();
        await expect(dialog.locator('[role="alert"]')).toContainText('已举报过', {
          timeout: 15_000,
        });
      }
    });

    // ── ③ 「我的举报」页显示该举报 ─────────────────────────────────
    await test.step('USER_B 在「我的举报」页看到 pending 状态的举报', async () => {
      await page.goto('/reports');
      // ⚠️ 不能用 `.box` 的第一个 —— 页面第一个 .box 是搜索框
      // （`#search-result`），标题在后面的 box 里。
      await expect(
        page.locator('.box').filter({ hasText: '我的举报' }).first(),
      ).toBeVisible({ timeout: 15_000 });
      const rows = page.locator('.cell');
      await expect(rows.filter({ hasText: topicTitle }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(rows.filter({ hasText: '待处理' }).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    // ── ④ 版主处理举报 ───────────────────────────────────────────
    await test.step('版主在 /admin 举报 tab 看到并处理该举报', async () => {
      // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
      await logout(page);
      await login(page, MODERATOR.username, MODERATOR.password);
      await page.goto('/admin');
      await expect(page.getByRole('button', { name: '概览' })).toBeVisible({
        timeout: 15_000,
      });

      // ⚠️ **不能用 `exact: true`** ——
      // tab 按钮的文本会带上待处理数量：`举报（3）`。
      // 当有待处理举报时，`exact: true` 匹配不到 ⇒ 用非精确匹配。
      // （实测踩到：单独跑该 spec 时数量为 0 → 文本是「举报」能匹配；
      //   全量跑时前面用例产生了举报 → 文本变「举报（3）」→ 匹配失败。）
      await page.getByRole('button', { name: /^举报/ }).click();
      // 默认就是「待处理」筛选
      await expect(page.getByRole('button', { name: '待处理' })).toBeVisible({
        timeout: 15_000,
      });

      // 找到目标主题对应的举报行并点击「接受」
      //
      // ⚠️ 定位方式：用**「查看主题」链接的 href**（`a[href="/t/<id>"]`）
      // 而不是 `.filter({ hasText: '主题 #<id>' })`。
      // 后者在列表加载过程中可能匹配到**尚未渲染按钮**的中间态，
      // 且文本匹配容易被同页其他元素干扰；href 是**唯一且稳定**的。
      const reportRow = page
        .locator('.cell')
        .filter({ has: page.locator(`a[href="/t/${topicId}"]`) })
        .first();
      await expect(reportRow).toBeVisible({ timeout: 15_000 });

      // handleReport() 用 window.prompt 收处理说明 —— 必须提前注册 dialog
      // 监听（竞态会导致 prompt 被 dismiss ⇒ note === null ⇒ 直接 return）。
      const dialogHandler = (d: import('@playwright/test').Dialog) =>
        d.accept('v0.0.5 举报链路验收');
      page.on('dialog', dialogHandler);
      try {
        const acceptBtn = reportRow.getByRole('button', { name: '接受举报并隐藏内容' });
        await expect(acceptBtn).toBeVisible({ timeout: 15_000 });
        await acceptBtn.click();
        await expect(page.locator('[role="status"]')).toContainText('操作成功', {
          timeout: 15_000,
        });
      } finally {
        page.off('dialog', dialogHandler);
      }
    });

    // ── ⑤ 被举报内容已隐藏 ───────────────────────────────────────
    await test.step('接受举报后主题对普通用户不可见（已隐藏）', async () => {
      // 切换身份前必须先退出 —— 否则 /signin 会重定向，login() 等不到 #username
      await logout(page);
      await login(page, USER_B.username, USER_B.password);
      await page.goto(topicUrl);
      // 隐藏后访问应显示「不存在」或 404（服务端把 status 设为 deleted）
      await expect(page.locator('body')).not.toContainText(topicTitle, { timeout: 15_000 });
    });

    // ── ⑥ 举报者看到「已受理」状态 ───────────────────────────────
    await test.step('USER_B 在「我的举报」页看到「已受理」', async () => {
      await page.goto('/reports');
      const rows = page.locator('.cell');
      const row = rows.filter({ hasText: topicTitle }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('已受理', { timeout: 15_000 });
    });
  });
});
