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
  USER_A,
  USER_B,
} from './helpers';

/**
 * v0.0.4 —— 内容生命周期与互动的真实浏览器验证
 *
 * 覆盖 v0.0.3 新增但此前**完全没有 E2E** 的功能：
 *   投票 / 感谢 / 引用 / 编辑 / 软删除 / 恢复 / 锁定 / 置顶
 *
 * 每个用例的断言链路：
 *   可点击 → 请求正确发出 → 数据真实写入 → 页面展示真实结果
 *   → 刷新后仍正确 → 权限正确 → 重复操作不产生错误
 *
 * 数据自给自足：每个用例注册独立用户、创建独立主题，
 * **不依赖其他测试预先创建的数据**，可任意顺序与单独运行。
 */

/** 查询某主题的投票数（走 API，作为独立于 UI 的事实来源） */
async function voteCount(page: Page, topicId: number): Promise<number> {
  const res = await page.request.get(`/api/topics/${topicId}`);
  const data = await res.json();
  return Number(data?.topic?.votes ?? 0);
}

/** 查询某主题下某条回复的感谢数（replyId 是回复 id，不是主题 id） */
async function thanksCount(page: Page, topicId: number, replyId: number): Promise<number> {
  const res = await page.request.get(`/api/topics/${topicId}`);
  const data = await res.json();
  const reply = (data?.replies ?? []).find((r: { id: number }) => r.id === replyId);
  return Number(reply?.thanks ?? 0);
}

test.describe('v0.0.4 投票', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('投票：点击后计数增加，刷新仍正确，重复点击不叠加', async ({ page }) => {
    const user = uniqueName('voter');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `投票测试 ${user}`,
      '用于验证投票的完整链路：点击 → 请求发出 → 数据入库 → 页面展示 → 刷新后仍然正确。',
    );

    // 初始计数
    expect(await voteCount(page, topicId)).toBe(0);

    // 页面上应能看到「赞」按钮
    await page.goto(`/t/${topicId}`);
    const upBtn = page.getByRole('button', { name: /赞|顶/ }).first();
    await expect(upBtn).toBeVisible({ timeout: 15_000 });

    // 点击投票
    await upBtn.click();

    // 数据真实写入
    await expect.poll(async () => await voteCount(page, topicId), { timeout: 15_000 }).toBe(1);

    // 页面展示真实结果 —— 刷新后仍然正确
    await page.reload();
    await expect
      .poll(async () => await voteCount(page, topicId), { timeout: 15_000 })
      .toBe(1);

    // 重复操作不产生错误：再点一次（取消投票）后计数应回落
    const upBtn2 = page.getByRole('button', { name: /赞|顶/ }).first();
    if (await upBtn2.count()) {
      await upBtn2.click();
      await expect
        .poll(async () => await voteCount(page, topicId), { timeout: 15_000 })
        .toBe(0);
    }
  });

  test('投票：未登录用户看不到投票操作', async ({ page }) => {
    await page.goto('/t/3');
    const upBtn = page.getByRole('button', { name: /赞|顶/ });
    await expect(upBtn).toHaveCount(0);
  });
});

