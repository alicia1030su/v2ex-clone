import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { normalizeTags, TAG_MAX_PER_TOPIC } from '@/lib/tag-normalize';

/**
 * 标签落库（v0.0.14）
 *
 * ## 真实缺口
 *
 * `tags` / `topic_tags` 在 schema 里存在、主题页会渲染、`/tag/[name]` 是可用路由，
 * 但**生产代码从不写入** ⇒ 标签页永远空。本模块补上写入链路。
 *
 * ## 并发与幂等
 *
 * - `tags.name` 有唯一索引：用 `onConflictDoNothing` 再回查，避免两个请求
 *   同时创建同名标签时抛唯一约束错；
 * - `topic_tags` 是复合主键：同样 `onConflictDoNothing`，重复提交不会重复插入；
 * - **不删除已有标签**：编辑主题只追加本次提交的标签，避免用户一次编辑
 *   把历史标签全部抹掉（这是最容易写错、也最难被发现的一类缺陷）。
 *
 * ## 为什么单独成模块
 *
 * 发帖（`POST /api/topics`）与编辑（`PUT /api/topics/[id]`）都要用；
 * 写两份必然漂移（本项目已经因「各写一份装配」踩过 V13-01）。
 */

/**
 * 把主题的标签写入 `tags` / `topic_tags`。
 *
 * @param topicId 主题 id（调用方需保证该主题存在）
 * @param raw     用户提交的原始标签（数组或逗号分隔字符串）
 * @returns 规范化后实际处理过的标签（可直接回给前端展示）
 */
export async function attachTags(topicId: number, raw: unknown): Promise<string[]> {
  const names = normalizeTags(raw).slice(0, TAG_MAX_PER_TOPIC);
  if (names.length === 0) return [];

  // 1. 建标签（幂等）。唯一索引冲突时不报错，稍后统一回查拿 id。
  await db.insert(schema.tags).values(names.map((name) => ({ name }))).onConflictDoNothing();

  // 2. 回查拿 id（新建与已存在两条路径都在这里收敛）
  const rows = await db
    .select({ id: schema.tags.id, name: schema.tags.name })
    .from(schema.tags)
    .where(inArray(schema.tags.name, names));

  const byName = new Map(rows.map((r) => [r.name, r.id]));
  const links = names
    .map((name) => byName.get(name))
    .filter((tagId): tagId is number => typeof tagId === 'number')
    .map((tagId) => ({ topicId, tagId }));

  // 3. 关联（复合主键冲突时忽略 ⇒ 重复提交/重复编辑不产生重复行）
  if (links.length > 0) {
    await db.insert(schema.topicTags).values(links).onConflictDoNothing();
  }

  return names;
}

/**
 * 读取主题的标签名（顺序**确定**）。
 *
 * 主题页此前直接用 `innerJoin(topic_tags)` 查，顺序随数据库返回而变；
 * 同一主题两次刷新可能显示不同顺序 —— 对「高保真复刻」是可见瑕疵。
 *
 * ⚠️ 刻意**不用** `localeCompare`：它依赖运行环境的 locale / ICU 数据，
 * 同一份数据在 Windows 本机与 CI 容器里可能排出不同顺序（ASCII 与 CJK 的相对位置不同），
 * 于是测试在一边绿、在另一边红。这里改用**码点比较**，结果与平台无关。
 * 真实踩到：本机 `localeCompare` 把「前端」排在 `next.js` 之前，而测试期望在后。
 */
export async function loadTagNames(topicId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.topicTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
    .where(eq(schema.topicTags.topicId, topicId));
  return rows.map((r) => r.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
