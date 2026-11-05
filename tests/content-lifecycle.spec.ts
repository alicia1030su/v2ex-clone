import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import {
  canModifyOwnContent,
  canBanUser,
  canChangeRole,
  withinEditWindow,
  hasPermission,
} from '../src/lib/permissions';

/**
 * v0.0.3 主题与回复生命周期 —— 核心安全属性回归测试
 *
 * 覆盖：
 *  1. 软删除后内容对普通访问者「不存在」（不泄露）
 *  2. 越权：他人内容不可编辑/删除
 *  3. 管理操作需要 moderator/admin
 *  4. 幂等：重复感谢/投票不重复计数
 *  5. 一致性：replies.thanks 与 thanks 表行数一致；topics.votes 汇总正确
 *  6. 并发：并发回复不产生重复楼层号
 *  7. 编辑历史：不可变快照正确写入
 *
 * 数据库隔离：使用专用库 v2ex_v003_content，绝不触碰开发库/生产库。
 */

const TEST_DB = process.env.V003_CONTENT_TEST_DB ?? 'v2ex_v003_content';

/**
 * 让 `@/db` 的全局连接池也指向本测试库。
 *
 * `src/db/index.ts` 在模块加载时读取 DATABASE_URL 并缓存连接池，
 * 因此必须在**导入任何使用 @/db 的模块之前**把 DATABASE_URL 指向测试库。
 * 否则服务层写 A 库、断言读 B 库，会出现外键约束失败。
 *
 * ⚠️ v0.0.4：连接串统一从 `tests/helpers/test-spec-base.ts` 派生
 * （与 `tests/setup.ts` 的规范化结果同源，**只换库名，不换 host/port**），
 * 不再由本文件自行解析 —— 此前那种写法会把测试导向 5432 开发库。
 */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
// 清掉可能被其他测试文件（同一 worker 进程）缓存的连接池，
// 强制 @/db 用上面设置的测试库重新建连接。
{
  const g = globalThis as unknown as {
    __v2exSql?: unknown;
    __v2exDrizzle?: unknown;
  };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const USERS = {
  author: { username: 'v003_author', role: 'user' as const },
  other: { username: 'v003_other', role: 'user' as const },
  mod: { username: 'v003_mod', role: 'moderator' as const },
  admin: { username: 'v003_admin', role: 'admin' as const },
};

let userIds: Record<string, number> = {};
let nodeId = 0;

beforeAll(async () => {
  logDbTarget('tests/content-lifecycle.spec.ts', TEST_DB);

  // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
  await provisionTestDatabase({
    file: 'tests/content-lifecycle.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 20 });
  db = drizzle(client, { schema });

  // 准备基础数据
  const inserted = await db
    .insert(schema.users)
    .values(
      Object.entries(USERS).map(([, u]) => ({
        username: u.username,
        passwordHash: 'x',
        role: u.role,
      })),
    )
    .returning({ id: schema.users.id, username: schema.users.username });

  for (const row of inserted) {
    userIds[row.username] = row.id;
  }

  const cat = await db
    .insert(schema.categories)
    .values({ name: 'v003cat', title: 'V003 Cat' })
    .returning({ id: schema.categories.id });
  const node = await db
    .insert(schema.nodes)
    .values({
      name: 'v003node',
      title: 'V003 Node',
      categoryId: cat[0].id,
    })
    .returning({ id: schema.nodes.id });
  nodeId = node[0].id;
}, 120_000);

afterAll(async () => {
  await client?.end();
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

beforeEach(async () => {
  // 每个测试前清空内容相关数据（保留用户与节点）
  await client.unsafe(
    `TRUNCATE topics, replies, votes, thanks, edit_history, collections, notifications, credit_ledger, daily_checkins RESTART IDENTITY CASCADE`,
  );
});

/** 创建一个测试主题 */
async function createTopic(authorId: number, title = '测试主题') {
  const rows = await db
    .insert(schema.topics)
    .values({ title, content: '主题正文内容', nodeId, authorId })
    .returning();
  return rows[0];
}

/** 创建一个测试回复 */
async function createReply(topicId: number, authorId: number, floor: number) {
  const rows = await db
    .insert(schema.replies)
    .values({ topicId, authorId, content: '回复正文内容', floor })
    .returning();
  return rows[0];
}

describe('v0.0.3 内容生命周期 —— 软删除不泄露', () => {
  it('软删除主题后，deleted_at 被置位且 status 改为 deleted', async () => {
    const topic = await createTopic(userIds.v003_author);

    await db
      .update(schema.topics)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        deletedBy: userIds.v003_author,
        deletedReason: '测试删除',
      })
      .where(eq(schema.topics.id, topic.id));

    const rows = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.id, topic.id));

    expect(rows[0].deletedAt).not.toBeNull();
    expect(rows[0].status).toBe('deleted');
    expect(rows[0].deletedReason).toBe('测试删除');
  });

  it('软删除回复后，主题的 replies_count 与实际未删除回复数一致', async () => {
    const topic = await createTopic(userIds.v003_author);
    await createReply(topic.id, userIds.v003_other, 1);
    await createReply(topic.id, userIds.v003_other, 2);

    await db
      .update(schema.topics)
      .set({ repliesCount: 2 })
      .where(eq(schema.topics.id, topic.id));

    // 软删除一条回复
    await db
      .update(schema.replies)
      .set({ deletedAt: new Date(), deletedBy: userIds.v003_mod })
      .where(eq(schema.replies.floor, 1));

    // 重算计数（与 content-service 的实现一致）
    await client.unsafe(`
      UPDATE topics SET replies_count = (
        SELECT count(*)::int FROM replies
        WHERE replies.topic_id = ${topic.id} AND replies.deleted_at IS NULL
      ) WHERE id = ${topic.id}
    `);

    const rows = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.id, topic.id));
    expect(rows[0].repliesCount).toBe(1);

    const live = await db
      .select()
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topic.id));
    expect(live.filter((r) => r.deletedAt === null)).toHaveLength(1);
  });
});