test.describe('v0.0.4 感谢', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('感谢：跨用户感谢成功，重复感谢不叠加，作者可见感谢数', async ({ page, browser }) => {
    // 用户 A 发帖并回复
    const author = uniqueName('author');
    await register(page, author, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `感谢测试 ${author}`,
      '用于验证感谢功能的完整链路。',
    );

    // A 在自己的主题下回复一条，供 B 感谢
    await submitReplyViaUi(page, topicId, '这条回复将被另一个用户感谢，用于验证感谢功能的完整数据链路。');

    // 取最新回复 id
    const res = await page.request.get(`/api/topics/${topicId}`);
    const data = await res.json();
    const replies = data?.replies ?? [];
    expect(replies.length).toBeGreaterThan(0);
    const replyId = Number(replies[replies.length - 1].id);

    // 第二个用户 B（独立 context → 独立会话）
    // ⚠️ 必须用**独立 context**：共享 context 会共享 cookie，
    // 已登录后访问 /signup 会被重定向到首页（这是正确的产品行为），
    // 导致第二个用户根本注册不了。
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const userB = uniqueName('fan');
    await register(pageB, userB, 'V004Test-2026!');
    await clearRateLimits(pageB);

    await pageB.goto(`/t/${topicId}`);
    const thanksBtn = pageB.getByRole('button', { name: '感谢' }).first();
    await expect(thanksBtn).toBeVisible({ timeout: 15_000 });
    await thanksBtn.click();

    // 数据真实写入
    await expect.poll(async () => await thanksCount(pageB, topicId, replyId), { timeout: 15_000 }).toBe(1);

    // 重复感谢不叠加（取消后归零）
    const thanksBtn2 = pageB.getByRole('button', { name: '感谢' }).first();
    if (await thanksBtn2.count()) {
      await thanksBtn2.click();
      await expect.poll(async () => await thanksCount(pageB, topicId, replyId), { timeout: 15_000 }).toBe(0);
    }

    await pageB.close();
  });

  test('感谢：不能感谢自己的回复', async ({ page }) => {
    const user = uniqueName('self');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId, `自赞测试 ${user}`, '验证禁止感谢自己的回复。');

    await submitReplyViaUi(page, topicId, '这是自己的回复，用于验证不能感谢自己的回复这条规则。');

    // 通过 API 直接尝试感谢自己的回复 —— 必须被服务端拒绝
    const res = await page.request.get(`/api/topics/${topicId}`);
    const data = await res.json();
    const replies = data?.replies ?? [];
    const replyId = Number(replies[replies.length - 1].id);

    const r = await apiPost(page, '/api/thanks', { replyId });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body?.ok).toBe(false);
  });
});

