import { test, expect, type Page } from '@playwright/test';
import { login, clearRateLimits, ADMIN } from './helpers';

/**
 * v0.0.9 —— API 真实状态码埋点回归（消除悬空引用）
 *
 * ## 这个文件补的是什么
 *
 * `tests/v009-observability-isolation.spec.ts` 的注释声称「真实状态码由
 * `e2e/v009-ops-metrics.spec.ts` 覆盖」，但该文件此前**并不存在**（发布前
 * 安全审计 A-04）。同时 `src/instrumentation.ts` 是 v0.0.9 新增的
 * Node HTTP 层 `writeHead` 打补丁实现，此前**没有任何真实 HTTP 层验证**
 * 能证明它确实把 200/401/403/404/5xx 分别计入 `/api/admin/ops` 的
 * `byStatus`，而不是像 v0.0.8 的 middleware 那样恒为 `{200}`。
 *
 * ## 方法：真实 HTTP + 前后快照差值
 *
 * · 全部状态码都由**真实端点 + 真实请求**产生，不用 stub、不改产品代码、
 *   不向共享环境注入故障；
 * · 计数是**进程内累计窗口**，从服务启动起就不为 0 ⇒ 用「操作前快照 →
 *   发请求 → 操作后快照」的**增量**断言，而不是绝对值；
 * · 每个请求都先断言自身真实状态码，端点行为一变就明确失败，不会静默误判；
 * · `workers: 1` + `fullyParallel: false` + `mode: 'serial'`（沿用项目约定），
 *   避免并发请求污染增量。
 *
 * ## ⚠️ 5xx 未覆盖（如实声明，不伪造通过）
 *
 * 全仓 `src/app/api/` 中**没有**能稳定返回 5xx 的真实端点：
 *   · 显式 `status: 5xx` 零命中；
 *   · 唯一会产生 5xx 的 `/api/health/ready`（DB/Redis 不可达时 503）
 *     需要**制造故障**才能触发 —— 任务明确禁止「注入故障到共享环境」；
 *   · 靠畸形参数碰运气触发异常既不稳定，也会污染共享库。
 * ⇒ 该条以 `test.fixme` 明确标注为**未覆盖**，并保留可启用的验证模板。
 *   解除条件见下方 fixme 用例注释。
 *
 * @see src/instrumentation.ts
 * @see src/app/api/admin/ops/route.ts
 * @see tests/v009-observability-isolation.spec.ts
 */

test.describe.configure({ mode: 'serial' });

/** 本用例专用的、保证不存在的 API 路径 —— 用于稳定产生 404，且路由键唯一 */
const NO_SUCH_API = '/api/v009-ops-metrics-no-such-route';

type OpsApi = {
  requests: number;
  byStatus: Record<string, number>;
  errors5xx: number;
  errors4xx: number;
  error5xxByRoute: Record<string, number>;
  error4xxByRoute: Record<string, number>;
};

type OpsSnapshot = {
  ok: boolean;
  api: OpsApi;
};

/** 读取运维指标（需管理员会话；与 v009-four-roles-acceptance 的取法一致） */
async function readOps(page: Page): Promise<OpsSnapshot> {
  const res = await page.request.get('/api/admin/ops');
  expect(res.status(), '读取 /api/admin/ops 应为 200（调用前须先登录管理员）').toBe(200);
  const body = (await res.json()) as OpsSnapshot;
  expect(body.ok).toBe(true);
  expect(body.api).toBeTruthy();
  return body;
}

function delta(
  after: Record<string, number>,
  before: Record<string, number>,
  key: string,
): number {
  return (after[key] ?? 0) - (before[key] ?? 0);
}

