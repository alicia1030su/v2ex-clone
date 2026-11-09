import 'server-only';
import { db, schema } from '@/db';
import { asc, eq, sql } from 'drizzle-orm';
import { extractRows } from '@/server/sql-rows';

/**
 * 分类服务层（v0.0.14）
 *
 * ## 为什么需要这个模块
 *
 * `categories` 表从 v0.0.1 起就存在，`/nodes` 页面也按分类分组渲染节点，
 * 但**生产代码里没有任何 insert / update / delete 落点** ——
 * 分类只能由 `scripts/seed.ts` 写入。
 * 也就是说真实部署中管理员**无法创建 / 改名 / 排序 / 禁用**分类：
 * 页面和表都齐全，管理链路不通。
 *
 * 本模块把服务端能力补齐，`src/app/api/admin/categories/*` 只是薄薄的一层 HTTP 包装。
 *
 * ## 错误约定
 *
 * 统一抛 `CategoryError`（与 `src/lib/content-service.ts` 的 `ContentError` 同风格）：
 * `{ code, message, status }`。API 层直接按 `status` 回写 HTTP 状态码、
 * 按 `message` 回写**真实**错误文本 —— 后台 UI 据此展示，不静默吞错。
 *
 * ## 并发安全（重要）
 *
 * `categories.name` **刻意没有唯一索引**（历史数据可能已有重名，
 * 加唯一索引会让升级迁移直接失败）。于是「查重 → 插入」天然存在竞态：
 * 两个并发请求都查到「不存在」，然后各插一行同名分类。
 *
 * 因此 `createCategory()` 在**事务内**先取
 * `pg_advisory_xact_lock(hashtext('categories:write'))`，
 * 把分类写操作串行化：第二个事务会**等**第一个提交后才继续查重，
 * 从而稳定地拿到 `DUPLICATE_NAME`，而不是插出第二行。
 * 事务提交/回滚时锁自动释放，无需手工 unlock。
 */

/** 分类名规则 —— 与节点命名一致（`src/app/api/nodes/route.ts` 的 NAME_RE） */
export const CATEGORY_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** 标题长度上限（与 `schema.categories.title` 的 varchar(64) 对齐） */
export const CATEGORY_TITLE_MAX = 64;

/** 排序权重允许区间 —— 防止误输入把某个分类推到天文数字 */
export const CATEGORY_SORT_MIN = -10_000;
export const CATEGORY_SORT_MAX = 10_000;

/** 分类写操作的 advisory lock 键（固定字符串，全仓唯一） */
const CATEGORY_WRITE_LOCK = 'categories:write';

/**
 * 分类服务错误。
 *
 * `status` 直接用作 HTTP 状态码，因此**不要**在这里塞 200/201 这类成功码。
 */
export class CategoryError extends Error {
  constructor(
    readonly code: CategoryErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CategoryError';
  }
}

/** 错误码 —— 供前端/测试做稳定断言（不依赖中文文案） */
export type CategoryErrorCode =
  | 'INVALID_ID'
  | 'INVALID_NAME'
  | 'INVALID_TITLE'
  | 'INVALID_SORT'
  | 'INVALID_HIDDEN'
  | 'NOTHING_TO_UPDATE'
  | 'DUPLICATE_NAME'
  | 'NOT_FOUND';

/** 分类行（服务层返回结构） */
export type CategoryRow = {
  id: number;
  name: string;
  title: string;
  sort: number;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** 后台列表项：分类 + 节点数（一次聚合查询得出，不做 N+1） */
export type CategoryWithCount = CategoryRow & {
  /** 该分类下 **status = 'active'** 的节点数（与 `/nodes` 的口径一致） */
  nodesCount: number;
};

/**
 * 对外响应白名单（v0.0.14）
 *
 * API 只回显这 6 个字段：`id / name / title / sort / hidden / updatedAt`。
 * 分类本身没有敏感字段，但**显式白名单**比「返回整行」更安全 ——
 * 将来若给表加内部字段（如内部备注、灰度标记），不会顺手泄漏到公网。
 */
export type CategoryDto = {
  id: number;
  name: string;
  title: string;
  sort: number;
  hidden: boolean;
  updatedAt: string;
};

/** 把服务层行转成对外 DTO（唯一出口，禁止各处手抄字段） */
export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    sort: row.sort,
    hidden: row.hidden,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 规范化并校验分类名：小写、去空白，必须匹配 `CATEGORY_NAME_RE` */
export function normalizeCategoryName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!CATEGORY_NAME_RE.test(name)) {
    throw new CategoryError(
      'INVALID_NAME',
      '分类名只能包含小写字母、数字、下划线和短横线，需以字母或数字开头，长度 2-32',
      400,
    );
  }
  return name;
}

