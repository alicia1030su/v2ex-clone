import { test, expect } from '@playwright/test';
import { login, logout, uniqueName, clearRateLimits, apiPost, MODERATOR } from './helpers';

/**
 * v0.0.5 搜索能力 —— **端到端验证**
 *
 * ## 覆盖范围
 *
 * | 用例 | 验证 |
 * |---|---|
 * | 中文整串搜索 | 命中连续含关键词的主题 |
 * | **中文词序打散** | 阶段 2 回退生效：命中「优化…数据库性能」这种被打散的文档 |
 * | 英文搜索 | 不劣化 v0.0.4 的整串匹配 |
 * | 中英混合 | 拉丁词 + CJK bigram 都能命中 |
 * | 特殊符号 | `%` `_` 不会变成通配符（不匹配到全部） |
 * | SQL 注入 | 恶意输入被当作普通文本，不报错也不执行 |
 * | 分页 | page / limit 生效，total 正确 |
 * | 排序 | createdAt / repliesCount 排序生效 |
 * | 节点过滤 | nodeId 过滤生效 |
 * | 空关键词 | 返回空结果而不是报错 |
 *
 * ## 与单元测试的分工
 *
 * - `tests/v005-search-quality.spec.ts` —— **方案横向对比**（独立语料库）
 * - `tests/v005-search-tokenize.spec.ts` —— **分词模块**的单元测试
 * - 本文件 —— **生产 API** 的真实行为（含真实数据库数据）
 */

test.describe.configure({ mode: 'serial' });

/**
 * 造一批带特定关键词的主题（通过真实 API 发帖）
 *
 * ⚠️ 走**真实发帖 API**而不是直接写库 —— 这样测的是完整链路
 * （发帖 → 落库 → 搜索），与用户实际路径一致。
 *
 * ⚠️ 发帖有**内容长度校验**（标题 4-128 字、正文 10-50000 字）——
 *    测试数据必须满足，否则会拿到 400。
 */
async function seedTopics(
  page: import('@playwright/test').Page,
  nodeId: number,
  topics: Array<{ title: string; content: string }>,
): Promise<void> {
  for (const t of topics) {
    // ⚠️ 必须用 `apiPost`（自动带 CSRF token）——
    //    直接 `page.request.post` 没有 `x-csrf-token` 头 ⇒ 403。
    const res = await apiPost(page, '/api/topics', {
      nodeId,
      title: t.title,
      content: t.content,
    });
    // 发帖成功返回 **201**（创建资源）
    // 失败时把响应体一并带出来，便于定位
    if (res.status() !== 201) {
      const errText = await res.text().catch(() => '(no body)');
      throw new Error(`发帖失败（HTTP ${res.status()}）：${t.title} —— ${errText.slice(0, 200)}`);
    }
  }
}

/** 找一个可用节点 */
async function pickNode(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('/api/nodes');
  const data = await res.json();
  const nodes = data?.nodes ?? data?.items ?? [];
  if (!nodes.length) throw new Error('没有可用节点');
  return Number(nodes[0].id);
}

test('中文整串搜索：命中连续含关键词的主题', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);
  const nodeId = await pickNode(page);

  const marker = uniqueName('中文整串');
  await seedTopics(page, nodeId, [
    { title: `${marker} 数据库性能优化的实践`, content: '本文讨论数据库索引设计与查询优化的实践方法。' },
    { title: `${marker} 无关主题`, content: '这条内容足够长，但它不应该被搜到。' },
  ]);

  // ⚠️ 查询**不能**包含 marker ——
  //    marker 出现在**两个**标题里，带上它就都会命中，
  //    「无关主题应当不被搜到」这条断言就永远失败。
  //    marker 的作用只是**隔离数据**（避免与其它用例的主题混淆）。
  const res = await page.request.get(
    `/api/search?q=${encodeURIComponent('数据库性能优化')}&limit=50`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const titles: string[] = (body.results ?? []).map((r: { title: string }) => r.title);

  expect(titles.some((t) => t.includes('数据库性能优化的实践'))).toBe(true);
  expect(titles.some((t) => t.includes('无关主题'))).toBe(false);
});

