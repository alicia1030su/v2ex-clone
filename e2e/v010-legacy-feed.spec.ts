import { test, expect } from '@playwright/test';

/**
 * v0.0.13（V10-24）：旧版 **Feed 路径**（`/feed/{node}.xml|json`）的 E2E
 *
 * ## 为什么必须有这层 E2E
 *
 * `tests/static/v010-legacy-feed-shape.spec.ts` 只验证「给定频道对象时
 * 生成的字符串形状对不对」。但**路由层**有三件事纯函数测不到：
 *
 *   · 路径解析：`/feed/{node}.xml` 的后缀拆分、无扩展名 ⇒ 404
 *   · 节点不存在 ⇒ 404（而不是 500 或空 feed）
 *   · `Content-Type` / `Cache-Control` 响应头
 *
 * 这三件事任何一项坏掉，RSS 阅读器就订阅不上，而**站内页面一切正常**。
 *
 * ## 契约依据（2026-11-08 实测）
 *
 * | 请求 | 原站 |
 * |---|---|
 * | `/feed/programmer.xml` | 200 Atom，`application/atom+xml;charset=UTF-8`，`max-age=600` |
 * | `/feed/programmer.json` | 200 JSON Feed **1.0**，`max-age=1800` |
 * | `/feed/zzz_nomode.xml` | 404 |
 * | `/feed/programmer`（无扩展名） | 404 |
 *
 * 关于 `/feed/all.xml`：原站返回 200 但 body **长度为 0**（视为原站缺陷）。
 * 本项目返回合法的全站 Atom —— **有意偏离**，断言写明理由。
 */

test.describe('v0.0.13 旧版 Feed 路径（/feed/{node}.xml|.json）', () => {
  test('节点 Atom：200 + 正确 Content-Type/Cache-Control + 结构合法', async ({ page }) => {
    const res = await page.request.get('/feed/programmer.xml');
    expect(res.status()).toBe(200);

    // 实测原站：`application/atom+xml;charset=UTF-8`
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('application/atom+xml');
    expect(res.headers()['cache-control']).toContain('max-age=600');

    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<entry>');
    // 条目 link 带楼层锚点（原站形状）
    expect(xml).toMatch(/\/t\/\d+#reply\d+/);
  });

  test('节点 JSON Feed：200 + 1.0 版本号 + 1.0 的 author 对象', async ({ page }) => {
    const res = await page.request.get('/feed/programmer.json');
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('application/json');
    expect(res.headers()['cache-control']).toContain('max-age=1800');

    const feed = await res.json();
    // 原站是 1.0，不是 1.1
    expect(feed.version).toBe('https://jsonfeed.org/version/1');
    expect(typeof feed.title).toBe('string');
    expect(typeof feed.home_page_url).toBe('string');
    expect(typeof feed.feed_url).toBe('string');
    expect(Array.isArray(feed.items)).toBe(true);

    if (feed.items.length > 0) {
      const item = feed.items[0];
      // 1.0 用 author{}；不得出现 1.1 的 authors[]
      expect(item.author).toBeTruthy();
      expect(item.authors).toBeUndefined();
      expect(typeof item.content_html).toBe('string');
      expect(item.content_html.length).toBeGreaterThan(0);
      // 原站条目无 content_text / summary
      expect(item.content_text).toBeUndefined();
      // date_published 用 +00:00 偏移（原站形状）
      expect(String(item.date_published)).toMatch(/\+00:00$/);
    }
  });

  test('不存在的节点 ⇒ 404（不是 500、也不是空 feed）', async ({ page }) => {
    for (const path of ['/feed/zzz_no_such_node_9x8.xml', '/feed/zzz_no_such_node_9x8.json']) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 404`).toBe(404);
      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.message).toBe('Object Not Found');
    }
  });

  test('无扩展名 / 非法扩展名 ⇒ 404（原站同样 404）', async ({ page }) => {
    for (const path of ['/feed/programmer', '/feed/programmer.xm', '/feed/programmer.html']) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 404`).toBe(404);
    }
  });

  test('/feed/all.xml 返回**合法**全站 Atom（有意偏离原站：原站 body 为空）', async ({
    page,
  }) => {
    const res = await page.request.get('/feed/all.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    // 原站此处返回 200 但 body 长度 0 —— 任何阅读器都解析失败，
    // 本项目不复制该缺陷：必须是一份能解析的真 feed。
    expect(xml.length).toBeGreaterThan(100);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<entry>');
  });

  test('节点页侧栏订阅链接指向原站路径（不是内部 /api 路径）', async ({ page }) => {
    const res = await page.request.get('/go/programmer');
    expect(res.status()).toBe(200);
    const html = await res.text();
    // 原站侧栏是 /feed/programmer.xml 与 /feed/programmer.json
    expect(html).toContain('/feed/programmer.xml');
    expect(html).toContain('/feed/programmer.json');
    // 不应再出现内部路径（那是实现细节，不是对外契约）
    expect(html).not.toContain('/api/nodes/programmer/feed');
  });
});