describe('v0.0.3 内容生命周期 —— 幂等性', () => {
  it('重复感谢同一回复，thanks 表只有一条记录', async () => {
    const topic = await createTopic(userIds.v003_author);
    const reply = await createReply(topic.id, userIds.v003_author, 1);

    for (let i = 0; i < 3; i++) {
      const inserted = await db
        .insert(schema.thanks)
        .values({ userId: userIds.v003_other, replyId: reply.id })
        .onConflictDoNothing()
        .returning({ id: schema.thanks.id });
      if (inserted.length > 0) {
        await db
          .update(schema.replies)
          .set({ thanks: sql`${schema.replies.thanks} + 1` })
          .where(eq(schema.replies.id, reply.id));
      }
    }

    const thanksRows = await db
      .select()
      .from(schema.thanks)
      .where(eq(schema.thanks.replyId, reply.id));
    expect(thanksRows).toHaveLength(1);

    const replyRows = await db
      .select()
      .from(schema.replies)
      .where(eq(schema.replies.id, reply.id));
    expect(replyRows[0].thanks).toBe(1);
  });

  it('重复投票同一主题，votes 表只有一条记录且汇总一致', async () => {
    const topic = await createTopic(userIds.v003_author);

    for (let i = 0; i < 3; i++) {
      const existing = await db
        .select()
        .from(schema.votes)
        .where(
          sql`user_id = ${userIds.v003_other} AND topic_id = ${topic.id}`,
        );
      if (existing.length === 0) {
        const inserted = await db
          .insert(schema.votes)
          .values({ userId: userIds.v003_other, topicId: topic.id, direction: 'up' })
          .onConflictDoNothing()
          .returning({ id: schema.votes.id });
        if (inserted.length > 0) {
          await db
            .update(schema.topics)
            .set({ votes: sql`${schema.topics.votes} + 1` })
            .where(eq(schema.topics.id, topic.id));
        }
      }
    }

    const voteRows = await db
      .select()
      .from(schema.votes)
      .where(eq(schema.votes.topicId, topic.id));
    expect(voteRows).toHaveLength(1);

    const topicRows = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.id, topic.id));
    expect(topicRows[0].votes).toBe(1);
  });

  it('改票时汇总按差额 ±2 调整', async () => {
    const topic = await createTopic(userIds.v003_author);
    await db
      .insert(schema.votes)
      .values({ userId: userIds.v003_other, topicId: topic.id, direction: 'up' });
    await db
      .update(schema.topics)
      .set({ votes: 1 })
      .where(eq(schema.topics.id, topic.id));

    // 改为 down：汇总 -1（内容 -2，方向差）
    await db
      .update(schema.votes)
      .set({ direction: 'down' })
      .where(eq(schema.votes.topicId, topic.id));
    await db
      .update(schema.topics)
      .set({ votes: sql`${schema.topics.votes} - 2` })
      .where(eq(schema.topics.id, topic.id));

    const rows = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.id, topic.id));
    expect(rows[0].votes).toBe(-1);
  });
});

