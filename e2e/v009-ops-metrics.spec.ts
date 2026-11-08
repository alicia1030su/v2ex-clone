import { test, expect, type Page } from '@playwright/test';
import { login, clearRateLimits, debugTokens, ADMIN } from './helpers';

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
 * ## ✅ 5xx 已覆盖（v0.0.10 补齐）
 *
 * v0.0.9 时这一条是 `test.fixme`：全仓 `src/app/api/` 没有能稳定返回 5xx
 * 的真实端点，而「向共享环境注入故障」被明令禁止。
 *
 * v0.0.10 新增 `/api/debug/boom` 作为**隔离测试环境专用**的 5xx 通道：
 *   · 三重闸门（调试令牌 + `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1`）；
 *   · 只返回错误，不读写任何数据；
 *   · 状态码白名单 {500, 502, 503}，不接受任意值。
 *
 * 因此该条从 `fixme` 转为**真实断言**：不只看「5xx 计数 +1」，
 * 还断言 `byStatus['500']` 真的出现、`error5xxByRoute` 按路由归因、
 * 且 503 被**单独**计入（证明不同 5xx 不与 500 混在一起）。
 *
 * ⚠️ 注意区分两层覆盖，不要混淆：
 *   · **真实 HTTP 链路触发 5xx** —— 本文件未覆盖（原因如上）；
 *   · **5xx 的分桶逻辑**（`status >= 500` ⇒ `api.error.5xx` 与
 *     `api.error.5xx.${route}` 各 +1，且不落入 4xx） —— **已覆盖**，
 *     由 `tests/v009-instrumentation-once.spec.ts` 的「状态码分桶」单测
 *     直接把真实 `ServerResponse` 的 statusCode 设为 500 后断言。
 *   两层互补：本文件证明真实链路能取到状态码，单测证明分桶规则正确。
 *
 * @see tests/v009-instrumentation-once.spec.ts
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
 * ✅ 已覆盖（v0.0.10）：5xx 计入 `api.error.5xx` 与 `error5xxByRoute`
 *
 * ## 这里原本是 `test.fixme`，为什么现在能测了
 *
 * v0.0.9 当时的判断是「仓库内没有可稳定复现 5xx 的真实 `/api/` 端点，
 * 且禁止为造 5xx 而修改产品代码或注入故障」。
 *
 * 那个判断在**观测链路的可信度**上留了一个洞：`/api/admin/ops` 的
 * `api.error.5xx` / `error5xxByRoute` 是「关键接口错误率」的唯一数据源，
 * 而它**从未被真实 HTTP 验证过**，只有分桶函数的单元测试。
 *
 * v0.0.10 新增 `/api/debug/boom`：**只在隔离测试环境**（`APP_RUNTIME_ENV=test`
 * 且 `TEST_ENV_ISOLATED=1`）且携带调试令牌时返回一个**真实的** HTTP 5xx。
 * 它不在业务代码里注入故障（没有污染任何产品路径），只是提供了一条
 * 「可稳定制造 5xx」的测试通道 —— 所以本条用例的解除条件已经满足。
 *
 * ## 断言内容的强度
 *
 * 不只断言「5xx 计数 +1」，而是同时断言：
 *   ① `byStatus['500']` 真的 +1（说明真实状态码被采到，不是恒 {200}）；
 *   ② `api.error.5xx` +1；
 *   ③ `error5xxByRoute['<该路由>']` +1（说明**按路由**归因也对）；
 *   ④ 再打一个 503，确认**不同 5xx 状态码被分开计**（而不是笼统记账）。
 */
test('5xx 计入 api.error.5xx / error5xxByRoute（真实 HTTP 5xx）', async ({ page }) => {
  await clearRateLimits(page);
  await login(page, ADMIN.username, ADMIN.password);

  // 令牌回退链与 clearRateLimits 同一套（进程 env → .env.test）
  const tokens = debugTokens();
  const hdr = { 'x-debug-token': tokens[0] ?? '' };

  const before = (await readOps(page)).api;

  const r500 = await page.request.get('/api/debug/boom', {
    headers: hdr,
    failOnStatusCode: false,
  });
  expect(r500.status()).toBe(500);

  const after500 = (await readOps(page)).api;
  expect(delta(after500.byStatus, before.byStatus, '500')).toBeGreaterThanOrEqual(1);
  expect(after500.errors5xx - before.errors5xx).toBeGreaterThanOrEqual(1);

  // ③ 按路由归因：该路由必须出现在 error5xxByRoute 里
  const byRoute = after500.error5xxByRoute ?? {};
  const hit = Object.entries(byRoute).some(
    ([route, n]) => route.includes('/api/debug/boom') && Number(n) >= 1,
  );
  expect(hit, `error5xxByRoute 应包含 /api/debug/boom，实际：${JSON.stringify(byRoute)}`).toBe(true);

  // ④ 不同 5xx 状态码分开计
  const r503 = await page.request.get('/api/debug/boom?status=503', {
    headers: hdr,
    failOnStatusCode: false,
  });
  expect(r503.status()).toBe(503);

  const after503 = (await readOps(page)).api;
  expect(delta(after503.byStatus, after500.byStatus, '503')).toBeGreaterThanOrEqual(1);
});
