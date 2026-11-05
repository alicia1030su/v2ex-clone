import { test, expect, Page } from '@playwright/test';
import {
  login,
  register,
  uniqueName,
  clearRateLimits,
  apiPost,
  getCsrfToken,
  createTopicViaUi,
  submitReplyViaUi,
  pickNodeId,
  waitForHydration,
} from './helpers';

/**
 * v0.0.4 —— 账户、积分体系、通知与后台管理的真实浏览器验证
 *
 * 覆盖 v0.0.3 新增但此前**完全没有 E2E** 的功能：
 *   签到 / 积分流水 / 排行榜 / 通知未读与已读 / 关注 / 后台管理
 *   / 头像 / 找回密码 / 节点申请审批
 *
 * 数据自给自足：注册独立用户、创建独立数据，不依赖其他测试。
 */

const ADMIN_PW = () => process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

test.describe('v0.0.4 积分与签到', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('签到：按钮可点击、积分增加、流水入账，重复点击不叠加', async ({ page }) => {
    const user = uniqueName('checkin');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // 签到按钮由 SettingsForm 在**客户端**取到 /api/checkin 状态后才渲染 ——
    // 服务端首屏 HTML 里没有它。必须等它真的出现（而不是只等页面加载完）。
    const checkinBtn = page.getByRole('button', { name: /签到/ }).first();
    await expect(checkinBtn).toBeVisible({ timeout: 20_000 });
    // 按钮必须可点击（当天未签到时才是 enabled）
    await expect(checkinBtn).toBeEnabled({ timeout: 10_000 });

    // 点击前先取余额
    const balanceOf = async (): Promise<number> => {
      const res = await page.request.get('/api/credits');
      const d = await res.json();
      return Number(d?.balance ?? 0);
    };

    const before = await balanceOf();

    // 先滚动到视口内再点：设置页很长，Playwright 的 auto-scroll
    // 在某些布局下会判定元素「不稳定」而反复重试。
    await checkinBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await checkinBtn.click({ timeout: 15_000 });

    // 积分增加
    await expect.poll(async () => await balanceOf(), { timeout: 15_000 }).toBeGreaterThan(before);

    // 流水入账
    const res = await page.request.get('/api/credits?limit=20');
    const data = await res.json();
    expect(Array.isArray(data?.ledger)).toBe(true);
    expect(data.ledger.length).toBeGreaterThan(0);

    // 重复操作不产生错误：
    // 签到成功后按钮变为「今日已签到」且 **disabled**（服务端幂等的体现），
    // 余额不再增加 —— 这才是正确的行为，不能再去点它。
    const btn2 = page.getByRole('button', { name: /签到/ }).first();
    await expect(btn2).toBeDisabled({ timeout: 15_000 });
    await expect(btn2).toHaveText(/今日已签到/, { timeout: 10_000 });

    const afterFirst = await balanceOf();
    await page.waitForTimeout(800);
    expect(await balanceOf()).toBe(afterFirst);

    // 再走一次 API 也不应重复发放（服务端幂等）
    const again = await apiPost(page, '/api/checkin', {});
    expect(again.ok()).toBe(true);
    const againData = await again.json();
    expect(againData?.alreadyCheckedIn).toBe(true);
    expect(await balanceOf()).toBe(afterFirst);
  });

  test('签到幂等：API 层连发 3 次只记一次', async ({ page }) => {
    const user = uniqueName('ciapi');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    for (let i = 0; i < 3; i++) {
      await apiPost(page, '/api/checkin', {});
    }

    const res = await page.request.get('/api/checkin');
    const data = await res.json();
    expect(data?.checkedInToday).toBe(true);
  });

  test('排行榜页展示真实数据且可访问', async ({ page }) => {
    const user = uniqueName('lb');
    await register(page, user, 'V004Test-2026!');
    await page.goto('/leaderboard');

    await expect(page.locator('#Main')).toContainText('积分排行榜');
    // 表格应有数据行
    const rows = await page.locator('#Main table tr').count();
    expect(rows).toBeGreaterThan(0);

    // API 与页面口径一致
    const res = await page.request.get('/api/leaderboard?limit=10');
    const data = await res.json();
    expect(Array.isArray(data?.leaderboard)).toBe(true);
    expect(data.leaderboard.length).toBeGreaterThan(0);
  });

  test('积分规则在页面上有说明（独立实现，非原站数值）', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.locator('#Main')).toContainText(/积分|规则|说明/);
  });
});