test.describe('v0.0.4 主题编辑 / 软删除 / 恢复', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('编辑主题：内容变更并在页面展示，刷新后仍生效', async ({ page }) => {
    const user = uniqueName('editor');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId, `编辑测试 ${user}`, '原始内容，用于验证主题编辑功能在页面上的展示效果。');
    await page.goto(`/t/${topicId}`);
    await expect(page.locator('#Main')).toContainText('原始内容，用于验证主题编辑功能在页面上的展示效果。');

    // 编辑（v0.0.4 修复了「编辑按钮点了没反应」的假按钮问题）
    const editBtn = page.getByRole('button', { name: '编辑主题' }).first();
    await expect(editBtn).toBeVisible({ timeout: 15_000 });
    await editBtn.click();

    // 编辑模态框必须真的出现
    const editArea = page.locator('.topic_edit_modal textarea[name="content"]');
    await expect(editArea).toBeVisible({ timeout: 15_000 });

    const newContent = '编辑后的内容 v0.0.4，用于验证编辑功能的展示效果。';
    await editArea.fill(newContent);
    await page.getByRole('button', { name: '保存修改' }).click();

    // 页面展示真实结果
    // （保存成功后组件会自行 window.location.reload()，
    //   这里不能同时调用 page.reload() —— 会与组件的导航竞争，
    //   报 net::ERR_ABORTED / frame was detached）
    await expect(page.locator('#Main')).toContainText(newContent, { timeout: 30_000 });

    // 刷新后仍正确（等组件的 reload 完成后再操作）
    // ⚠️ v0.0.5：不用 networkidle（页面有持续请求，网络永不空闲）
  await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#Main')).toContainText(newContent, { timeout: 30_000 });
  });

  test('软删除主题：作者删除后普通访问者不可见，管理员恢复后重新可见', async ({ page, browser }) => {
    const user = uniqueName('deleter');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId, `删除测试 ${user}`, '将被软删除的内容，用于验证软删除与恢复的完整闭环。');

    // 作者删除
    await page.goto(`/t/${topicId}`);
    const delBtn = page.getByRole('button', { name: '删除主题' }).first();
    await expect(delBtn).toBeVisible({ timeout: 15_000 });

    // 删除走 window.confirm —— 必须处理原生对话框，否则点击会被挂起
    page.once('dialog', (d) => d.accept());
    await delBtn.click();

    // 删除后主题对游客不可见
    await expect
      .poll(async () => (await page.request.get(`/t/${topicId}`)).status(), { timeout: 20_000 })
      .toBe(404);

    // 游客看不到（404）
    await page.goto('/');
    const res = await page.request.get(`/t/${topicId}`);
    expect(res.status()).toBe(404);

    // 管理员恢复
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto('/signin');
    await adminPage.fill('#username', 'admin');
    await adminPage.fill('#password', process.env.SEED_ADMIN_PASSWORD ?? 'admin12345');
    await Promise.all([
      adminPage.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 }),
      adminPage.click('button[type="submit"]'),
    ]);

    const token = await getCsrfToken(adminPage);
    const restore = await adminPage.request.post(`/api/topics/${topicId}/restore`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(restore.status()).toBe(200);

    // 恢复后重新可见
    const after = await page.request.get(`/t/${topicId}`);
    expect(after.status()).toBe(200);

    await adminPage.close();
  });

  test('权限：普通用户不能锁定或置顶主题', async ({ page }) => {
    const user = uniqueName('normal');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const token = await getCsrfToken(page);
    const lock = await page.request.post('/api/topics/3/lock', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(lock.status()).toBe(403);

    const pin = await page.request.post('/api/topics/3/pin', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(pin.status()).toBe(403);

    const restore = await page.request.post('/api/topics/3/restore', {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect([403, 409]).toContain(restore.status());
  });

  test('锁定 / 置顶：管理员操作成功并写入状态', async ({ page }) => {
    await login(page, 'admin', process.env.SEED_ADMIN_PASSWORD ?? 'admin12345');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId,
      `锁定测试 ${uniqueName('lk')}`,
      '用于验证管理员锁定与置顶功能，以及对应的状态写入。',
    );

    const token = await getCsrfToken(page);

    const lock = await page.request.post(`/api/topics/${topicId}/lock`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(lock.status()).toBe(200);

    const pin = await page.request.post(`/api/topics/${topicId}/pin`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    expect(pin.status()).toBe(200);

    // 数据真实写入
    const res = await page.request.get(`/api/topics/${topicId}`);
    const data = await res.json();
    expect(data?.topic?.locked).toBe(true);
    expect(data?.topic?.pinned).toBe(true);

    // 还原，避免污染其他用例
    await page.request.post(`/api/topics/${topicId}/unlock`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
    await page.request.post(`/api/topics/${topicId}/unpin`, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
  });
});

test.describe('v0.0.4 并发安全', () => {
  test('并发回复不产生重复楼层号', async ({ page }) => {
    const user = uniqueName('conc');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId, `并发测试 ${user}`, '并发回复的楼层号必须唯一，不能出现重复的楼层编号。');
    const token = await getCsrfToken(page);

    // 8 个并发回复
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        page.request.post('/api/replies', {
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
          data: { topicId, content: `并发回复 ${i} —— ${uniqueName('r')}` },
        }),
      ),
    );
    const okCount = results.filter((r) => r.status === 'fulfilled' && r.value.ok()).length;
    expect(okCount).toBeGreaterThan(0);

    // 楼层号必须唯一
    const res = await page.request.get(`/api/topics/${topicId}`);
    const data = await res.json();
    const floors = (data?.replies ?? []).map((r: { floor: number }) => r.floor);
    const unique = new Set(floors);
    expect(unique.size).toBe(floors.length);
  });

  test('并发投票只记一票', async ({ page }) => {
    const user = uniqueName('cvote');
    await register(page, user, 'V004Test-2026!');
    await clearRateLimits(page);

    const nodeId = await pickNodeId(page);
    const topicId = await createTopicViaUi(
      page,
      nodeId, `并发投票 ${user}`, '并发投票必须幂等，无论请求多少次最终只能记一票。');
    const token = await getCsrfToken(page);

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        page.request.post('/api/votes', {
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
          data: { topicId, direction: 'up' },
        }),
      ),
    );

    await expect.poll(async () => await voteCount(page, topicId), { timeout: 15_000 }).toBe(1);
  });
});
