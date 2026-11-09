import { test, expect, type Request } from '@playwright/test';

/**
 * v0.0.13（V13-06）：Feed **真实阅读器可订阅性**验收
 *
 * 任务书明确：「验证真实阅读器可以订阅，而不是只用 HTTP 200 证明成功」。
 * 本文件在**浏览器里**用原生 `DOMParser`（严格 XML 解析器）解析 Atom，
 * 再用与真实阅读器相同的步骤提取文章列表：
 *
 *   解析失败（parsererror）→ 取 feed 元数据 → 遍历 entry →
 *   取 id / title / link / updated / content → 校验链接与日期 →
 *   用 If-None-Match 做增量轮询（304 不重复下载正文）
 *
 * 同时覆盖：UTF-8 中文、时间格式、条目 id 稳定、节点过滤、最新排序、
 * Markdown 正文无恶意 HTML、内部链接指向本站、UI 订阅链接可点击、304/ETag。
 * 内部 RSS 2.0 / 站内 Atom / JSON Feed 1.1 与旧版 Atom 1.0 / JSON Feed 1.0
 * 是**不同格式**，文档区分见 `docs/API_SPEC.md` §14.5。
 */

type ReaderArticle = {
  id: string;
  title: string;
  link: string;
  updated: string;
  content: string;
};

