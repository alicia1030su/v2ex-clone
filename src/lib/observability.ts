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

/** 进程内计数窗口（按事件名 + 级别） */
const counters = new Map<string, number>();
/** 慢请求记录（按路由归类） */
const slowRequests: { route: string; durationMs: number; ts: string }[] = [];
/** 保留的最大慢请求条数 */
const MAX_SLOW = 200;

/** 递增计数 */
export function countMetric(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** 记录一次慢请求 */
export function recordSlowRequest(route: string, durationMs: number): void {
  slowRequests.push({ route, durationMs, ts: new Date().toISOString() });
  if (slowRequests.length > MAX_SLOW) slowRequests.splice(0, slowRequests.length - MAX_SLOW);
}

/** 读取当前计数快照 */
export function metricsSnapshot(): {
  counters: Record<string, number>;
  slowRequests: { route: string; durationMs: number; ts: string }[];
} {
  return {
    counters: Object.fromEntries(counters),
    slowRequests: [...slowRequests],
  };
}

/** 清空计数（测试用） */
export function resetMetrics(): void {
  counters.clear();
  slowRequests.length = 0;
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
