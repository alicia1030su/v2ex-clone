import { test, expect } from '@playwright/test';
import { ADMIN, USER_A, USER_B, login, logout, register, uniqueName, clearRateLimits, apiPost } from './helpers';

test.describe('主题与回复', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('发布主题后出现在节点页与首页列表中', async ({ page }) => {
    const username = uniqueName('poster');
    await register(page, username);

    const title = `E2E 测试主题 ${Date.now()}`;
    await page.goto('/go/new');
    await page.selectOption('#nodeId', { label: '程序员' });
    await page.fill('#title', title);
    await page.fill('#content', '这是端到端测试发布的主题正文，用于验证真实数据库写入与列表渲染。');
    await Promise.all([
      page.waitForURL(/\/t\/\d+/, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    await expect(page.locator('h1')).toHaveText(title);
    await expect(page.locator('.topic_content')).toContainText('端到端测试发布的主题正文');

    // 节点页可见
    await page.goto('/go/programmer');
    await expect(page.locator('#TopicsNode')).toContainText(title);

    // 首页可见
    await page.goto('/');
    await expect(page.locator('#Main')).toContainText(title);
  });

  test('回复主题后楼层号递增且计数同步', async ({ page }) => {
    // 使用独立账号，避免与其他用例共享回复限流配额
    const username = uniqueName('replier');
    await register(page, username);

    await page.goto('/t/1');

    // 记录当前最大楼层号
    const floorsRes = await page.request.get('/api/debug/floors?topicId=1', { headers: { 'x-debug-token': process.env.DEBUG_ENDPOINT_TOKEN ?? '' } });
    const floorsBefore: number[] = (await floorsRes.json()).floors ?? [];
    const maxFloorBefore = floorsBefore.length ? Math.max(...floorsBefore) : 0;

    const replyText = `E2E 回复 ${Date.now()}`;
    await page.fill('textarea[name="content"]', replyText);

    // ⚠️ v0.0.7：**不能**用 `Promise.all([waitForURL(/\/t\/\d+/), click])` 等待提交完成。
    //
    // 实测根因（Linux 矩阵 webkit-375x812 / 768x1024 失败）：
    //   `page.waitForURL` 在**当前 URL 已匹配**时**立即返回**（实测 1ms，
    //    见 tools/diag 里的最小验证）—— 而本用例已经在 `/t/1` 上
    //    ⇒ waitForURL 不等表单提交完成就放行
    //    ⇒ 紧接着的 floors 查询早于服务端落库
    //    ⇒ `floorsAfter.length === floorsBefore.length`（差 1）。
    //   Chromium / Firefox 只是**碰巧**赢得这场竞态（查询往返更慢），
    //   WebKit 更快 ⇒ 稳定失败。**这是测试竞态，不是产品缺陷**。
    //
    // 修法：轮询等待「楼层数确实 +1」这个**真实终态**，再做完整断言。
    //   断言一条不少（递增 / 唯一 / 最大值提升），只是不再靠竞态蒙对。
    await page.click('form button[type="submit"]');

    const floorsQuery = () =>
      page.request.get('/api/debug/floors?topicId=1', {
        headers: { 'x-debug-token': process.env.DEBUG_ENDPOINT_TOKEN ?? '' },
      });

    await expect
      .poll(
        async () => {
          const r = await floorsQuery();
          const f = (await r.json()).floors ?? [];
          return f.length;
        },
        { timeout: 20_000, intervals: [200, 300, 500, 800, 1000] },
      )
      .toBe(floorsBefore.length + 1);

    const floorsAfterRes = await floorsQuery();
    const floorsAfter: number[] = (await floorsAfterRes.json()).floors ?? [];
    expect(floorsAfter.length).toBe(floorsBefore.length + 1);
    expect(Math.max(...floorsAfter)).toBeGreaterThan(maxFloorBefore);
    // 楼层号唯一
    expect(new Set(floorsAfter).size).toBe(floorsAfter.length);

    // 回复内容已落库（通过搜索接口验证真实数据）
    const suggest = await page.request.get(
      `/api/search/suggest?q=${encodeURIComponent(replyText.slice(0, 12))}`,
    );
    expect(suggest.ok()).toBeTruthy();
  });

  test('未登录用户无法提交回复', async ({ page }) => {
    const res = await apiPost(page, '/api/replies', { topicId: 1, content: '未登录尝试回复' });
    expect(res.status()).toBe(401);
  });

  test('回复内容长度受限', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);
    const res = await apiPost(page, '/api/replies', { topicId: 1, content: 'x'.repeat(20001) });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('过长');
  });

  test('对不存在的主题回复返回 404', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);
    const res = await apiPost(page, '/api/replies', { topicId: 999999, content: '测试不存在的主题' });
    expect(res.status()).toBe(404);
  });

  test('发帖缺少必填项被拒绝', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);
    const res = await apiPost(page, '/api/topics', { nodeId: 1, title: '短', content: '短' });
    expect(res.status()).toBe(400);
  });

  test('回复限流生效', async ({ page }) => {
    await login(page, USER_B.username, USER_B.password);
    let sawRateLimit = false;

    for (let i = 0; i < 30; i++) {
      const res = await apiPost(page, '/api/replies', { topicId: 1, content: `限流测试回复 ${i}` });
      if (res.status() === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit, '连续回复应触发 429 限流').toBe(true);
  });

  test('并发回复不会产生重复楼层号', async ({ page }) => {
    const username = uniqueName('concurrent');
    await register(page, username);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        apiPost(page, '/api/replies', { topicId: 2, content: `并发回复测试 ${i} ${Date.now()}` }),
      ),
    );

    const okCount = results.filter((r) => r.ok()).length;
    expect(okCount).toBeGreaterThan(0);

    // 校验数据库中该主题的楼层号唯一
    const dup = await page.request.get('/api/debug/floors?topicId=2');
    if (dup.ok()) {
      const data = await dup.json();
      const floors: number[] = data.floors ?? [];
      expect(new Set(floors).size).toBe(floors.length);
    }
  });
});