/** 在浏览器里跑一个「最小但真实」的 Atom 阅读器 */
async function readAtomInBrowser(page: import('@playwright/test').Page, xml: string) {
  return page.evaluate((source: string) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    const err = doc.getElementsByTagName('parsererror');
    if (err.length > 0) {
      return { ok: false as const, error: err[0].textContent ?? 'XML parse error' };
    }
    const pick = (parent: Element, name: string) =>
      Array.from(parent.children).find((c) => c.tagName === name)?.textContent ?? '';
    const feed = doc.documentElement;
    const articles = Array.from(feed.getElementsByTagName('entry')).map((entry) => {
      const linkEl = Array.from(entry.children).find(
        (c) => c.tagName === 'link' && c.getAttribute('rel') === 'alternate',
      );
      return {
        id: pick(entry, 'id'),
        title: pick(entry, 'title'),
        link: linkEl?.getAttribute('href') ?? '',
        updated: pick(entry, 'updated'),
        content: pick(entry, 'content'),
      };
    });
    return {
      ok: true as const,
      title: pick(feed, 'title'),
      id: pick(feed, 'id'),
      updated: pick(feed, 'updated'),
      articles,
    };
  }, xml);
}

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.13 Feed 阅读器兼容性', () => {
  test('Atom 1.0：严格 XML 解析器可解析，阅读器能取出文章列表', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/feed/programmer.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/atom+xml');

    const xml = await res.text();
    const parsed = await readAtomInBrowser(page, xml);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.id).toContain('/go/programmer');
    expect(parsed.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const articles = parsed.articles as ReaderArticle[];
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.length).toBeLessThanOrEqual(50);

    // UTF-8 中文、条目 id 稳定、时间格式、链接指向本站、正文无恶意 HTML
    const ids = new Set<string>();
    const origin = new URL(page.url()).origin;
    for (const a of articles) {
      expect(a.id).toMatch(/^tag:[^,]+,\d{4}-\d{2}-\d{2}:\/t\/\d+$/);
      expect(ids.has(a.id), '条目 id 必须唯一且稳定').toBe(false);
      ids.add(a.id);
      expect(a.link.startsWith(origin), `链接必须指向本站: ${a.link}`).toBe(true);
      expect(a.link).toMatch(/\/t\/\d+#reply\d+$/);
      expect(a.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(a.content.toLowerCase()).not.toContain('<script');
      expect(a.content.toLowerCase()).not.toContain('javascript:');
      expect(a.content.toLowerCase()).not.toContain('onerror=');
    }
    // UTF-8 完整性：不得出现替换字符；中文若存在必须原样保留。
    // 带中文正文的解析器级断言见 tests/static/v013-feed-safety.spec.ts。
    expect(xml).not.toContain('\uFFFD');
    expect(res.headers()['content-type']).toContain('charset=UTF-8');

    // 按最近活跃排序：updated 非递增
    const times = articles.map((a) => Date.parse(a.updated));
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  test('节点过滤正确：Feed 条目对应的主题确实属于该节点', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/feed/programmer.xml');
    const parsed = await readAtomInBrowser(page, await res.text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const articles = parsed.articles as ReaderArticle[];
    if (articles.length === 0) return;

    const first = articles[0];
    const topicId = Number(first.link.match(/\/t\/(\d+)/)?.[1]);
    expect(Number.isInteger(topicId)).toBe(true);
    const topicRes = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    expect(topicRes.status()).toBe(200);
    const topics = (await topicRes.json()) as Array<{ node: { name: string } }>;
    expect(topics).toHaveLength(1);
    expect(topics[0].node.name).toBe('programmer');
  });

  test('JSON Feed 1.0：阅读器按 1.0 形状解析（author{} 而非 authors[]）', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/feed/programmer.json');
    expect(res.status()).toBe(200);
    const feed = await res.json();
    expect(feed.version).toBe('https://jsonfeed.org/version/1');
    expect(feed.feed_url).toContain('/feed/programmer.json');
    expect(feed.home_page_url).toContain('/go/programmer');
    expect(Array.isArray(feed.items)).toBe(true);
    expect(feed.items.length).toBeLessThanOrEqual(50);

    const origin = new URL(page.url()).origin;
    for (const item of feed.items as Array<Record<string, unknown>>) {
      expect(String(item.id).startsWith(origin)).toBe(true);
      expect(String(item.url)).toMatch(/#reply\d+$/);
      expect(String(item.date_published)).toMatch(/\+00:00$/);
      expect(item.author).toBeTruthy();
      expect(item.authors).toBeUndefined();
      expect(item.content_text).toBeUndefined();
      expect(String(item.content_html).toLowerCase()).not.toContain('<script');
    }
    // UTF-8 完整性（中文正文的解析器级断言见静态护栏）
    expect(JSON.stringify(feed)).not.toContain('\uFFFD');
    expect(res.headers()['content-type']).toContain('charset=utf-8');
  });

  test('不存在节点 / 无扩展名 ⇒ 404；/feed/all.xml 是合法全站 Atom', async ({ page }) => {
    await page.goto('/');
    for (const path of [
      '/feed/zzz_no_such_node_9x8.xml',
      '/feed/zzz_no_such_node_9x8.json',
      '/feed/programmer',
      '/feed/programmer.html',
    ]) {
      expect((await page.request.get(path)).status(), `${path} 应 404`).toBe(404);
    }
    const all = await page.request.get('/feed/all.xml');
    expect(all.status()).toBe(200);
    const parsed = await readAtomInBrowser(page, await all.text());
    expect(parsed.ok).toBe(true);
  });

  test('ETag / 304：阅读器增量轮询不重复下载正文', async ({ page }) => {
    await page.goto('/');
    const first = await page.request.get('/feed/programmer.xml');
    expect(first.status()).toBe(200);
    const etag = first.headers()['etag'];
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const body = await first.text();

    const second = await page.request.get('/feed/programmer.xml', {
      headers: { 'If-None-Match': etag! },
    });
    expect(second.status()).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers()['etag']).toBe(etag);

    // 站内 RSS / Atom / JSON Feed 同样支持条件请求
    for (const path of ['/api/feed', '/api/feed/atom', '/api/feed/json']) {
      const r1 = await page.request.get(path);
      expect(r1.status()).toBe(200);
      const tag = r1.headers()['etag'];
      expect(tag, `${path} 应带 ETag`).toBeTruthy();
      const r2 = await page.request.get(path, { headers: { 'If-None-Match': tag! } });
      expect(r2.status(), `${path} 条件请求应 304`).toBe(304);
    }
    expect(body.length).toBeGreaterThan(100);
  });

  test('订阅链接在 UI 上真实可点击且指向可订阅地址', async ({ page }) => {
    // 节点页侧栏在窄视口下会被响应式布局收起；本用例验的是「链接可点击 +
    // 落点可订阅」，不是响应式布局，因此固定桌面视口，保证 15 个矩阵分片口径一致。
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/go/programmer');
    expect(page.url()).toContain('/go/programmer');
    const xmlLink = page.locator('a[href="/feed/programmer.xml"]').first();
    const jsonLink = page.locator('a[href="/feed/programmer.json"]').first();
    await expect(xmlLink).toBeVisible();
    await expect(jsonLink).toBeVisible();

    // 侧栏链接带 target="_blank" ⇒ 真实点击会开新标签页，**当前页 URL 不变**。
    // 用「上下文级请求监听」证明这次点击真的向订阅地址发出了导航请求，
    // 而不是检查一个永远不会改变的 page.url()；新标签页对象只作辅助断言。
    const feedRequests: string[] = [];
    const onRequest = (r: Request) => {
      if (r.url().includes('/feed/programmer.xml')) feedRequests.push(r.url());
    };
    page.context().on('request', onRequest);
    const popupPromise = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await xmlLink.click();
    const popup = await popupPromise;
    try {
      await expect
        .poll(() => feedRequests.length, { timeout: 15_000 })
        .toBeGreaterThan(0);
      expect(feedRequests[0]).toMatch(/\/feed\/programmer\.xml$/);
      // 不断言 popup.url()：XML 文档在不同引擎里可能是渲染、也可能是下载，
      // 上面这条「真实导航请求」已经足以证明点击生效，不引入引擎相关竞态。
    } finally {
      page.context().off('request', onRequest);
      if (popup) await popup.close().catch(() => undefined);
    }

    // 点击落到的地址必须仍是真 Feed（不是 HTML 404 页）
    const followed = await page.request.get('/feed/programmer.xml');
    expect(followed.status()).toBe(200);
    expect(followed.headers()['content-type']).toContain('application/atom+xml');
  });
});
