import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import {
  CategoryError,
  createCategory,
  getCategoryById,
  listAllCategories,
  listPublicCategories,
  toCategoryDto,
  updateCategory,
} from '../src/server/categories';

/**
 * 分类管理落库的**真实数据库**回归测试（v0.0.14）
 *
 * ## 为什么必须有这一层
 *
 * 校验函数（name 正则 / title 长度 / sort 区间）是纯函数，
 * 静态护栏只证明「代码写了」。真实风险全在 SQL 一侧：
 *
 *   · `categories.name` **没有唯一索引**（历史重名会让升级迁移失败），
 *     因此并发创建同名分类**必须**靠 `pg_advisory_xact_lock` 串行化 ——
 *     这条只有真库能证明：把 lock 去掉，并发用例会插出两行；
 *   · `hidden` 的过滤必须在**服务层**生效（`listPublicCategories` 不含、
 *     `listAllCategories` 仍含），否则后台点了「禁用」公共页面照样展示；
 *   · `updatedAt` 必须在写操作后**真的变化**（后台列表与审计都依赖它）。
 *
 * 数据库隔离：专用库 `v2ex_v014_categories`，不碰开发库。
 * 库名已加入 `tests/helpers/test-db-guard.ts` 的 `ALLOWED_DB_NAMES`。
 */

const TEST_DB = process.env.V014_CATEGORIES_TEST_DB ?? 'v2ex_v014_categories';

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  // 清掉全局连接池缓存 —— 否则会复用 setup.ts 阶段指向前一个库的客户端
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** 每个用例用独立 name 前缀，避免互相干扰（本文件内串行执行，但保持防御性） */
let seq = 0;
function uniqueName(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

/** 直接查库统计某分类名的行数（用于证明「没有产生第二行」） */
async function countRowsByName(name: string): Promise<number> {
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.name, name));
  return rows.length;
}

beforeAll(async () => {
  logDbTarget('tests/categories-admin.spec.ts', TEST_DB);

  /**
   * 「复用已迁移库」开关 —— **仅为本机磁盘劣化时跑断言用**。
   *
   * 本机 PG 的磁盘 I/O 已劣化：实测 DROP DATABASE 1m40s、CREATE DATABASE 4m48s、
   * migrate 2m52s（合计 ~7.5 分钟/次）。在 WorkBuddy 的 Bash 工具里
   * 「起库 → 跑测试」必须同一次调用完成，而单次调用上限 600s ⇒
   * 完整 provision 会把整次运行挤爆（实测 hook 300s 超时）。
   *
   * 因此提供 `V014_CATEGORIES_REUSE_DB=1`：**跳过 DROP / CREATE**，
   * 只跑 `drizzle-kit migrate`（幂等，已迁移即 no-op）。
   * 断言本身**一条都没放宽**（不 skip、不改期望值），
   * 且默认路径仍是完整 provision —— CI 里不设这个变量，行为与其它 spec 一致。
   */
  const reuseDb = process.env.V014_CATEGORIES_REUSE_DB === '1';
  if (reuseDb) {
    console.log(`[db-phase] ${TEST_DB}: 复用已存在的库（V014_CATEGORIES_REUSE_DB=1），仅跑幂等 migrate`);
    runDrizzleKit(['migrate'], {
      ...process.env,
      ENV_FILE: '',
      DATABASE_URL: dbUrlFor(TEST_DB),
    });
  } else {
    await provisionTestDatabase({
      file: 'tests/categories-admin.spec.ts',
      db: TEST_DB,
      adminUrl: adminUrlOf(TEST_DB),
      migrate: () =>
        runDrizzleKit(['migrate'], {
          ...process.env,
          ENV_FILE: '',
          DATABASE_URL: dbUrlFor(TEST_DB),
        }),
    });
  }

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 10 });
  db = drizzle(client, { schema });
  // ⚠️ 15 分钟：本机 PG 的**磁盘 I/O 已劣化**（实测 DROP DATABASE 1m40s、
  //    CREATE DATABASE 4m48s、崩溃恢复期单次 fsync 10s）。
  //    这是**环境问题**，不是产品缺陷 —— 因此放宽的是钩子超时，
  //    断言本身一条都没有放宽（更不跳过）。CI 的 service container 是毫秒级。
}, 900_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  // 复用模式下 DROP 也要 1m40s（本机磁盘劣化）—— 仍执行，保证库不残留
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