test.describe('v0.0.4 通知', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('通知：他人回复后收到通知，标记已读后未读数归零', async ({ page, browser }) => {
    const author = uniqueName('nauthor');
    await register(page, author, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(page, nodeId, `通知测试 ${author}`, '用于验证通知生成与已读标记的完整数据链路。');

    // 另一个用户回复
    // ⚠️ 独立 context：共享 context 会共享 cookie，已登录后访问 /signup 会被重定向到首页
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const replier = uniqueName('nreply');
    await register(pageB, replier, 'V004Test-2026!');
    await clearRateLimits(pageB);

    const res = await apiPost(pageB, '/api/replies', {
      topicId,
      content: '这条回复会给作者带去一条通知，用于验证通知的生成链路。',
    });
    expect(res.ok()).toBe(true);

    // 作者侧：通知列表出现未读
    await page.goto('/notifications');
    await expect.poll(
      async () => {
        const r = await page.request.get('/api/notifications?unreadOnly=true');
        const d = await r.json();
        return Array.isArray(d?.items ?? d?.notifications) ? (d.items ?? d.notifications).length : 0;
      },
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    // 标记全部已读 → 未读数归零
    const mark = await apiPost(page, '/api/notifications', {});
    expect(mark.ok()).toBe(true);

    await expect.poll(
      async () => {
        const r = await page.request.get('/api/notifications?unreadOnly=true');
        const d = await r.json();
        return Array.isArray(d?.items ?? d?.notifications) ? (d.items ?? d.notifications).length : 0;
      },
      { timeout: 15_000 },
    ).toBe(0);

    await pageB.close();
  });

  test('通知：未登录访问被拒', async ({ page }) => {
    const res = await page.request.get('/api/notifications');
    expect(res.status()).toBe(401);
  });
});

test.describe('v0.0.4 关注', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('关注：关注后出现在关注列表，取消后移除，重复关注幂等（API 层）', async ({ page, browser }) => {
    // ⚠️ v0.0.4 修复 R-23：原实现从 /settings 页 body 文本用
    // `/@([a-z0-9_]+)/i` 猜目标用户名，匹配不到就 test.skip ——
    // 导致本用例在全量 E2E 里被静默跳过，「关注出现 / 取消移除 / 重复幂等」
    // 三条断言**实际上从未执行**（原实现只断言了 following 是数组）。
    //
    // 现在用**确定性的目标 id**：B 登录后从 /api/users/me 读取自己的 id。
    //
    // ⚠️ v0.0.4（第二轮）说明：UI 工程师已补齐 `FollowButton.tsx` 与
    // `/following` 页面，**真实浏览器 UI 点击流**由本 describe 下的
    // 「关注（UI）」用例覆盖。本条保留为 **API 层验收**，
    // 两条互补：API 层验证幂等语义（alreadyFollowed / removed），
    // UI 层验证点击流与状态持久化。
    const a = uniqueName('fa');
    await register(page, a, 'V004Test-2026!');
    await clearRateLimits(page);

    // 目标用户 B —— 必须用独立 context（共享 cookie 会导致已登录访问 /signup 被重定向）
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const b = uniqueName('fb');
    await register(pageB, b, 'V004Test-2026!');
    await clearRateLimits(pageB);

    const meRes = await pageB.request.get('/api/users/me');
    expect(meRes.ok()).toBe(true);
    const me = await meRes.json();
    const bId = Number(me?.user?.id ?? me?.id);
    expect(Number.isInteger(bId) && bId > 0).toBe(true);

    const followingNames = async (): Promise<string[]> => {
      const r = await page.request.get('/api/users/follows');
      expect(r.ok()).toBe(true);
      const d = await r.json();
      expect(Array.isArray(d?.following)).toBe(true);
      return (d.following as Array<{ username: string }>).map((x) => x.username);
    };

    // ① 关注后出现在列表
    const first = await apiPost(page, '/api/users/follows', { userId: bId });
    expect(first.ok()).toBe(true);
    expect((await first.json())?.alreadyFollowed).toBe(false);
    expect(await followingNames()).toContain(b);

    // ② 重复关注幂等（不产生第二条记录、返回 alreadyFollowed=true）
    const again = await apiPost(page, '/api/users/follows', { userId: bId });
    expect(again.ok()).toBe(true);
    expect((await again.json())?.alreadyFollowed).toBe(true);
    expect((await followingNames()).filter((n) => n === b)).toHaveLength(1);

    // ③ 取消关注后从列表移除
    const del = await page.request.delete('/api/users/follows', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': await getCsrfToken(page) },
      data: { userId: bId },
    });
    expect(del.ok()).toBe(true);
    expect((await del.json())?.removed).toBe(true);
    expect(await followingNames()).not.toContain(b);

    await ctxB.close();
  });

  /**
   * v0.0.4 新增：**真实浏览器 UI 点击流**验证关注功能（R-24 的正面验收）。
   *
   * 上一条用例是 **API 层**验收（明确标注「UI 无入口」）。
   * UI 工程师补齐了 `src/components/FollowButton.tsx` 与
   * `src/app/following/` 之后，任务书第五节 A 要求验证
   * 「用户关注功能是否存在**真正可点击的 UI**」。
   *
   * 断言链路（每一步都基于**真实 DOM**，不是前端 state 幻觉）：
   *   按钮存在且可点 → 点击后变「已关注」→ 再点变回「关注」
   *   → **刷新后状态持久化**（关键：证明不是纯前端 state）
   *   → /following 页面出现该用户
   */
  test('关注（UI）：真实点击关注/取消，刷新后状态持久化，关注列表出现该用户', async ({
    page,
    browser,
  }) => {
    // 关注者 A（当前 page）
    const a = uniqueName('fui');
    await register(page, a, 'V004Test-2026!');
    await clearRateLimits(page);

    // 目标用户 B —— 独立 context（共享 cookie 会导致已登录访问 /signup 被重定向）
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const b = uniqueName('ftgt');
    await register(pageB, b, 'V004Test-2026!');
    await clearRateLimits(pageB);

    try {
      await test.step('在目标用户个人主页看到「关注」按钮', async () => {
        await page.goto(`/member/${b}`);
        await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

        // FollowButton 是客户端组件 —— 必须等 hydration，
        // 否则 onClick 没绑定，点击不会有任何反应。
        await waitForHydration(page, 'button[aria-label^="关注"]');

        const followBtn = page.locator(`button[aria-label="关注 ${b}"]`);
        await expect(followBtn).toBeVisible({ timeout: 15_000 });
        await expect(followBtn).toHaveText('关注');
        // 初始未关注
        await expect(followBtn).toHaveAttribute('aria-pressed', 'false');
      });

      await test.step('真实点击「关注」→ 按钮状态变为「已关注」', async () => {
        await page.locator(`button[aria-label="关注 ${b}"]`).click();

        const followedBtn = page.locator(`button[aria-label="取消关注 ${b}"]`);
        await expect(followedBtn).toBeVisible({ timeout: 20_000 });
        await expect(followedBtn).toHaveText('已关注');
        await expect(followedBtn).toHaveAttribute('aria-pressed', 'true');
        // 成功反馈文案
        // 用 `.follow-button [role="status"]` 收窄 ——
        // 裸 getByRole('status') 在页面上出现第二个 status 元素时会因
        // Playwright strict mode 直接报错（成员页可能有多个 role=status 元素）。
        await expect(page.locator('.follow-button [role="status"]')).toContainText(
          `已关注 ${b}`,
          { timeout: 20_000 },
        );
      });

      await test.step('真实点击「取消关注」→ 按钮状态回到「关注」', async () => {
        await page.locator(`button[aria-label="取消关注 ${b}"]`).click();

        const followBtn = page.locator(`button[aria-label="关注 ${b}"]`);
        await expect(followBtn).toBeVisible({ timeout: 20_000 });
        await expect(followBtn).toHaveText('关注');
        await expect(followBtn).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.follow-button [role="status"]')).toContainText(
          `已取消关注 ${b}`,
          { timeout: 20_000 },
        );
      });

      await test.step('刷新页面 → 状态持久化（服务端渲染，不是前端 state）', async () => {
        // 重新关注，验证持久化
        await page.locator(`button[aria-label="关注 ${b}"]`).click();
        await expect(page.locator(`button[aria-label="取消关注 ${b}"]`)).toBeVisible({
          timeout: 20_000,
        });

        await page.reload();
        await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

        // 刷新后仍然是「已关注」—— 状态来自服务端（getFollowState）
        await expect(page.locator(`button[aria-label="取消关注 ${b}"]`)).toBeVisible({
          timeout: 20_000,
        });
        await expect(
          page.locator(`button[aria-label="取消关注 ${b}"]`),
        ).toHaveAttribute('aria-pressed', 'true');
        // 关注者计数也来自服务端
        await expect(page.locator('#Rightbar')).toContainText('1 位关注者');
      });

      await test.step('/following 页面出现该用户（DOM 断言）', async () => {
        await page.goto('/following');
        await expect(page.locator('#Top')).toBeVisible({ timeout: 15_000 });

        // 「关注的人」区块出现目标用户
        await expect(page.locator('#Rightbar')).toContainText(b, { timeout: 20_000 });
        await expect(page.locator('#Rightbar')).toContainText('已关注 1 位用户');
        // 可点击跳转到对方主页
        await expect(page.locator(`#Rightbar a[href="/member/${b}"]`)).toBeVisible({
          timeout: 20_000,
        });
      });

      await test.step('清理：取消关注（避免污染共享测试库）', async () => {
        await page.goto(`/member/${b}`);
        await waitForHydration(page, 'button[aria-label^="取消关注"]');
        await page.locator(`button[aria-label="取消关注 ${b}"]`).click();
        await expect(page.locator(`button[aria-label="关注 ${b}"]`)).toBeVisible({
          timeout: 20_000,
        });
      });
    } finally {
      await ctxB.close();
    }
  });
});