/** 规范化并校验标题：1..64（去首尾空白） */
export function normalizeCategoryTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (title.length < 1 || title.length > CATEGORY_TITLE_MAX) {
    throw new CategoryError(
      'INVALID_TITLE',
      `分类标题长度需在 1-${CATEGORY_TITLE_MAX} 之间`,
      400,
    );
  }
  return title;
}

/** 规范化并校验排序权重：必须是 [-10000, 10000] 内的整数；缺省为 0 */
export function normalizeCategorySort(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const sort = typeof raw === 'number' ? raw : Number(raw);
  if (
    !Number.isInteger(sort) ||
    sort < CATEGORY_SORT_MIN ||
    sort > CATEGORY_SORT_MAX
  ) {
    throw new CategoryError(
      'INVALID_SORT',
      `排序必须是 ${CATEGORY_SORT_MIN} ~ ${CATEGORY_SORT_MAX} 之间的整数`,
      400,
    );
  }
  return sort;
}

/** 校验分类 id */
function normalizeCategoryId(raw: unknown): number {
  const id = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CategoryError('INVALID_ID', '分类 ID 无效', 400);
  }
  return id;
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

/** 把 drizzle 行转成服务层行（统一 Date 类型，避免 Driver 差异） */
function toRow(row: typeof schema.categories.$inferSelect): CategoryRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    sort: row.sort,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 把原生 SQL 返回的时间值统一成 `Date`。
 *
 * postgres.js 对 `timestamptz` 已经返回 `Date`；但不同 driver（或将来换驱动）
 * 可能返回字符串。两种都接受，避免 `new Date(String(date))` 这类绕路转换。
 */
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * 后台用：列出**全部分类**（含已禁用），附各分类的节点数。
 *
 * ## 为什么用一条聚合查询而不是 N+1
 *
 * 朴素写法是对每个分类发一次 `SELECT count(*) FROM nodes WHERE category_id = ?`。
 * 分类虽只有几十个，但这类「列表页每行一次查询」的模式一旦被复制到
 * 主题列表/用户列表就会成为性能灾难（v0.0.4 在节点列表上实测过 411ms 的同类问题）。
 * 这里用 LEFT JOIN 一次聚合，分类表与节点表各只扫一次。
 *
 * @returns 按 `sort, id` 升序 —— 与公共页面 `/nodes` 的展示顺序一致
 */
export async function listAllCategories(): Promise<CategoryWithCount[]> {
  const result = await db.execute(sql`
    WITH nc AS (
      SELECT category_id, count(*)::int AS nodes_count
      FROM nodes
      WHERE status = 'active' AND category_id IS NOT NULL
      GROUP BY category_id
    )
    SELECT
      c.id, c.name, c.title, c.sort, c.hidden, c.created_at, c.updated_at,
      COALESCE(nc.nodes_count, 0)::int AS nodes_count
    FROM categories c
    LEFT JOIN nc ON nc.category_id = c.id
    ORDER BY c.sort ASC, c.id ASC
  `);

  return extractRows<Record<string, unknown>>(result).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    title: String(r.title),
    sort: Number(r.sort ?? 0),
    hidden: r.hidden === true || r.hidden === 't',
    createdAt: asDate(r.created_at),
    updatedAt: asDate(r.updated_at),
    nodesCount: Number(r.nodes_count ?? 0),
  }));
}

/**
 * 公共页面用：只列出 `hidden = false` 的分类，按 `sort, id` 升序。
 *
 * 供 `/nodes`、`/go/new`、节点申请表单等公共入口使用。
 * 需要包含已禁用分类的后台场景请用 `listAllCategories()`。
 */