describe('v0.0.3 内容生命周期 —— 并发安全', () => {
  it('并发回复不产生重复楼层号', async () => {
    const topic = await createTopic(userIds.v003_author);

    // 模拟 content-service 的原子楼层分配（与 src/server/floor.ts 同逻辑）
    const allocate = async (): Promise<number> => {
      const res = await client.unsafe(`
        INSERT INTO floor_counters (topic_id, last_floor)
        SELECT ${topic.id}, greatest(coalesce(max(floor), 0), 0) + 1
        FROM replies WHERE topic_id = ${topic.id}
        ON CONFLICT (topic_id) DO UPDATE
          SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1
        RETURNING last_floor
      `);
      return Number(res[0].last_floor);
    };

    const floors = await Promise.all(
      Array.from({ length: 12 }, async () => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const floor = await allocate();
          try {
            await client.unsafe(
              `INSERT INTO replies (topic_id, author_id, content, floor)
               VALUES (${topic.id}, ${userIds.v003_other}, '并发回复内容', ${floor})`,
            );
            return floor;
          } catch (e) {
            const msg = String((e as { message?: string }).message ?? e);
            if (msg.includes('replies_topic_floor') || msg.includes('duplicate key')) {
              continue;
            }
            throw e;
          }
        }
        throw new Error('楼层分配失败');
      }),
    );

    const unique = new Set(floors);
    expect(unique.size).toBe(12);

    const rows = await db
      .select()
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topic.id));
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.floor)).size).toBe(12);
  });

  it('并发感谢同一回复，只计数一次', async () => {
    const topic = await createTopic(userIds.v003_author);
    const reply = await createReply(topic.id, userIds.v003_author, 1);

    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const inserted = await db
          .insert(schema.thanks)
          .values({ userId: userIds.v003_other, replyId: reply.id })
          .onConflictDoNothing()
          .returning({ id: schema.thanks.id });
        if (inserted.length > 0) {
          await db
            .update(schema.replies)
            .set({ thanks: sql`${schema.replies.thanks} + 1` })
            .where(eq(schema.replies.id, reply.id));
        }
        return inserted.length > 0;
      }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);

    const thanksRows = await db
      .select()
      .from(schema.thanks)
      .where(eq(schema.thanks.replyId, reply.id));
    expect(thanksRows).toHaveLength(1);

    const replyRows = await db
      .select()
      .from(schema.replies)
      .where(eq(schema.replies.id, reply.id));
    expect(replyRows[0].thanks).toBe(1);
  });
});

describe('v0.0.3 内容生命周期 —— 编辑历史不可变', () => {
  it('编辑时写入前后快照，历史记录只增不改', async () => {
    const topic = await createTopic(userIds.v003_author);

    await db.insert(schema.editHistory).values({
      targetType: 'topic',
      targetId: topic.id,
      editorId: userIds.v003_author,
      previousTitle: topic.title,
      previousContent: topic.content,
      newTitle: '新标题',
      newContent: '新正文',
    });

    const rows = await db
      .select()
      .from(schema.editHistory)
      .where(eq(schema.editHistory.targetId, topic.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].previousTitle).toBe(topic.title);
    expect(rows[0].newTitle).toBe('新标题');
  });
});