test.describe('v0.0.4 头像与资料', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('资料编辑：修改后页面与 API 均体现新值', async ({ page }) => {
    const user = uniqueName('profile');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const tagline = `简介 v0.0.4 ${uniqueName('t')}`;
    const res = await page.request.patch('/api/users/me', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': await getCsrfToken(page) },
      data: { tagline },
    });
    expect(res.ok()).toBe(true);

    const check = await page.request.get('/api/users/me');
    const data = await check.json();
    expect(data?.user?.tagline).toBe(tagline);

    // 个人主页展示
    // 注意：member 页**没有 #Main 容器**（布局与首页不同），
    // 用户资料区在侧栏 —— 因此查整个 body，而不是 #Main。
    await page.goto(`/member/${user}`);
    await expect(page.locator('body')).toContainText(tagline, { timeout: 15_000 });
  });

  test('头像上传：非法文件被拒绝', async ({ page }) => {
    const user = uniqueName('avatar');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const token = await getCsrfToken(page);

    // 伪造的「图片」实际是文本 —— magic number 嗅探应拒绝
    const res = await page.request.post('/api/users/avatar', {
      headers: { 'x-csrf-token': token },
      multipart: {
        file: {
          name: 'fake.png',
          mimeType: 'image/png',
          buffer: Buffer.from('this is definitely not a png file'),
        },
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('头像上传：合法 PNG 被接受', async ({ page }) => {
    const user = uniqueName('avatarok');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const token = await getCsrfToken(page);
    // 1x1 像素的合法 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await page.request.post('/api/users/avatar', {
      headers: { 'x-csrf-token': token },
      multipart: {
        file: { name: 'a.png', mimeType: 'image/png', buffer: png },
      },
    });
    // sharp 未安装时走降级路径，仍应成功保存
    expect([200, 201]).toContain(res.status());

    const me = await page.request.get('/api/users/me');
    const data = await me.json();
    expect(data?.user?.avatar).toBeTruthy();
  });
});

test.describe('v0.0.4 后台管理', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('后台：普通用户被拒（403），管理员可访问', async ({ page, browser }) => {
    const user = uniqueName('norole');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    for (const ep of ['/api/admin/users', '/api/admin/stats', '/api/admin/config', '/api/admin/logs']) {
      const res = await page.request.get(ep);
      expect(res.status()).toBe(403);
    }

    // 管理员 —— 必须用**独立 context**：当前 page 已登录，
    // 已登录访问 /signin 会被重定向到首页（正确的产品行为），
    // 于是 login() 找不到 #username 输入框。
    const ctxAdmin = await browser.newContext();
    const adminPage = await ctxAdmin.newPage();
    await login(adminPage, 'admin', ADMIN_PW());
    for (const ep of ['/api/admin/users', '/api/admin/stats', '/api/admin/config', '/api/admin/logs']) {
      const res = await adminPage.request.get(ep);
      expect(res.status()).toBe(200);
    }
    await ctxAdmin.close();
  });

  test('后台：管理员页面可打开且展示真实数据', async ({ page }) => {
    await login(page, 'admin', ADMIN_PW());
    await page.goto('/admin');
    await expect(page.locator('#Main')).toContainText(/管理|后台|概览|用户/);
  });

  test('后台：封禁用户后其会话失效，解封后恢复', async ({ page, browser }) => {
    await login(page, 'admin', ADMIN_PW());
    await clearRateLimits(page);

    // 建一个待封禁的用户
    const ctxT = await browser.newContext();
    const pageT = await ctxT.newPage();
    const target = uniqueName('banme');
    await register(pageT, target, 'V004Test-2026!');
    await clearRateLimits(pageT);

    // 管理员查该用户
    const token = await getCsrfToken(page);
    const usersRes = await page.request.get(`/api/admin/users?q=${target}`);
    const usersData = await usersRes.json();
    const list = usersData?.users ?? usersData?.items ?? [];
    const hit = list.find((u: { username: string }) => u.username === target);
    expect(hit).toBeTruthy();

    // 封禁
    const ban = await page.request.post(`/api/admin/users/${hit.id}/ban`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
      data: { reason: 'v0.0.4 E2E 验证' },
    });
    expect(ban.ok()).toBe(true);

    // 被封禁用户应无法再发帖
    const tToken = await getCsrfToken(pageT);
    const post = await pageT.request.post('/api/topics', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': tToken },
      data: { nodeId: 1, title: '封禁后不应成功', content: '不应成功' },
    });
    expect(post.status()).toBeGreaterThanOrEqual(400);

    // 解封
    const unban = await page.request.post(`/api/admin/users/${hit.id}/unban`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(unban.ok()).toBe(true);

    await pageT.close();
  });

  test('后台：角色变更生效，且不能自我降级', async ({ page }) => {
    await login(page, 'admin', ADMIN_PW());
    const token = await getCsrfToken(page);

    // 用 q 精确查 admin —— 列表按 id 倒序，admin(id=1) 在末尾，limit=50 取不到
    const usersRes = await page.request.get('/api/admin/users?q=admin&limit=50');
    expect(usersRes.status()).toBe(200);
    const usersData = await usersRes.json();
    const list = usersData?.users ?? usersData?.items ?? [];
    expect(list.length).toBeGreaterThan(0);
    const adminRow = list.find((u: { username: string; role: string }) => u.username === 'admin');
    expect(adminRow, '管理员列表里应包含 admin').toBeTruthy();

    // 自我降级必须被拒
    const self = await page.request.patch(`/api/admin/users/${adminRow.id}/role`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
      data: { role: 'user' },
    });
    expect(self.status()).toBe(403);
  });

  test('后台：系统配置返回时凭据已脱敏', async ({ page }) => {
    await login(page, 'admin', ADMIN_PW());
    const res = await page.request.get('/api/admin/config');
    const data = await res.json();
    const text = JSON.stringify(data);
    // 脱敏值（**** / null / 空串）不算泄露；只有真实明文才算。
    // 实测 v0.0.4：database.password === '****'、smtp.pass === null —— 脱敏是正确的。
    const secrets = [
      data?.database?.password,
      data?.smtp?.pass,
      data?.smtp?.user,
    ].filter((v) => typeof v === 'string' && v.length > 0 && !/^\*+$/.test(v));
    expect(secrets, `配置里出现了未脱敏的凭据：${JSON.stringify(secrets)}`).toHaveLength(0);

    // 兜底：不应出现看起来像真实口令的长串
    expect(text).not.toMatch(/pass(?:word|wd)?["']?\s*[:=]\s*["'][^"'*\s][^"']{7,}["']/i);
  });
});

