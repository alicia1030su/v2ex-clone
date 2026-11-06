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