test('真实 HTTP 200/401/403/404 分别计入 byStatus 与 4xx 统计', async ({ page, request }) => {
  await clearRateLimits(page);
  await login(page, ADMIN.username, ADMIN.password);

  const before = (await readOps(page)).api;

  // ── 200：公开存活探针（不返回任何内部状态） ───────────────────
  const r200 = await request.get('/api/health');
  expect(r200.status(), '/api/health 应返回 200').toBe(200);

  // ── 401：`request` fixture 与 page 的浏览器上下文隔离（无会话 Cookie） ──
  const r401 = await request.get('/api/admin/ops');
  expect(r401.status(), '未登录访问后台 API 应返回 401').toBe(401);

  // ── 403：已登录但缺 CSRF 头的写请求（guardCsrf 明确拒绝） ───────
  // 注意：不能用未登录的 POST /api/topics 造 403 —— 该路由是
  // 「先鉴权、后 CSRF」，未登录先返回 401（src/app/api/topics/route.ts:12-19）。
  const r403 = await page.request.post('/api/topics', {
    headers: { 'content-type': 'application/json' },
    data: { nodeId: 1, title: 'metrics-probe', content: 'metrics-probe' },
  });
  expect(r403.status(), '已登录但无 CSRF token 的写请求应返回 403').toBe(403);

  // ── 404：不存在的 API 路径 ────────────────────────────────────
  const r404 = await request.get(NO_SUCH_API);
  expect(r404.status(), '不存在的 API 路径应返回 404').toBe(404);

  const after = (await readOps(page)).api;

  // ① 每个状态码都必须落在**自己的**桶里，且各自至少 +1。
  //    这一条直接锁死 v0.0.8「byStatus 恒 {200}」的回归。
  for (const code of ['200', '401', '403', '404']) {
    expect(
      delta(after.byStatus, before.byStatus, code),
      `byStatus[${code}] 至少应 +1（实际 before=${before.byStatus[code] ?? 0}, after=${after.byStatus[code] ?? 0}）`,
    ).toBeGreaterThanOrEqual(1);
  }

  // ② 200 与 4xx 必须是**不同**的桶：4xx 的增量不能被算进 200。
  const d200 = delta(after.byStatus, before.byStatus, '200');
  const d4xx = ['401', '403', '404'].reduce(
    (sum, code) => sum + delta(after.byStatus, before.byStatus, code),
    0,
  );
  expect(d4xx).toBeGreaterThanOrEqual(3);
  expect(d200).toBeGreaterThanOrEqual(1);
  // 4xx 不得被重复计入 200 桶（两者是独立计数键，增量不必相等，
  // 但 4xx 自身必须独立存在 —— 若实现把一切记成 200，d4xx 会是 0）
  expect(d4xx).toBeGreaterThan(0);

  // ③ 4xx 总计数增量至少覆盖三条 4xx 请求
  expect(after.errors4xx - before.errors4xx).toBeGreaterThanOrEqual(3);

  // ④ 按路由聚合：本用例专用的 404 路径是唯一键，可精确断言 +1
  expect(
    delta(after.error4xxByRoute, before.error4xxByRoute, NO_SUCH_API),
    `${NO_SUCH_API} 应恰好新增 1 条 4xx 路由计数`,
  ).toBe(1);

  // ⑤ 200 与 4xx 都计入了总请求数
  expect(after.requests - before.requests).toBeGreaterThanOrEqual(d200 + d4xx);
});

/**
 * ❌ 未覆盖：5xx 计入 `api.error.5xx` 与 `error5xxByRoute`
 *
 * 原因：见文件头「5xx 未覆盖」。当前仓库内**没有**可在共享测试环境中
 * 稳定复现 5xx 的真实 `/api/` 端点，且任务禁止为造 5xx 而修改产品代码
 * 或注入故障。这里**不写恒真断言、不用 stub 冒充真实 HTTP**，而是以
 * `test.fixme` 如实标注为未完成。
 *
 * 解除 fixme 的条件（满足其一即可，均需工程师在 src/ 侧提供）：
 *  1. 提供一个仅在隔离测试环境启用、能稳定返回 500 的 `/api/` 端点
 *     （建议同时要求 DEBUG_ENDPOINT_TOKEN，避免生产暴露）；或
 *  2. 让 `/api/health/ready` 在隔离测试环境支持显式的只读故障模拟参数，
 *     且不影响其它用例共享的服务状态。
 *
 * 届时把 `test.fixme` 改回 `test`，并启用下面的真实 HTTP 断言模板。
 */
test.fixme(
  '5xx 计入 api.error.5xx / error5xxByRoute（无稳定真实 5xx 端点，未覆盖）',
  async ({ page }) => {
    await clearRateLimits(page);
    await login(page, ADMIN.username, ADMIN.password);

    const before = (await readOps(page)).api;

    // ⚠️ 占位：这里必须是一个**真实存在**且能稳定返回 5xx 的 /api/ 端点。
    //    在条件满足前不要启用本用例，也不要把它换成 stub。
    const r5xx = await page.request.get('/api/__v009_5xx_probe__');
    expect(r5xx.status()).toBeGreaterThanOrEqual(500);
    const status = String(r5xx.status());

    const after = (await readOps(page)).api;
    expect(delta(after.byStatus, before.byStatus, status)).toBeGreaterThanOrEqual(1);
    expect(after.errors5xx - before.errors5xx).toBeGreaterThanOrEqual(1);
  },
);
