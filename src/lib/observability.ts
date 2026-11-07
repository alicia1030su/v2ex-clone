/**
 * v0.0.8：结构化日志（任务书 §六）
 *
 * ## 为什么需要
 *
 * 现状：全仓用 `console.error/warn`，格式自由、无法聚合统计。
 * 运维要回答的问题（「关键接口错误率」「异常限流统计」「SMTP 投递失败
 * 统计」「慢查询监测」）都需要**可聚合**的事件流。
 *
 * ## 设计（不引入大型监控系统）
 *
 * - **JSON-lines 输出到 stdout** ⇒ Docker `docker logs` / journald 直接采集；
 * - **进程内计数窗口** ⇒ 暴露给 `/api/admin/ops` 做即时统计；
 * - **零外部依赖**、零网络请求、不写额外文件。
 *
 * ## 安全边界（任务书 §六：监控不得泄露敏感信息）
 *
 * 事件字段里**禁止**出现：数据库口令、Cookie、重置令牌、口令哈希、
 * 完整邮箱、Authorization 头。提供 `redact()` 做兜底脱敏，
 * 调用方仍需自行避免把敏感值放进 message。
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEvent = {
  ts: string;
  level: LogLevel;
  event: string;
  /** 结构化字段（已脱敏） */
  fields?: Record<string, unknown>;
  message?: string;
};

/** 需要脱敏的键名（小写匹配） */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'cookie',
  'authorization',
  'auth',
  'session',
  'reset_token',
  'resettoken',
  'password_hash',
  'passwordhash',
  'apikey',
  'api_key',
  'db_url',
  'database_url',
  'redis_url',
]);

/** 敏感值占位符 */
export const REDACTED = '[redacted]';

/**
 * 递归脱敏：命中敏感键名的值替换为 [redacted]。
 * 深度上限 5 层，避免循环引用导致的栈溢出。
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}…[truncated]`;
  }
  return value;
}

/**
 * 邮箱脱敏：只保留首字符 + 域名。
 * （运营统计需要「哪个邮箱域在报错」但不该看完整地址。）
 */
export function maskEmailLocal(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const domain = email.slice(at + 1);
  const head = email[0] ?? '';
  return `${head}***@${domain}`;
}

/**
 * 进程内计数窗口（按事件名 + 级别）
 *
 * ## ⚠️ 为什么必须挂在 `globalThis` 上（v0.0.9 实测缺陷修复）
 *
 * **实测现象**：v0.0.8 引入的 API 埋点（middleware 里 `countMetric('api.request')`）
 * 在 `/api/admin/ops` 里**永远显示 0**，而 Node 侧的计数
 * （`ratelimit.check`、`mail.delivery.*`）却正常。
 *
 * **根因**：Next.js 的 `middleware.ts` 会被编译成**独立的 webpack bundle**
 * （`.next/server/src/middleware.js`，Edge 版）或 `.next/server/middleware.js`
 * （Node 版）。它与路由处理器的 bundle **不共享模块实例** ——
 * 即使两者跑在同一个 Node 进程里，`observability.ts` 这个模块也��被
 * **求值两次**，于是产生两个互不相通的 `Map`：
 *
 *   · middleware bundle 的 Map  ← 埋点写这里
 *   · route bundle 的 Map       ← /api/admin/ops 读这里 ⇒ 永远是空
 *
 * （补充：v0.0.8 的 middleware 跑在 **Edge Runtime** —— 那是**另一个进程**
 * 的另一个 V8 isolate，连 `globalThis` 都不是同一个对象 ⇒ 更不可能共享。
 * v0.0.9 已把 middleware 切到 `runtime = 'nodejs'`，让它与路由同进程。）
 *
 * **修法**：把状态挂在 `globalThis` 上，用一个**稳定的字符串键**去取。
 * `globalThis` 是**进程级**的，同进程内的不同 webpack bundle 共享同一个对象
 * ⇒ 埋点与读取终于落到同一份状态上。
 *
 * **边界（必须如实说明）**：
 *   - 本方案只在**同一进程**内有效。Next.js 多实例部署（多 worker / 多容器）
 *     仍是**每进程一份**计数 —— 这是「进程内计数窗口」这一设计固有的性质，
 *     不是缺陷；需要跨实例聚合时应把事件流送到集中式日志系统。
 *   - 键名带版本号，避免热更新后新旧 bundle 拿到不同的存储。
 */
const METRICS_STORE_KEY = '__v2ex_observability_store_v1';

type MetricsStore = {
  counters: Map<string, number>;
  slowRequests: { route: string; durationMs: number; ts: string }[];
};

type GlobalWithMetrics = typeof globalThis & {
  [METRICS_STORE_KEY]?: MetricsStore;
};

/** 保留的最大慢请求条数 */
const MAX_SLOW = 200;

/**
 * 计数键的**最大条数**（v0.0.9 新增 —— 防无界增长）
 *
 * ## 为什么需要上限
 *
 * `counters` 是一个 `Map`。若调用方用**高基数**的键（例如把
 * 资源 id 拼进键），键数会随请求量**无界增长** ⇒ 进程内存持续上涨
 * ⇒ 长期运行的服务会**内存泄漏**。
 *
 * 慢请求列表早有 `MAX_SLOW = 200` 的上限，但**计数器没有** ——
 * 这是 v0.0.9 审计时发现的缺口。
 *
 * ## 触发上限时的行为
 *
 * 达到上限后**不再新增键**，但**已有键继续累加** ——
 * 即「统计维度封顶，数值不丢」。
 * 这比「清空重来」更符合运维预期（不会因为一次突发流量把历史计数抹掉）。
 */
