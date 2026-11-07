/**
 * v0.0.9 —— Node 侧请求埋点（任务书 §六「API 5xx 是否能够被统计」）
 *
 * ## 为什么不能用 middleware 做这件事（v0.0.8 的真实缺陷）
 *
 * v0.0.8 把 API 埋点放在 `src/middleware.ts` 里，统计
 * `api.request` / `api.status.<code>` / `api.error.5xx`。
 * 但 middleware **拿不到下游路由的真实状态码**：
 *
 *   · `NextResponse.next()` 返回的是 **middleware 自己**的响应（恒为 200）；
 *   · 下游路由的真实响应会**替换**掉它，middleware 并不会收到通知。
 *
 * 实测（v0.0.9 复核）：修复模块隔离问题后，`api.requests` 能正确累加，
 * 但 `api.byStatus` **永远只有 `{200: N}`** —— 连真实的 401/403/404 都不计入。
 * ⇒ v0.0.8 的「错误率统计」在架构上就是**瞎的**，不满足任务书 §六。
 *
 * ## 本文件的做法
 *
 * 在 **Node HTTP 层**观测最终响应：
 *
 *   · 拦截 `ServerResponse.writeHead` ⇒ 拿到**真实**状态码；
 *   · 通过 `res.req.url` 拿到请求路径；
 *   · 用 `res.on('finish')` 拿到完整耗时。
 *
 * 这样得到的数字与客户端实际看到的响应**完全一致**（含显式返回的 500，
 * 不只是抛异常的 500）。
 *
 * ## 为什么必须限定 Node 运行时
 *
 * Edge Runtime 没有 `node:http`，且 middleware 在 Edge 下跑在**另一个进程**
 * 的另一个 isolate 里。`NEXT_RUNTIME` 由 Next.js 注入，Edge 下为 `'edge'`。
 *
 * ## 安全边界（任务书 §六）
 *
 * 只记录**路径**（不含 query string）、**状态码**、**耗时**：
 *   · 不记录请求体、响应体、用户标识；
 *   · 不记录任何口令 / 令牌 / Cookie；
 *   · 路径里的动态段（如 `/t/123`）保留原样 —— 它不含用户敏感信息，
 *     且脱敏反而会让按路由聚合失效。
 *
 * @see src/lib/observability.ts —— 计数与慢请求的存储
 */

export async function register(): Promise<void> {
  // Edge 运行时没有 node:http，直接跳过（此分支不会执行）
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // 动态 import：避免 Edge 构建期把 node:http 打进包
  const http = await import('node:http');
  const { countMetric, recordSlowRequest } = await import('@/lib/observability');

  type ServerResponseLike = import('node:http').ServerResponse;

  const proto = http.ServerResponse.prototype as unknown as {
    writeHead: (...args: unknown[]) => unknown;
    __v2exInstrumented?: boolean;
  };

  // 防止重复打补丁（dev 模式热更新会多次执行 register）
  if (proto.__v2exInstrumented) return;
  proto.__v2exInstrumented = true;

  const originalWriteHead = proto.writeHead;

  proto.writeHead = function patchedWriteHead(this: ServerResponseLike, ...args: unknown[]) {
    const res = this;

    // 只观测 /api/ 前缀（页面请求不进入运维错误率统计）
    const rawUrl = res.req?.url ?? '';
    const path = rawUrl.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) {
      return originalWriteHead.apply(res, args as never);
    }

    const startedAt = Date.now();

    const finish = () => {
      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;

      countMetric('api.request');
      countMetric(`api.status.${status}`);
      if (status >= 500) {
        countMetric('api.error.5xx');
        countMetric(`api.error.5xx.${path}`);
      } else if (status >= 400) {
        countMetric('api.error.4xx');
        countMetric(`api.error.4xx.${path}`);
      }
      if (durationMs >= 2000) {
        recordSlowRequest(path, durationMs);
      }
    };

    // 'finish' 在响应完全写完后触发 —— 此时 statusCode 已确定
    res.once('finish', finish);

    return originalWriteHead.apply(res, args as never);
  };
}
