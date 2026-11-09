import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { extractRows } from '@/server/sql-rows';
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
 * - **`attachTags` 不删除已有标签**：编辑主题只追加本次提交的标签，避免用户一次编辑
 *   把历史标签全部抹掉（这是最容易写错、也最难被发现的一类缺陷）。
 *
 * ## v0.0.14 P0-2：**总量**上限
 *
 * 纯函数 `normalizeTags()` 只能保证**单次调用**最多 5 个。编辑是追加语义，
 * 于是「每次提交 5 个」可以无限累加（5 → 10 → 15 …），`TAG_MAX_PER_TOPIC`
 * 形同虚设。这里改为在**事务内**先锁定主题行、读已有标签、只补到剩余额度。
 *
 * 为什么必须锁：两个并发编辑各自读到「已有 3 个」，都认为还能加 2 个，
 * 最终写进 7 个 —— 只在应用层算额度挡不住。`SELECT ... FOR UPDATE`
 * 把同一主题的标签写入串行化，锁顺序固定为「topics → tags → topic_tags」，
 * 不会与其它事务形成环。
 *
 * ## 关于 `extractRows`
 *
 * `tx.execute()` 的返回结构**随 driver 变化**：postgres-js 直接给行数组，
 * node-postgres 给 `{ rows }`。本仓约定所有直读查询结果都过
 * `extractRows()`（`src/server/sql-rows.ts`），否则换 driver 时
 * `res.rows` 会是 `undefined`、`res.length` 会是 `undefined` —— 于是
 * 「主题不存在 ⇒ 提前返回」这条分支**永远不会触发**，反而把外键错误
 * 抛给调用方。这里统一走 `extractRows`。
 *
 * ## 关于插入顺序（防死锁）
 *
 * 多行 `INSERT` 在 PostgreSQL 里是**逐行**获取唯一索引上的锁。若两个事务以
 * **相反顺序**插入同一组新标签（T1: `a,b` / T2: `b,a`），就会形成环形等待
 * ⇒ `deadlock detected`。因此插入前对名字**排序**，让所有事务以同一顺序加锁。
 * 排序只影响插入顺序，不影响返回值（返回顺序按用户输入，见下面的 `accepted`）。
 *
 * ## 为什么单独成模块
 *
 * 发帖（`POST /api/topics`）与编辑（`PUT /api/topics/[id]`）都要用；
 * 写两份必然漂移（本项目已经因「各写一份装配」踩过 V13-01）。
 */

/** 事务客户端的最小形状（只用到 execute/select/insert/delete） */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 按**码点**排序（不使用 `localeCompare`，理由见 `loadTagNames`）。
 *
 * 刻意返回新数组：调用方会用它给插入排序，不能就地改掉传进来的列表。
 */
function sortByCodePoint<T extends string>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 读某主题当前标签名（码点序，与 `loadTagNames` 同口径） */
async function readTagNames(tx: Tx | typeof db, topicId: number): Promise<string[]> {
  const rows = await tx
    .select({ name: schema.tags.name })
    .from(schema.topicTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.topicTags.tagId))
    .where(eq(schema.topicTags.topicId, topicId));
  return sortByCodePoint(rows.map((r) => r.name));
}

/**
 * 事务内锁定主题行 —— 同一主题的标签写入在此串行化。
 *
 * @returns 主题是否存在（不存在时调用方直接返回空结果，不把外键错误抛给调用方）
 */
async function lockTopic(tx: Tx, topicId: number): Promise<boolean> {
  const result = await tx.execute(sql`SELECT id FROM topics WHERE id = ${topicId} FOR UPDATE`);
  return extractRows<{ id: number }>(result).length > 0;
}

/**
 * 追加标签，并保证主题的**标签总量**不超过 `TAG_MAX_PER_TOPIC`。
 *
 * 语义：
 *  - 追加（不删除已有标签）；
 *  - 已存在的标签不重复插入、也不占用额度；
 *  - 额度用尽后，本次输入中剩余的新标签**丢弃**（不报错、不阻断发帖）；
 *  - 幂等：同一输入重复提交不会改变结果。
 *
 * @param topicId 主题 id（调用方需保证该主题存在）
 * @param raw     用户提交的原始标签（数组或逗号分隔字符串）
 * @returns 本次**实际生效**的标签名（既含此前已存在、也含本次新增的输入项），
 *          按用户输入顺序；被额度截断的项不在返回值里。
 */
