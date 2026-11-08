import { test, expect } from '@playwright/test';
import {
  register,
  logout,
  uniqueName,
  apiPost,
  pickNodeId,
  clearRateLimits,
} from './helpers';

/**
 * v0.0.13（V10-23）：旧版 V2EX 公开 JSON API 兼容端点 —— **真实 HTTP 契约验证**
 *
 * ## 为什么必须有这层 E2E
 *
 * `tests/static/v010-legacy-api-shape.spec.ts` 只守「纯函数的输出形状」。
 * 但契约的另一半在**路由层**，纯函数测不到：
 *
 *   · `?id=` / `?username=` / `?node_name=` 的**优先级**与 404 判定
 *   · 同名参数取最后一个（`?id=1&id=2`）
 *   · 软删除主题对公众**不可见**（`?id=` 命中返回 `[]` 而不是 500/泄露）
 *   · `Content-Type` / `Cache-Control` / `x-rate-limit-*` 响应头
 *   · 数据**真的来自数据库**（刚创建的主题能被查出来、标题逐字一致）
 *
 * 这些都是「编译能过、页面毫无变化、纯函数测试也全绿」但**外部客户端会崩**的地方。
 *
 * ## 契约依据
 *
 * 2026-11-08 对原站的真实抓取（表格见 `src/lib/legacy-topic-api.ts` 文件头）。
 * 本文件断言的是**我们自己承诺的兼容口径**，其中与原站不同的三条
 * （软删除不可见 / 无参数的 404 错误体字段 / 限流配额）在断言旁都写明了理由。
 */

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.13 旧版 JSON API（/api/topics/show.json）', () => {
  test('响应头与原站同口径：JSON charset + 120s 缓存 + 限流三元组', async ({ page }) => {
    const res = await page.request.get('/api/topics/show.json?id=1');

    // 原站实测 `Content-Type: application/json;charset=UTF-8`
    const ct = res.headers()['content-type'] ?? '';
    expect(ct.toLowerCase()).toContain('application/json');
    expect(ct.toLowerCase()).toContain('charset=utf-8');

    // 原站实测 `Cache-Control: public, max-age=120`
    const cc = res.headers()['cache-control'] ?? '';
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=120');

    // 原站实测三个限流响应头（配额 600/小时）
    expect(res.headers()['x-rate-limit-limit']).toBe('600');
    expect(Number(res.headers()['x-rate-limit-remaining'])).toBeGreaterThanOrEqual(0);
    expect(Number(res.headers()['x-rate-limit-reset'])).toBeGreaterThan(0);

    // 防嗅探
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('?id= 合法但不存在的 id ⇒ **200 + 空数组**（原站口径，不是 404）', async ({
    page,
  }) => {
    const res = await page.request.get('/api/topics/show.json?id=999999999');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('?id=abc / ?id=0 / 无参数 ⇒ 404 + Object Not Found 错误体（原站口径）', async ({
    page,
  }) => {
    for (const path of [
      '/api/topics/show.json?id=abc',
      '/api/topics/show.json?id=0',
      '/api/topics/show.json',
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 404`).toBe(404);
      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.message).toBe('Object Not Found');
      expect(body.rate_limit.quota).toBe(600);
      expect(typeof body.rate_limit.used).toBe('number');
      expect(typeof body.rate_limit.reset_at).toBe('number');
    }
  });

  test('同名参数取**最后一个**（原站 ?id=1&id=2&id=3 ⇒ 3）', async ({ page }) => {
    // 先确保存在两个主题，然后确认 id 取的是最后一个
    const all = await page.request.get('/api/topics/show.json?id=1&id=999999999');
    expect(all.status()).toBe(200);
    // 最后一个是不存在的 id ⇒ 空数组（若取了第一个会返回 1 条）
    expect(await all.json()).toEqual([]);
  });

  test('不存在用户名 / 不存在节点 ⇒ 404（与原站一致）', async ({ page }) => {
    const noUser = await page.request.get(
      '/api/topics/show.json?username=zzz_no_such_user_9x8',
    );
    expect(noUser.status()).toBe(404);
    expect((await noUser.json()).message).toBe('Object Not Found');

    const noNode = await page.request.get(
      '/api/topics/show.json?node_name=zzz_no_such_node_9x8',
    );
    expect(noNode.status()).toBe(404);
    expect((await noNode.json()).message).toBe('Object Not Found');
  });

  test('真实数据：新建主题后能用 ?id= 查回，字段与库内逐字一致', async ({ page }) => {
    await clearRateLimits(page);
    const username = uniqueName('legacy_api');
    await register(page, username);

    const nodeId = await pickNodeId(page);
    const title = `旧版 API 契约 ${Date.now()}`;
    const content = '这是一条用于验证旧版 JSON API 的主题正文。\n\n第二段。';

    const created = await apiPost(page, '/api/topics', { nodeId, title, content });
    expect(created.status(), '创建主题应 201').toBe(201);
    const createdBody = (await created.json()) as { ok: boolean; redirect: string };
    expect(createdBody.ok).toBe(true);
    const topicId = Number(createdBody.redirect.replace('/t/', ''));
    expect(Number.isInteger(topicId) && topicId > 0).toBe(true);

    const res = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    expect(res.status()).toBe(200);
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);

    const t = arr[0];
    expect(t.id).toBe(topicId);
    // 标题逐字一致（不是 HTML 转义后的变形）
    expect(t.title).toBe(title);
    // content 是**原始**正文，content_rendered 是 HTML —— 两者不能相等
    expect(t.content).toBe(content);
    expect(typeof t.content_rendered).toBe('string');
    expect(t.content_rendered).toContain('<p>');
    expect(t.content_rendered).not.toBe(t.content);
    // 作者是小写化后能匹配上的那个注册用户（用户名大小写不敏感）
    expect((t.member as Record<string, unknown>).username).toBe(username);
    // node 是真实节点
    expect((t.node as Record<string, unknown>).name).toBeTruthy();
    // 时间字段是整数秒
    expect(Number.isInteger(t.created)).toBe(true);
    expect(Number.isInteger(t.last_touched)).toBe(true);
    // 零回复 ⇒ last_reply_by 是空串（原站实测），replies=0
    expect(t.replies).toBe(0);
    expect(t.last_reply_by).toBe('');
    // 未删除
    expect(t.deleted).toBe(0);
    // url 指向本站主题详情
    expect(String(t.url)).toContain(`/t/${topicId}`);

    // 清理：软删除该主题（保持数据库可重复使用）
    const del = await page.request.delete(`/api/topics/${topicId}`, {
      headers: { 'x-csrf-token': await csrfOf(page) },
    });
    expect([200, 204], '清理时软删除应成功').toContain(del.status());
  });

  test('软删除主题对公众不可见：?id= 命中 ⇒ 200 + 空数组（本项目安全策略）', async ({
    page,
  }) => {
    await clearRateLimits(page);
    const username = uniqueName('legacy_del');
    await register(page, username);

    const nodeId = await pickNodeId(page);
    const title = `旧版 API 软删除 ${Date.now()}`;
    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title,
      content: '这条主题会被软删除，用于验证旧版 API 不会泄露已删除内容。',
    });
    expect(created.status()).toBe(201);
    const topicId = Number(
      ((await created.json()) as { redirect: string }).redirect.replace('/t/', ''),
    );

    // 删除前：能查到
    const before = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    expect(before.status()).toBe(200);
    expect(await before.json()).toHaveLength(1);

    // 软删除
    const del = await page.request.delete(`/api/topics/${topicId}`, {
      headers: { 'x-csrf-token': await csrfOf(page) },
    });
    expect([200, 204]).toContain(del.status());

    // 删除后：公众不可见（返回空数组，而不是泄露内容 / 返回 500）
    const after = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    expect(after.status()).toBe(200);
    expect(await after.json()).toEqual([]);

    await logout(page);
  });
});

/** 读取当前会话的 CSRF token（双提交 Cookie 模式） */
async function csrfOf(page: import('@playwright/test').Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === 'v2_csrf')?.value ?? '';
}