const MAX_COUNTER_KEYS = 2000;

function store(): MetricsStore {
  const g = globalThis as GlobalWithMetrics;
  let s = g[METRICS_STORE_KEY];
  if (!s) {
    s = { counters: new Map<string, number>(), slowRequests: [] };
    g[METRICS_STORE_KEY] = s;
  }
  return s;
}

/**
 * 递增计数
 *
 * ⚠️ 调用方**必须**使用低基数的键（见 `normalizeApiPath`）。
 * 本函数另加一道**兜底上限**：键数达到 `MAX_COUNTER_KEYS` 后
 * 不再新增键（已有键继续累加），防止任何调用方失误造成无界增长。
 */
export function countMetric(name: string, by = 1): void {
  const c = store().counters;
  if (!c.has(name) && c.size >= MAX_COUNTER_KEYS) {
    // 键数封顶：不新增键，但已有键仍可累加。
    // ⚠️ 这**不是**静默丢弃 —— 调用方若关心，可通过 `metricsSnapshot()`
    //    看到 `counters` 的键数已达上限。
    return;
  }
  c.set(name, (c.get(name) ?? 0) + by);
}

/**
 * 把请求路径**归一化**为低基数的路由模板（v0.0.9 新增）
 *
 * ## 为什么需要
 *
 * `/api/topics/123`、`/api/topics/124` … 是**不同的键**，
 * 而它们的**路由**只有一个（`/api/topics/[id]`）。
 * 若直接用原始路径做计数键，攻击者（或正常流量）访问 N 个不同 id
 * 就会产生 N 个键 ⇒ 计数器无界增长 ⇒ 内存泄漏。
 *
 * ## 归一化规则
 *
 *   · 路径里的**数字段** → `:id`（`/api/topics/123` ⇒ `/api/topics/:id`）
 *   · 路径里的 **UUID 段** → `:id`（36 位 hex）
 *   · 其余段保持原样（`/api/nodes/python/feed` ⇒ 不变）
 *
 * ⇒ 键的基数被限制在「**真实路由数**」这个量级。
 *
 * @param path 已去掉 query string 的路径
 */
export function normalizeApiPath(path: string): string {
  if (!path) return path;
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      // 纯数字 id
      if (/^\d+$/.test(seg)) return ':id';
      // UUID（36 位 hex，带或不带连字符）
      if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(seg)) {
        return ':id';
      }
      return seg;
    })
    .join('/');
}

/** 记录一次慢请求 */
export function recordSlowRequest(route: string, durationMs: number): void {
  const list = store().slowRequests;
  list.push({ route, durationMs, ts: new Date().toISOString() });
  if (list.length > MAX_SLOW) list.splice(0, list.length - MAX_SLOW);
}

/** 读取当前计数快照 */
export function metricsSnapshot(): {
  counters: Record<string, number>;
  slowRequests: { route: string; durationMs: number; ts: string }[];
} {
  const s = store();
  return {
    counters: Object.fromEntries(s.counters),
    slowRequests: [...s.slowRequests],
  };
}

/** 清空计数（测试用） */
export function resetMetrics(): void {
  const s = store();
  s.counters.clear();
  s.slowRequests.length = 0;
}

/** 输出到 stdout（JSON-lines） */
function emit(level: LogLevel, event: string, fields?: Record<string, unknown>, message?: string): void {
  const ev: LogEvent = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ? { fields: redact(fields) as Record<string, unknown> } : {}),
    ...(message ? { message } : {}),
  };
  countMetric(`log.${level}`);
  countMetric(`event.${event}`);
  const line = JSON.stringify(ev);
  // stdout（info/debug）vs stderr（warn/error）—— 便于容器日志分流
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** 结构化 info */
export function logInfo(event: string, fields?: Record<string, unknown>, message?: string): void {
  emit('info', event, fields, message);
}

/** 结构化 warn */
export function logWarn(event: string, fields?: Record<string, unknown>, message?: string): void {
  emit('warn', event, fields, message);
}

/** 结构化 error */
export function logError(event: string, fields?: Record<string, unknown>, message?: string): void {
  emit('error', event, fields, message);
}

/**
 * 包住一个异步操作：计时 + 失败结构化记录 + 慢请求登记。
 *
 * 用法：
 *   await withTiming('api.replies.create', { topicId }, async () => { ... });
 */
export async function withTiming<T>(
  event: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
  slowThresholdMs = 2000,
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    countMetric(`${event}.ok`);
    if (ms >= slowThresholdMs) {
      recordSlowRequest(event, ms);
      logWarn('slow_operation', { event, durationMs: ms, ...fields });
    }
    return r;
  } catch (err) {
    const ms = Date.now() - t0;
    countMetric(`${event}.error`);
    logError(
      'operation_failed',
      { event, durationMs: ms, ...fields },
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}