export async function attachTags(topicId: number, raw: unknown): Promise<string[]> {
  // 前置校验：非法 topicId 若直接进 SQL，会抛 PostgreSQL 的
  // `null value in column "topic_id" violates not-null constraint` —— 调用方
  // 拿到的是一句难懂的数据库错误，而不是「参数不对」。这里显式拒绝。
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return [];
  }

  const names = normalizeTags(raw);
  if (names.length === 0) return [];

  return db.transaction(async (tx) => {
    // 1. 锁定主题行；主题不存在时直接返回
    if (!(await lockTopic(tx, topicId))) return [];

    // 2. 读已有标签（锁内读，拿到的是串行化之后的最新值）
    const existing = await readTagNames(tx, topicId);
    const existingSet = new Set(existing);

    // 3. 只在剩余额度内接受新标签；已存在的不占额度
    const remaining = Math.max(0, TAG_MAX_PER_TOPIC - existing.length);
    const accepted: string[] = [];
    const toInsert: string[] = [];
    for (const name of names) {
      if (existingSet.has(name)) {
        accepted.push(name);
        continue;
      }
      if (toInsert.length >= remaining) continue;
      toInsert.push(name);
      accepted.push(name);
    }

    if (toInsert.length === 0) return accepted;

    // 4. 建标签（幂等）。唯一索引冲突时不报错，稍后统一回查拿 id。
    //    插入前排序 ⇒ 所有事务以同一顺序获取唯一索引的锁，不构成死锁环。
    const insertOrder = sortByCodePoint(toInsert);
    await tx
      .insert(schema.tags)
      .values(insertOrder.map((name) => ({ name })))
      .onConflictDoNothing();

    // 5. 回查拿 id（新建与已存在两条路径都在这里收敛）
    const rows = await tx
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(inArray(schema.tags.name, insertOrder));

    const byName = new Map(rows.map((r) => [r.name, r.id]));
    const links = insertOrder
      .map((name) => byName.get(name))
      .filter((tagId): tagId is number => typeof tagId === 'number')
      .map((tagId) => ({ topicId, tagId }));

    // 6. 关联（复合主键冲突时忽略 ⇒ 重复提交/重复编辑不产生重复行）
    if (links.length > 0) {
      await tx.insert(schema.topicTags).values(links).onConflictDoNothing();
    }

    return accepted;
  });
}

/**
 * 移除主题上的标签（v0.0.14：补齐「只能加、不能减」的体验缺陷）。
 *
 * 只删 `topic_tags` 关联行，**不删 `tags` 表里的标签本体** —— 同名标签可能被
 * 其它主题使用，删本体等于替别人做决定。全局孤儿标签的清理是独立的运维动作。
 *
 * 幂等：移除不存在的标签不报错（`DELETE ... WHERE tag_id IN (...)` 命中 0 行）。
 *
 * ⚠️ 输入同样经 `normalizeTags()`（与写入同一套规范化），因此：
 *  - 大小写 / 空白 / `#` 前缀写法与写入口径一致（`#React` 能删掉 `react`）；
 *  - 单次最多移除 `TAG_MAX_PER_TOPIC` 个 —— 与单主题上限一致，够用；
 *    若历史脏数据超过 5 个，分两次调用即可（不会漏删本次传入的部分）。
 *
 * @returns 本次真正移除的标签名（未命中/不存在的项不返回）
 */
export async function detachTags(topicId: number, raw: unknown): Promise<string[]> {
  if (!Number.isInteger(topicId) || topicId <= 0) return [];

  const names = normalizeTags(raw);
  if (names.length === 0) return [];

  return db.transaction(async (tx) => {
    // 与 attachTags 相同的锁顺序：先锁 topics，再谈 tags / topic_tags
    if (!(await lockTopic(tx, topicId))) return [];

    const rows = await tx
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(inArray(schema.tags.name, names));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const deleted = await tx
      .delete(schema.topicTags)
      .where(
        and(eq(schema.topicTags.topicId, topicId), inArray(schema.topicTags.tagId, ids)),
      )
      .returning({ tagId: schema.topicTags.tagId });

    const removedIds = new Set(deleted.map((d) => d.tagId));
    return rows.filter((r) => removedIds.has(r.id)).map((r) => r.name);
  });
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
  return readTagNames(db, topicId);
}