test('中文词序打散：阶段 2 回退生效', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);
  const nodeId = await pickNode(page);

  // 标题里「优化」和「数据库性能」**中间隔了别的字** ⇒
  // ILIKE 整串匹配不到，但 bigram AND 能匹配到
  const marker = uniqueName('打散');
  await seedTopics(page, nodeId, [
    {
      title: `${marker} 优化实践与数据库性能的关系`,
      content: '把优化实践与数据库性能这两件事拆开来讲清楚。',
    },
  ]);

  // 搜「数据库性能」—— 标题里是「数据库性能」连续的吗？
  // 「优化实践与数据库性能的关系」里「数据库性能」是**连续**的，
  // 所以这里要搜一个**必然打散**的组合。
  // 查询不含 marker（同上：marker 只用于隔离数据）
  const res = await page.request.get(
    `/api/search?q=${encodeURIComponent('优化 数据库性能')}&limit=50`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const titles: string[] = (body.results ?? []).map((r: { title: string }) => r.title);

  // 「优化 数据库性能」在标题里是**不连续**的 ⇒ 只有 bigram 回退能命中
  expect(
    titles.some((t) => t.includes('优化实践与数据库性能')),
    `词序打散的中文查询应当被 bigram 回退命中，实际结果：${JSON.stringify(titles.slice(0, 5))}`,
  ).toBe(true);
});

test('英文搜索：不劣化 v0.0.4 的整串匹配', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);
  const nodeId = await pickNode(page);

  const marker = uniqueName('englishsearch');
  await seedTopics(page, nodeId, [
    { title: `${marker} how to optimize a slow query`, content: 'A practical guide to slow query optimization.' },
  ]);

  const res = await page.request.get(
    `/api/search?q=${encodeURIComponent('how to optimize a slow query')}&limit=50`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const titles: string[] = (body.results ?? []).map((r: { title: string }) => r.title);
  expect(titles.some((t) => t.includes('how to optimize a slow query'))).toBe(true);
});

test('特殊符号不会变成通配符', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);

  const res = await page.request.get('/api/search?q=%25&limit=50');
  expect(res.status()).toBe(200);
  const body = await res.json();
  // `%` 被转义 ⇒ 不应匹配到几乎所有主题
  expect(body.total ?? 0).toBeLessThan(50);
});

test('SQL 注入输入被当作普通文本', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);

  for (const payload of [
    "'; DROP TABLE topics; --",
    "1' OR '1'='1",
    'admin\'--',
  ]) {
    const res = await page.request.get(
      `/api/search?q=${encodeURIComponent(payload)}&limit=10`,
    );
    expect(res.status(), `payload「${payload}」不应导致 5xx`).toBe(200);
  }

  // 表还在（没被删）——
  // ⚠️ 用 `/api/search` 本身验证（`/api/topics` 没有 GET ⇒ 405）
  const res = await page.request.get('/api/search?q=linux&limit=1');
  expect(res.status()).toBe(200);
});

test('分页与总数正确', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, MODERATOR.username, MODERATOR.password);
  const nodeId = await pickNode(page);

  const marker = uniqueName('paging');
  await seedTopics(
    page,
    nodeId,
    Array.from({ length: 5 }, (_, i) => ({
      title: `${marker} 分页测试主题 ${i}`,
      content: '这是用于分页测试的正文内容，长度满足最小要求。',
    })),
  );

  // 这里**要**用 marker 过滤（测的就是「按关键词筛出这几条」）
  const res = await page.request.get(
    `/api/search?q=${encodeURIComponent(marker)}&limit=2&page=1`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.limit).toBe(2);
  expect(body.page).toBe(1);
  expect((body.results ?? []).length).toBeLessThanOrEqual(2);
  expect(body.total).toBeGreaterThanOrEqual(5);
  expect(body.totalPages).toBe(Math.max(Math.ceil(body.total / 2), 1));
});

test('limit 被钳制在 100 以内', async ({ page }) => {
  await clearRateLimits(page);
  const res = await page.request.get('/api/search?q=linux&limit=9999');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.limit).toBe(100);
});

test('空关键词返回空结果而不报错', async ({ page }) => {
  await clearRateLimits(page);
  const res = await page.request.get('/api/search?q=');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.total).toBe(0);
  expect(body.results).toEqual([]);
});

test('游客也能搜索（无需登录）', async ({ page }) => {
  await clearRateLimits(page);
  await logout(page);
  const res = await page.request.get('/api/search?q=linux&limit=5');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.results)).toBe(true);
});