export async function listPublicCategories(): Promise<CategoryRow[]> {
  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.hidden, false))
    .orderBy(asc(schema.categories.sort), asc(schema.categories.id));
  return rows.map(toRow);
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/**
 * 创建分类（仅 admin，权限在 API 层用 `adminGuardWrite('categories.manage')` 校验）
 *
 * ## 并发去重
 *
 * 事务内先取 advisory lock，再查重、再插入 —— 见文件头注释。
 * 重名时抛 `CategoryError('DUPLICATE_NAME', 409)`，**不产生第二行**。
 *
 * @throws {CategoryError} INVALID_NAME / INVALID_TITLE / INVALID_SORT（400）
 * @throws {CategoryError} DUPLICATE_NAME（409）
 */
export async function createCategory(input: {
  name: unknown;
  title: unknown;
  sort?: unknown;
}): Promise<CategoryRow> {
  const name = normalizeCategoryName(input.name);
  const title = normalizeCategoryTitle(input.title);
  const sort = normalizeCategorySort(input.sort);

  const created = await db.transaction(async (tx) => {
    // 串行化分类写操作：
    //   name 没有唯一索引（历史数据可能重名），只能靠应用层查重 ——
    //   而「查重 → 插入」在并发下必然竞态，因此用事务级 advisory lock 排队。
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_WRITE_LOCK}))`);

    const existing = await tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.name, name))
      .limit(1);
    if (existing.length > 0) {
      throw new CategoryError('DUPLICATE_NAME', `分类名 ${name} 已存在`, 409);
    }

    const rows = await tx
      .insert(schema.categories)
      .values({ name, title, sort, hidden: false, updatedAt: new Date() })
      .returning();

    const row = rows[0];
    if (!row) {
      // 理论上不可达（insert ... returning 失败会抛错），但保持显式失败
      throw new CategoryError('NOT_FOUND', '创建分类失败：未返回行', 500);
    }
    return toRow(row);
  });

  return created;
}

/**
 * 更新分类（只更新传入的字段）。
 *
 * - `title` / `sort` / `hidden` 三者至少传一个，否则抛 `NOTHING_TO_UPDATE`(400)
 * - 分类不存在 → `NOT_FOUND`(404)
 * - `hidden` 只接受 boolean（不接受 'true' / 1 —— 后台 UI 与 API 都在自己手里，
 *   宽松解析只会让「传错字段名却被静默当成 false」这种 bug 更难发现）
 *
 * @throws {CategoryError}
 */
export async function updateCategory(
  id: unknown,
  patch: { title?: unknown; sort?: unknown; hidden?: unknown },
): Promise<CategoryRow> {
  const categoryId = normalizeCategoryId(id);

  const next: Partial<typeof schema.categories.$inferInsert> = {};
  if (patch.title !== undefined) next.title = normalizeCategoryTitle(patch.title);
  if (patch.sort !== undefined) next.sort = normalizeCategorySort(patch.sort);
  if (patch.hidden !== undefined) {
    if (typeof patch.hidden !== 'boolean') {
      throw new CategoryError('INVALID_HIDDEN', 'hidden 只接受 true / false', 400);
    }
    next.hidden = patch.hidden;
  }
  if (Object.keys(next).length === 0) {
    throw new CategoryError(
      'NOTHING_TO_UPDATE',
      '没有需要更新的字段（可更新 title / sort / hidden）',
      400,
    );
  }

  // 所有写操作都必须刷新 updatedAt（审计与后台列表都依赖它）
  next.updatedAt = new Date();

  const rows = await db
    .update(schema.categories)
    .set(next)
    .where(eq(schema.categories.id, categoryId))
    .returning();

  const row = rows[0];
  if (!row) {
    throw new CategoryError('NOT_FOUND', '分类不存在', 404);
  }
  return toRow(row);
}

/**
 * 读取单个分类（不存在返回 null）。
 *
 * 供 API 层在「隐藏/启用」前后确认目标状态，避免把 404 写成 500。
 */
export async function getCategoryById(id: unknown): Promise<CategoryRow | null> {
  const categoryId = normalizeCategoryId(id);
  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId))
    .limit(1);
  const row = rows[0];
  return row ? toRow(row) : null;
}