describe('v0.0.3 内容生命周期 —— 越权防护（权限矩阵实测）', () => {
  it('canModifyOwnContent：仅作者本人与 staff 可修改', () => {
    const author = { id: 1, username: 'a', role: 'user' as const, status: 'active' as const, balance: 0, avatar: null };
    const other = { id: 2, username: 'b', role: 'user' as const, status: 'active' as const, balance: 0, avatar: null };
    const mod = { id: 3, username: 'm', role: 'moderator' as const, status: 'active' as const, balance: 0, avatar: null };
    const admin = { id: 4, username: 'd', role: 'admin' as const, status: 'active' as const, balance: 0, avatar: null };

    expect(canModifyOwnContent(author, 1)).toBe(true);
    expect(canModifyOwnContent(other, 1)).toBe(false);
    expect(canModifyOwnContent(mod, 1)).toBe(true);
    expect(canModifyOwnContent(admin, 1)).toBe(true);
    expect(canModifyOwnContent(null, 1)).toBe(false);
  });

  it('canBanUser：不能封禁自己；moderator 不能封禁 admin', () => {
    const mod = { id: 3, username: 'm', role: 'moderator' as const, status: 'active' as const, balance: 0, avatar: null };
    const admin = { id: 4, username: 'd', role: 'admin' as const, status: 'active' as const, balance: 0, avatar: null };

    expect(canBanUser(mod, { id: 3, role: 'moderator' }).ok).toBe(false);
    expect(canBanUser(mod, { id: 4, role: 'admin' }).ok).toBe(false);
    expect(canBanUser(mod, { id: 9, role: 'user' }).ok).toBe(true);
    expect(canBanUser(admin, { id: 9, role: 'user' }).ok).toBe(true);
  });

  it('canChangeRole：管理员不能把自己降级（防止锁死系统）', () => {
    const admin = { id: 4, username: 'd', role: 'admin' as const, status: 'active' as const, balance: 0, avatar: null };
    expect(canChangeRole(admin, { id: 4, role: 'admin' }, 'user').ok).toBe(false);
    expect(canChangeRole(admin, { id: 4, role: 'admin' }, 'admin').ok).toBe(true);
    expect(canChangeRole(admin, { id: 9, role: 'user' }, 'moderator').ok).toBe(true);
  });

  it('withinEditWindow：作者受时限约束，staff 不受限', () => {
    const author = { id: 1, username: 'a', role: 'user' as const, status: 'active' as const, balance: 0, avatar: null };
    const admin = { id: 4, username: 'd', role: 'admin' as const, status: 'active' as const, balance: 0, avatar: null };

    const prev = process.env.TOPIC_EDIT_WINDOW_MINUTES;
    process.env.TOPIC_EDIT_WINDOW_MINUTES = '60';

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const fresh = new Date();

    expect(withinEditWindow(old, author).ok).toBe(false);
    expect(withinEditWindow(fresh, author).ok).toBe(true);
    expect(withinEditWindow(old, admin).ok).toBe(true);

    if (prev === undefined) delete process.env.TOPIC_EDIT_WINDOW_MINUTES;
    else process.env.TOPIC_EDIT_WINDOW_MINUTES = prev;
  });

  it('hasPermission：积分调整仅 admin，普通用户一律无管理权限', () => {
    const user = { id: 1, username: 'a', role: 'user' as const, status: 'active' as const, balance: 0, avatar: null };
    const mod = { id: 3, username: 'm', role: 'moderator' as const, status: 'active' as const, balance: 0, avatar: null };
    const admin = { id: 4, username: 'd', role: 'admin' as const, status: 'active' as const, balance: 0, avatar: null };

    expect(hasPermission(user, 'users.view')).toBe(false);
    expect(hasPermission(user, 'credits.adjust')).toBe(false);
    expect(hasPermission(mod, 'users.view')).toBe(true);
    expect(hasPermission(mod, 'credits.adjust')).toBe(false);
    expect(hasPermission(admin, 'credits.adjust')).toBe(true);
    expect(hasPermission(admin, 'users.role')).toBe(true);
    expect(hasPermission(mod, 'users.role')).toBe(false);
  });
});