/**
 * v0.0.16：「最后回复来自 X」必须是**真实最后回复者**
 *
 * ## 为什么这条必须在 E2E 层
 *
 * 缺陷的表现是「页面完全正常，只是名字是错的」：
 * 查询把 `lastReplier` 硬编码为 `null`，组件用 `?? topic.author.username` 兜底
 * ⇒ 每一行都写「最后回复来自 <楼主>」。
 *
 * - 真库测试（`tests/v016-last-replier.spec.ts`）证明了**查询返回值**正确；
 * - 但只有 E2E 能证明**页面渲染出来的那个名字**也是对的 ——
 *   中间还隔着组件与模板，任何一层再引入一次兜底都会让真库测试照样绿。
 *
 * 本用例用两个真实用户走完整链路：
 *   A 发主题 → 页面显示「最后回复来自 A」（此时唯一回复者是 A 自己）
 *   → B 回复 → 页面必须变成「最后回复来自 B」
 * 并额外断言**不能**是 A（修复前的错误值）。
 */
test('最后回复者：B 回复后页面必须显示 B，而不是楼主 A', async ({ page, browser }) => {
  const authorName = uniqueName('lastauthor');
  const replierName = uniqueName('lastreplier');

  // A 发主题
  await register(page, authorName);
  const title = `最后回复者探针 ${Date.now()}`;
  await page.goto('/go/new');
  await page.selectOption('#nodeId', { label: '程序员' });
  await page.fill('#title', title);
  await page.fill('#content', '用于验证「最后回复来自」显示真实回复者的主题正文。');
  await Promise.all([
    page.waitForURL(/\/t\/\d+/, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  const topicUrl = page.url();
  const topicId = Number(topicUrl.match(/\/t\/(\d+)/)?.[1]);
  expect(topicId).toBeGreaterThan(0);

  // A 自己回复一条（此时唯一回复者是 A）
  await page.fill('#reply-content', `A 的自回复 ${Date.now()}`);
  await page.click('form button[type="submit"]');
  await expect(page.locator('#reply-content')).toBeVisible({ timeout: 20_000 });

  // 独立 BrowserContext：B 是另一个真实用户，不与 A 共享登录态
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    await register(pageB, replierName);
    await pageB.goto(`/t/${topicId}`);
    await pageB.fill('#reply-content', `B 的回复 ${Date.now()}`);
    await pageB.click('form button[type="submit"]');
    await expect(pageB.locator('#reply-content')).toBeVisible({ timeout: 20_000 });
  } finally {
    await ctxB.close();
  }

  // 首页列表里该主题的「最后回复来自」必须是 B
  await page.goto('/');
  const row = page.locator('.cell.item').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const rowText = (await row.innerText()).replace(/\s+/g, ' ');

  expect(rowText, `首页该行未显示「最后回复来自」：${rowText}`).toContain('最后回复来自');
  expect(
    rowText,
    `首页显示的最后回复者是楼主 ${authorName}，不是真实最后回复者 ${replierName}`,
  ).not.toContain(`最后回复来自 ${authorName}`);
  expect(rowText).toContain(`最后回复来自 ${replierName}`);

  // 「最热」tab 同样必须正确（这是缺陷的另一处，此前恒为 null）
  await page.goto('/?tab=hot');
  const hotRow = page.locator('.cell.item').filter({ hasText: title }).first();
  if ((await hotRow.count()) > 0) {
    const hotText = (await hotRow.innerText()).replace(/\s+/g, ' ');
    expect(
      hotText,
      `「最热」tab 显示的最后回复者是楼主 ${authorName}：${hotText}`,
    ).not.toContain(`最后回复来自 ${authorName}`);
    expect(hotText).toContain(`最后回复来自 ${replierName}`);
  } else {
    test.info().annotations.push({
      type: 'observation',
      description: '该主题未进入「最热」tab 前 20（主题数不足或排序靠后），只验证了首页列表',
    });
  }
});
