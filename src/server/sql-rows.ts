/**
 * 兼容不同 driver 的 execute 返回结构：
 *  - postgres-js driver：直接返回行数组
 *  - node-postgres 等：返回 { rows: [...] }
 */
export function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r?.rows ?? [];
}