describe('createCategory：真实落库', () => {
  it('创建成功，listAll 与 listPublic 都能看到', async () => {
    const name = uniqueName('created');
    const created = await createCategory({ name, title: '新建分类', sort: 5 });

    expect(created.name).toBe(name);
    expect(created.title).toBe('新建分类');
    expect(created.sort).toBe(5);
    expect(created.hidden, '新建分类默认启用').toBe(false);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const all = await listAllCategories();
    expect(all.map((c) => c.name)).toContain(name);

    const pub = await listPublicCategories();
    expect(pub.map((c) => c.name)).toContain(name);
  });

  it('名称规范化：大写与首尾空白被收敛为小写（不会造出两套名字）', async () => {
    const raw = uniqueName('MixedCase');
    const created = await createCategory({ name: `  ${raw}  `, title: '大小写' });
    expect(created.name).toBe(raw.toLowerCase());
    // ⚠️ 必须按**规范化后**的名字查库：库里存的是小写，
    //    按原始大小写查会得到 0 行（本测试第一版就踩了这个坑）
    expect(await countRowsByName(created.name)).toBe(1);
    expect(await countRowsByName(raw), '库里不得存在原始大小写的行').toBe(0);
  });

  it('sort 缺省为 0（不传 sort 不应变成 NULL 或 NaN）', async () => {
    const created = await createCategory({ name: uniqueName('nosort'), title: '无排序' });
    expect(created.sort).toBe(0);
  });

  it('listAll 带节点数（一次聚合，不是逐分类查询）', async () => {
    const created = await createCategory({ name: uniqueName('withnodes'), title: '带节点' });

    const [user] = await db
      .insert(schema.users)
      .values({ username: uniqueName('cat_owner_'), passwordHash: 'x' })
      .returning({ id: schema.users.id });

    await db.insert(schema.nodes).values({
      name: uniqueName('catnode'),
      title: '分类下的节点',
      categoryId: created.id,
      createdBy: user.id,
      status: 'active',
    });

    const all = await listAllCategories();
    const row = all.find((c) => c.id === created.id);
    expect(row, '新分类必须出现在 listAll 中').toBeDefined();
    expect(row?.nodesCount).toBe(1);
  });
});

