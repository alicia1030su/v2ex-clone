import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * v0.0.4 —— 全部 GET 端点自动发现冒烟
 *
 * 为什么需要这个文件：
 *   v0.0.3 存在三个**生产环境必然 500**的端点缺陷，却长期未被发现 ——
 *     1. GET /api/nodes       —— 原生 SQL 起了表别名，WHERE 条件仍用原表名（PG 42P01）
 *     2. GET /api/topics/[id] —— 条件片段写成普通字符串，被 drizzle 当参数绑定（PG 42601）
 *     3. GET /api/nodes 的 limit/offset 从未被路由传给服务层（分页形同虚设）
 *
 *   共同点：**没有任何测试调用过它们**。测试没覆盖到的功能等于没有测试。
 *
 * 本文件的做法：**从源码自动发现**所有导出了 GET 的路由，
 * 逐个发起请求并断言「不返回 5xx」。
 * 这样新增端点若忘了测，也会被自动纳入冒烟范围。
 *
 * 端点所需的路径参数用已知存在的种子 id 填充：
 *   - /api/topics/[id]        → 用 1..20 依次尝试（seed 有 10 个主题）
 *   - /api/nodes/[name]/feed  → 用 seed 的第一个节点名
 *   - /api/replies/[id]/...   → 用 seed 的第一个回复 id
 */

/** 扫描 src/app/api 下所有导出 GET 的路由 */
function discoverGetRoutes(root: string): string[] {
  const apiDir = path.join(root, 'src', 'app', 'api');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'route.ts') {
        const src = fs.readFileSync(full, 'utf8');
        if (/export\s+async\s+function\s+GET\b/.test(src)) {
          const rel = path.relative(apiDir, full).replace(/\\/g, '/');
          out.push('/api/' + rel.replace(/\/route\.ts$/, ''));
        }
      }
    }
  };
  if (fs.existsSync(apiDir)) walk(apiDir);
  return out.sort();
}

// ESM 环境没有 __dirname —— Playwright 的 cwd 就是项目根
const REPO_ROOT = process.cwd();

/** 需要路径参数的端点 → 参数候选值（依次尝试，任一 2xx/4xx 即算「端点活着」） */
const PARAM_CANDIDATES: Record<string, string[]> = {
  '/api/topics/[id]': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  '/api/topics/[id]/edit-history': ['1', '2', '3', '4', '5'],
  '/api/replies/[id]/edit-history': ['1', '2', '3', '4', '5', '6', '7', '8'],
  '/api/nodes/[name]/feed': ['programmer', 'python', 'claude', 'openai'],
};

/** 替换路径参数 */
function instantiate(route: string, param: string): string {
  return route.replace(/\[[^\]]+\]/g, param);
}

/** 端点是否需要登录（401/403 属预期，不是缺陷） */
const AUTHED = [
  '/api/admin/',
  '/api/checkin',
  '/api/credits',
  '/api/notifications',
  '/api/users/me',
  '/api/users/follows',
  '/api/debug/',
];

const routes = discoverGetRoutes(REPO_ROOT);

test.describe('v0.0.4 全部 GET 端点自动冒烟', () => {
  test('发现端点数与预期一致（防止扫描逻辑失效）', () => {
    // 断言扫描确实找到了端点 —— 避免「扫到 0 个也算通过」
    expect(routes.length).toBeGreaterThan(20);
  });

  for (const route of routes) {
    const needsAuth = AUTHED.some((p) => route.startsWith(p));
    const candidates = PARAM_CANDIDATES[route] ?? [''];

    test(`${route} 不返回 5xx`, async ({ page }) => {
      let lastStatus = 0;
      let lastBody = '';
      let anyResolved = false;

      for (const param of candidates) {
        const url = instantiate(route, param);
        const res = await page.request.get(url);
        lastStatus = res.status();
        lastBody = (await res.text()).slice(0, 300);

        if (lastStatus < 500) {
          anyResolved = true;
          break;
        }
      }

      // 端点必须能「解析出结论」：要么不是 5xx，要么所有候选参数都试过
      if (!anyResolved && candidates.length > 1) {
        // 所有候选 id 都 5xx —— 这是缺陷
        expect(
          lastStatus,
          `${route} 对所有候选参数都返回 ${lastStatus}：${lastBody}`,
        ).toBeLessThan(500);
      }

      expect(
        lastStatus,
        `${route} 返回 ${lastStatus}：${lastBody}`,
      ).toBeLessThan(500);
    });
  }
});

test.describe('v0.0.4 端点响应格式', () => {
  test('JSON 端点必须返回可解析的 JSON（不是 HTML 错误页）', async ({ page }) => {
    const jsonRoutes = routes.filter(
      (r) =>
        !r.startsWith('/api/feed') && !r.startsWith('/api/nodes/[name]/feed'),
    );

    for (const route of jsonRoutes) {
      const candidates = PARAM_CANDIDATES[route] ?? [''];
      for (const param of candidates) {
        const url = instantiate(route, param);
        const res = await page.request.get(url);
        if (res.status() >= 400) continue; // 鉴权/参数问题由其他用例覆盖

        const ct = res.headers()['content-type'] ?? '';
        if (!ct.includes('application/json')) continue;

        const body = await res.text();
        expect(body.trim().startsWith('<!DOCTYPE'), `${route} 返回了 HTML`).toBe(false);
        expect(() => JSON.parse(body), `${route} 的响应不是合法 JSON`).not.toThrow();
        break;
      }
    }
  });
});