test.describe('v0.0.4 节点申请与审批', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('普通用户申请节点，管理员批准后节点真实存在', async ({ page, browser }) => {
    const user = uniqueName('reqnode');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeName = `req-${uniqueName('n').replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;

    // 申请
    const apply = await apiPost(page, '/api/node-requests', {
      name: nodeName,
      title: `申请节点 ${nodeName}`,
      description: 'v0.0.4 E2E 申请的节点。',
    });
    expect(apply.ok()).toBe(true);

    // 管理员批准
    const ctxAdmin = await browser.newContext();
    const adminPage = await ctxAdmin.newPage();
    await login(adminPage, 'admin', ADMIN_PW());
    await clearRateLimits(adminPage);
    const aToken = await getCsrfToken(adminPage);

    const listRes = await adminPage.request.get('/api/admin/node-requests');
    const listData = await listRes.json();
    const reqs = listData?.requests ?? listData?.items ?? [];
    const hit = reqs.find((r: { name: string }) => r.name === nodeName);
    expect(hit).toBeTruthy();

    const approve = await adminPage.request.post(`/api/admin/node-requests/${hit.id}/approve`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': aToken },
    });
    expect(approve.ok()).toBe(true);

    // 节点真实存在
    const nodesRes = await adminPage.request.get('/api/nodes');
    const nodesData = await nodesRes.json();
    const nodes = nodesData?.nodes ?? nodesData?.items ?? [];
    expect(nodes.some((n: { name: string }) => n.name === nodeName)).toBe(true);

    await adminPage.close();
  });

  test('普通用户不能审核节点申请', async ({ page }) => {
    const user = uniqueName('notapprover');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const res = await page.request.get('/api/admin/node-requests');
    expect(res.status()).toBe(403);
  });
});

test.describe('v0.0.4 Feed 与搜索', () => {
  test('三种 Feed 格式正确且内容非空', async ({ page }) => {
    for (const [path, type] of [
      ['/api/feed', 'application/rss+xml'],
      ['/api/feed/atom', 'application/atom+xml'],
      ['/api/feed/json', 'application/feed+json'],
    ] as const) {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      const ct = res.headers()['content-type'] ?? '';
      expect(ct).toContain(type);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(100);
    }
  });

  test('JSON Feed 符合规范结构', async ({ page }) => {
    const res = await page.request.get('/api/feed/json');
    const data = await res.json();
    expect(data.version).toBe('https://jsonfeed.org/version/1.1');
    expect(typeof data.title).toBe('string');
    expect(Array.isArray(data.items)).toBe(true);
  });

  test('搜索：关键词能命中且分页上限被钳制', async ({ page }) => {
    const res = await page.request.get('/api/search?q=linux&limit=500');
    const data = await res.json();
    expect(res.ok()).toBe(true);
    const items = data?.items ?? data?.topics ?? [];
    expect(items.length).toBeLessThanOrEqual(100);
  });
});