describe('updateCategory：只更新传入字段', () => {
  it('改 title 与 sort 生效，且 updatedAt 变化、createdAt 不变', async () => {
    const created = await createCategory({ name: uniqueName('upd'), title: '原标题', sort: 1 });

    // 让时间戳确实可能不同（同一毫秒内的 update 无法证明「更新了时间戳」）
    await new Promise((r) => setTimeout(r, 20));

    const updated = await updateCategory(created.id, { title: '新标题', sort: 42 });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('新标题');
    expect(updated.sort).toBe(42);
    expect(updated.name, '未传 name 时不得改名').toBe(created.name);
    expect(updated.hidden, '未传 hidden 时保持原值').toBe(false);
    expect(updated.createdAt.getTime(), 'createdAt 不应被写操作改动').toBe(
      created.createdAt.getTime(),
    );
    expect(
      updated.updatedAt.getTime(),
      `updatedAt 必须在写操作后变化（原 ${created.updatedAt.toISOString()}，新 ${updated.updatedAt.toISOString()}）`,
    ).toBeGreaterThan(created.updatedAt.getTime());
  });

  it('只传 sort 时 title 不变（不是整行覆盖）', async () => {
    const created = await createCategory({ name: uniqueName('partial'), title: '保持标题', sort: 3 });
    const updated = await updateCategory(created.id, { sort: 9 });
    expect(updated.title).toBe('保持标题');
    expect(updated.sort).toBe(9);
  });

  it('不存在的 id 抛 NOT_FOUND（404），不是静默成功', async () => {
    await expect(updateCategory(999_999_999, { title: 'ghost' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('一个字段都不传时抛 NOTHING_TO_UPDATE（避免空 UPDATE 刷 updatedAt）', async () => {
    const created = await createCategory({ name: uniqueName('empty'), title: '空更新' });
    await expect(updateCategory(created.id, {})).rejects.toMatchObject({
      code: 'NOTHING_TO_UPDATE',
      status: 400,
    });
  });
});

describe('hidden：禁用语义（不删数据、可恢复）', () => {
  it('hidden=true 后 listPublic 不含、listAll 仍含、数据仍在库里', async () => {
    const name = uniqueName('hidden');
    const created = await createCategory({ name, title: '将被禁用', sort: 7 });

    const hidden = await updateCategory(created.id, { hidden: true });
    expect(hidden.hidden).toBe(true);

    const pub = await listPublicCategories();
    expect(pub.map((c) => c.name), '禁用的分类不得出现在公共列表里').not.toContain(name);

    const all = await listAllCategories();
    const row = all.find((c) => c.name === name);
    expect(row, '后台列表必须仍能看到禁用的分类').toBeDefined();
    expect(row?.hidden).toBe(true);

    // 「禁用」而不是「删除」：行还在
    expect(await countRowsByName(name), '禁用不得删除数据行').toBe(1);
  });

  it('hidden=false 可恢复（重新出现在公共列表）', async () => {
    const name = uniqueName('restore');
    const created = await createCategory({ name, title: '禁用后恢复', sort: 8 });

    await updateCategory(created.id, { hidden: true });
    expect((await listPublicCategories()).map((c) => c.name)).not.toContain(name);

    const restored = await updateCategory(created.id, { hidden: false });
    expect(restored.hidden).toBe(false);
    expect((await listPublicCategories()).map((c) => c.name)).toContain(name);
  });

  it('禁用的分类不影响其下节点的归属（节点仍在库里，仍指向该分类）', async () => {
    const created = await createCategory({ name: uniqueName('keepnode'), title: '禁用不影响节点' });

    const [user] = await db
      .insert(schema.users)
      .values({ username: uniqueName('keep_owner_'), passwordHash: 'x' })
      .returning({ id: schema.users.id });

    const [node] = await db
      .insert(schema.nodes)
      .values({
        name: uniqueName('keepnode'),
        title: '归属不变的节点',
        categoryId: created.id,
        createdBy: user.id,
      })
      .returning({ id: schema.nodes.id, categoryId: schema.nodes.categoryId });

    await updateCategory(created.id, { hidden: true });

    const rows = await db
      .select({ categoryId: schema.nodes.categoryId })
      .from(schema.nodes)
      .where(eq(schema.nodes.id, node.id));
    expect(rows[0]?.categoryId, '禁用分类不得改动节点的 category_id').toBe(created.id);
  });
});

describe('重名与并发：advisory lock 必须真实生效', () => {
  it('重复 name 抛 DUPLICATE_NAME(409)，且不产生第二行', async () => {
    const name = uniqueName('dup');
    await createCategory({ name, title: '第一次' });

    await expect(createCategory({ name, title: '第二次' })).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
      status: 409,
    });
    expect(await countRowsByName(name), '重名请求不得产生第二行').toBe(1);
  });

  it('大小写不同的重名同样被判重（应用层查重与规范化一致）', async () => {
    const name = uniqueName('caseDup');
    const created = await createCategory({ name, title: '原始' });
    await expect(
      createCategory({ name: name.toUpperCase(), title: '大写重名' }),
    ).rejects.toBeInstanceOf(CategoryError);
    // 库里只应有规范化后的那一行
    expect(await countRowsByName(created.name)).toBe(1);
  });

  it('并发创建同名：只有一个成功，另一个 DUPLICATE_NAME，表里只有 1 行', async () => {
    const name = uniqueName('race');

    // 真实并发（不是顺序 await）：两个事务都要拿到 advisory lock 才能继续
    const results = await Promise.allSettled([
      createCategory({ name, title: '并发 A' }),
      createCategory({ name, title: '并发 B' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length, '并发创建同名分类只能成功一个').toBe(1);
    expect(rejected.length).toBe(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason, '失败的那个必须是 DUPLICATE_NAME 而不是数据库唯一约束错').toBeInstanceOf(
      CategoryError,
    );
    expect((reason as CategoryError).code).toBe('DUPLICATE_NAME');

    expect(await countRowsByName(name), '并发重名不得插出第二行').toBe(1);
  });

  it('并发创建**不同**名字都成功（锁只串行化，不吞掉合法请求）', async () => {
    const a = uniqueName('para');
    const b = uniqueName('para');
    const [ra, rb] = await Promise.all([
      createCategory({ name: a, title: '并行 A' }),
      createCategory({ name: b, title: '并行 B' }),
    ]);
    expect(ra.name).toBe(a);
    expect(rb.name).toBe(b);
  });
});

describe('非法输入：400 类错误且不写库', () => {
  it('name 非法（大写 / 太短 / 特殊字符 / 数字开头超长）都被拒绝', async () => {
    const before = (await listAllCategories()).length;
    const bad = ['A', 'a', '中文名', 'has space', '-leading', 'a'.repeat(40), ''];
    for (const name of bad) {
      await expect(createCategory({ name, title: '合法标题' }), `name=${name} 应被拒绝`).rejects.toMatchObject(
        { code: 'INVALID_NAME', status: 400 },
      );
    }
    expect((await listAllCategories()).length, '非法输入不得写库').toBe(before);
  });

  it('title 为空或超 64 字被拒绝', async () => {
    for (const title of ['', '   ', 'x'.repeat(65)]) {
      await expect(
        createCategory({ name: uniqueName('badt'), title }),
      ).rejects.toMatchObject({ code: 'INVALID_TITLE', status: 400 });
    }
  });

  it('sort 非整数 / 越界被拒绝', async () => {
    const badSorts: unknown[] = [1.5, -20_000, 20_000, 'abc', Number.NaN];
    for (const sort of badSorts) {
      await expect(
        createCategory({ name: uniqueName('bads'), title: '合法标题', sort }),
        `sort=${String(sort)} 应被拒绝`,
      ).rejects.toMatchObject({ code: 'INVALID_SORT', status: 400 });
    }
  });

  it('update 的 hidden 只接受 boolean（不接受 "true" / 1）', async () => {
    const created = await createCategory({ name: uniqueName('badh'), title: 'hidden 类型' });
    for (const hidden of ['true', 1, 0, null] as unknown[]) {
      await expect(
        updateCategory(created.id, { hidden }),
        `hidden=${String(hidden)} 应被拒绝`,
      ).rejects.toMatchObject({ code: 'INVALID_HIDDEN', status: 400 });
    }
    // 拒绝后状态不变
    const fresh = await getCategoryById(created.id);
    expect(fresh?.hidden).toBe(false);
  });
});

describe('toCategoryDto：响应白名单', () => {
  it('只回显 id/name/title/sort/hidden/updatedAt，不含内部时间戳以外的字段', async () => {
    const created = await createCategory({ name: uniqueName('dto'), title: 'DTO', sort: 2 });
    const dto = toCategoryDto(created);

    expect(Object.keys(dto).sort()).toEqual(
      ['hidden', 'id', 'name', 'sort', 'title', 'updatedAt'].sort(),
    );
    expect(typeof dto.updatedAt).toBe('string');
    // createdAt 不在白名单内（内部字段不外泄）
    expect(JSON.stringify(dto)).not.toContain('createdAt');
  });
});

describe('迁移后的表结构（真实库）', () => {
  it('categories 有 hidden / updated_at 列，且 sort 索引存在', async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'categories'
      ORDER BY ordinal_position
    `);
    const rows = cols as unknown as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;

    const hidden = rows.find((r) => r.column_name === 'hidden');
    expect(hidden, 'categories.hidden 不存在 ⇒ 迁移 0004 未生效').toBeDefined();
    expect(hidden?.data_type).toBe('boolean');
    expect(hidden?.is_nullable).toBe('NO');
    expect(hidden?.column_default).toContain('false');

    const updatedAt = rows.find((r) => r.column_name === 'updated_at');
    expect(updatedAt, 'categories.updated_at 不存在 ⇒ 迁移 0004 未生效').toBeDefined();
    expect(updatedAt?.data_type).toContain('timestamp');
    expect(updatedAt?.is_nullable).toBe('NO');

    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'categories' AND indexname = 'categories_sort_idx'
    `);
    expect((idx as unknown as unknown[]).length, 'categories_sort_idx 索引不存在').toBe(1);
  });

  it('name **没有**唯一索引（历史重名不得让升级迁移失败）', async () => {
    const idx = await db.execute(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'categories'
    `);
    const defs = (idx as unknown as Array<{ indexname: string; indexdef: string }>).map(
      (r) => r.indexdef,
    );
    const uniqueOnName = defs.filter((d) => /UNIQUE/i.test(d) && /\(name\)/.test(d));
    expect(
      uniqueOnName,
      `categories.name 不应有唯一索引，实际：${uniqueOnName.join(' | ')}`,
    ).toHaveLength(0);
  });
});
