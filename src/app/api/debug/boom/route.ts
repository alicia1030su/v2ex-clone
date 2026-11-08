import { NextResponse } from 'next/server';
import { checkDebugAccess } from '@/lib/debug-auth';
import { isIsolatedTestEnv } from '@/lib/runtime-flags';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：**故意**返回 5xx（v0.0.10 新增）
 *
 * ## 为什么需要它
 *
 * v0.0.9 的 E2E 里有一条用例被 `test.fixme` 标注为**未覆盖**：
 *
 * > 「5xx 计入 api.error.5xx / error5xxByRoute（无稳定真实 5xx 端点，未覆盖）」
 *
 * 当时的判断是「仓库内没有可稳定复现 5xx 的真实 /api/ 端点，且禁止为造 5xx
 * 而修改产品代码」。这个判断在**观测链路的可信度**上留下了一个洞：
 * `/api/admin/ops` 的 `api.error.5xx` 与 `error5xxByRoute` 是「关键接口错误率」
 * 的唯一数据来源，而它**从未被真实 HTTP 验证过** —— 只有分桶函数的单元测试。
 *
 * 本端点补上这一环：它**只在隔离测试环境**可用，且必须携带调试令牌，
 * 返回一个**真实的 HTTP 5xx**（不是一个 mock，也不是在业务代码里注入故障）。
 *
 * ## 安全边界（三重，缺一不可）
 *
 * 1. `checkDebugAccess` —— 需要 `ENABLE_DEBUG_ENDPOINTS=1` **且**令牌匹配；
 * 2. **额外**要求 `APP_RUNTIME_ENV=test` **且** `TEST_ENV_ISOLATED=1`
 *    （`isIsolatedTestEnv()`）—— 即使有人在生产误开了调试开关并泄露令牌，
 *    这个端点仍然 404；
 * 3. 它**只**返回错误，不读写任何数据、不接受任何参数。
 *
 * ## 为什么同时提供 500 与 503
 *
 * `error5xxByRoute` 是按**状态码**分桶的，只测 500 无法证明「不同 5xx 被分开计」。
 * 带 `?status=503` 可以覆盖另一个桶。白名单限定 {500, 502, 503}，
 * 不接受任意状态码（否则就等于开放了「让服务器返回任意状态」的能力）。
 */
const ALLOWED_STATUS = new Set([500, 502, 503]);

export async function GET(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  // 第二重：必须在隔离测试环境
  if (!isIsolatedTestEnv()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('status');
  const status = raw ? Number(raw) : 500;

  if (!Number.isInteger(status) || !ALLOWED_STATUS.has(status)) {
    return NextResponse.json(
      {
        error: 'status 只能是 500 / 502 / 503',
        allowed: [...ALLOWED_STATUS],
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      intentional: true,
      // 明确写清这是「刻意的故障注入」，避免运维查看日志时误判为真实故障
      note: '这是隔离测试环境的**故意** 5xx，用于验证 api.error.5xx / error5xxByRoute 的观测链路',
      status,
    },
    { status },
  );
}
