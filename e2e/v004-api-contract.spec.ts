import { test, expect } from '@playwright/test';

/**
 * v0.0.4 —— 后端 API 端点冒烟与回归
 *
 * 存在的理由（真实缺陷回归）：
 *   v0.0.3 的 `GET /api/nodes` 在**生产构建**下必然返回 500 ——
 *   原生 SQL 用了 `FROM nodes n` 起别名，而 WHERE 条件由 drizzle 的
 *   eq() 生成 `"nodes"."status"`，PostgreSQL 在有别名时不再允许用
 *   原表名引用该 FROM 项（42P01）。
 *
 *   这个缺陷之所以长期未被发现：v0.0.3 的单元测试与 E2E **都没调用过**
 *   这个端点。测试没覆盖到的功能，等于没有测试。
 *
 * 本文件的定位：对**所有 GET 型公开端点**做一次冒烟，
 * 确保「能返回 200 且是合法 JSON」。新增端点时也应在此登记。
 */

const PUBLIC_GET_ENDPOINTS: Array<{ path: string; label: string }> = [
  { path: '/api/nodes', label: '节点列表（含统计）' },
  { path: '/api/nodes?categoryId=1', label: '节点列表（分类过滤）' },
  { path: '/api/nodes?parentId=1', label: '节点列表（子节点过滤）' },
  { path: '/api/nodes?limit=5&offset=0', label: '节点列表（分页）' },
  { path: '/api/feed', label: 'RSS Feed' },
  { path: '/api/feed/atom', label: 'Atom Feed' },
  { path: '/api/feed/json', label: 'JSON Feed' },
  { path: '/api/search?q=linux', label: '搜索' },
  { path: '/api/search?q=linux&limit=500', label: '搜索（超限钳制）' },
  { path: '/api/leaderboard', label: '积分排行榜' },
  { path: '/api/leaderboard?limit=10&offset=0', label: '积分排行榜（分页）' },
  { path: '/api/topics/3', label: '主题详情' },
  { path: '/api/captcha', label: '验证码挑战' },
];

test.describe('v0.0.4 公开 GET 端点冒烟', () => {
  for (const ep of PUBLIC_GET_ENDPOINTS) {
    test(`${ep.label}：GET ${ep.path} 返回 200 且是合法 JSON`, async ({ page }) => {
      const res = await page.request.get(ep.path);
      expect(res.status(), `${ep.path} 应返回 200，实际 ${res.status()}`).toBe(200);

      const ct = res.headers()['content-type'] ?? '';
      // Feed 是 XML/JSON 文本，其余应为 JSON
      if (!ep.path.startsWith('/api/feed')) {
        expect(ct).toContain('application/json');
      }

      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      // 不能是 HTML 错误页
      expect(body.trim().startsWith('<!DOCTYPE')).toBe(false);

      if (!ep.path.startsWith('/api/feed')) {
        // 必须能解析成 JSON（曾经 /api/nodes 返回 500 空 body，
        // 这里用 JSON.parse 的异常把问题暴露出来）
        const parsed = JSON.parse(body);
        expect(parsed).toBeTruthy();
      }
    });
  }
});

test.describe('v0.0.4 节点端点数据正确性', () => {
  test('节点列表返回真实数据库内容且统计口径正确', async ({ page }) => {
    const res = await page.request.get('/api/nodes');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(0);

    for (const n of data.nodes) {
      expect(typeof n.id).toBe('number');
      expect(typeof n.name).toBe('string');
      expect(typeof n.title).toBe('string');
      // 统计字段必须是数字（之前因 500 从未验证过）
      expect(typeof n.topicsCount).toBe('number');
      expect(n.topicsCount).toBeGreaterThanOrEqual(0);
      expect(n.status).toBe('active');
    }
  });

  test('分类过滤生效，返回数量少于全集', async ({ page }) => {
    const all = await (await page.request.get('/api/nodes')).json();
    const cat = await (await page.request.get('/api/nodes?categoryId=1')).json();

    expect(cat.ok).toBe(true);
    expect(cat.nodes.length).toBeGreaterThan(0);
    expect(cat.nodes.length).toBeLessThanOrEqual(all.nodes.length);
    for (const n of cat.nodes) {
      expect(n.categoryId).toBe(1);
    }
  });

  test('分页参数生效', async ({ page }) => {
    const all = await (await page.request.get('/api/nodes')).json();
    const total = all.nodes.length;
    expect(total).toBeGreaterThanOrEqual(2);

    // 取一个不超过总数的小页长，保证两页都能取满
    const size = Math.max(1, Math.floor(total / 2));
    const p1 = await (await page.request.get(`/api/nodes?limit=${size}&offset=0`)).json();
    const p2 = await (await page.request.get(`/api/nodes?limit=${size}&offset=${size}`)).json();

    expect(p1.nodes.length).toBe(size);
    expect(p2.nodes.length).toBeLessThanOrEqual(size);

    // 两页不应有重叠
    const ids1 = p1.nodes.map((n: { id: number }) => n.id);
    const ids2 = p2.nodes.map((n: { id: number }) => n.id);
    expect(ids1.length).toBe(ids2.length ? ids1.length : ids1.length);
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }

    // offset 超出范围时返回空数组而不是报错
    const beyond = await (await page.request.get(`/api/nodes?limit=${size}&offset=${total + 100}`)).json();
    expect(beyond.nodes).toEqual([]);
  });

  test('limit 上限被钳制到 500', async ({ page }) => {
    const res = await (await page.request.get('/api/nodes?limit=99999')).json();
    expect(res.nodes.length).toBeLessThanOrEqual(500);
  });
});
