/**
 * `/api/nodes/list.json` 的**纯参数 / 投影规则**（无数据库、无 server-only）
 *
 * ## 契约来源（2026-11-09 低频只读实测，共 8 组参数组合）
 *
 * | 请求 | 原站结果 |
 * |---|---|
 * | 裸路径 / 缺 `fields` / 缺 `sort_by` / 缺 `reverse` | **400**（极简 HTML） |
 * | `fields=id,name,title&sort_by=id&reverse=0` | 200，1380 条，只含请求的 3 个键，id **降序** |
 * | `fields=id&sort_by=id&reverse=1` | 200，只含 `id`，仍 id 降序 |
 * | `sort_by=id&reverse=2` | 200，仍 id 降序 |
 * | `sort_by=name&reverse=0` / `reverse=1` | 200，name **降序** |
 * | `sort_by=bogus` / `sort_by=topics`（任意值） | 200，name **升序** |
 * | `fields=bogus&sort_by=id&reverse=0` | 200，每项 `{"bogus": null}` |
 * | `fields=id,name,title,topics,stars` | 200，返回这 5 个键的真实值 |
 *
 * 结论（**如实照抄，不「修正」原站**）：
 *   1. 三个参数**必须同时出现**，缺任意一个 ⇒ 400；
 *   2. `fields` 是投影；未知字段名照样出现在结果里，值为 **null**；
 *   3. `reverse` 实测**不生效**（`0` / `1` / `2` 结果相同）；
 *   4. `sort_by=id` ⇒ id 降序；`sort_by=name` ⇒ name 降序；
 *      其余值 ⇒ name 升序。这不是「合理」的排序设计，但是实测契约。
 *
 * 本项目可投影的字段取自 `LegacyNodeRecord`（旧版 16 键 + `created`），
 * 不复制原站数据；未建模字段按与原站「未知字段 ⇒ null」同口径处理。
 */

/** 本项目能给出真实值的字段（其余字段返回 null，与原站未知字段同口径） */
export const LEGACY_NODE_LIST_FIELDS = [
  'id',
  'name',
  'title',
  'title_alternative',
  'url',
  'topics',
  'stars',
  'header',
  'footer',
  'created',
  'aliases',
  'root',
  'parent_node_name',
  'founder_id',
  'avatar_mini',
  'avatar_normal',
  'avatar_large',
] as const;

export type LegacyNodeListField = (typeof LEGACY_NODE_LIST_FIELDS)[number];

/** `sort_by` → 本项目内部排序标识 */
export type LegacyNodeListSort = 'id' | 'name' | 'other';

/**
 * 解析 `fields` 参数：逗号分隔、去空白、去空项、保留顺序。
 * 同名重复字段在 JSON 对象里天然只出现一次（与原站一致）。
 */
export function parseLegacyFields(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 原站实测的排序映射（见文件头） */
export function resolveLegacyNodeSort(sortBy: string | null): LegacyNodeListSort {
  if (sortBy === 'id') return 'id';
  if (sortBy === 'name') return 'name';
  return 'other';
}

/**
 * 字段投影：只输出请求字段；未知字段输出 `null`。
 *
 * 输入是 `Record<string, unknown>`（服务端传入 `LegacyNodeRecord`），
 * 因此本文件可在**纯静态单测**里完整验证，不需要数据库。
 */
export function projectLegacyNode(
  record: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const known = (LEGACY_NODE_LIST_FIELDS as readonly string[]).includes(field);
    out[field] = known && Object.prototype.hasOwnProperty.call(record, field)
      ? record[field]
      : null;
  }
  return out;
}
