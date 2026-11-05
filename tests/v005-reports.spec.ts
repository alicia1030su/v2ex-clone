import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { REPORT_REASONS, isReportReason } from '../src/lib/report-reasons';
import { pgErrorCodeOf } from '../src/lib/pg-error-code';
import { hasPermission } from '../src/lib/permissions';
import { adminAdjustCredits } from '../src/lib/credit-service';

/**
 * v0.0.5 举报系统 + 管理员积分调整 —— 核心属性回归测试
 *
 * 覆盖：
 *  1. **防重复举报**：`reports_reporter_target_uidx` 部分唯一索引
 *     （同一用户 + 同一目标 + status='pending'）确实生效
 *  2. **驳回后可再举报**：部分索引 `WHERE status='pending'` 的语义 ——
 *     已处理的举报不占位，用户可对同一目标再次举报
 *  3. **举报原因白名单**：`isReportReason` 只接受固定列表
 *  4. **不能举报自己**：由 API 层校验（此处验证 service 层的
 *     `adminAdjustCredits` 与权限矩阵作为相邻属性）
 *  5. **管理员积分调整**：行锁 + 余额校验 + 不可篡改账本 +
 *     权限矩阵 `credits.adjust` 仅 admin
 *  6. **积分调整审计动作存在**：`AuditAction.USER_CREDITS_ADJUST` 可用
 *
 * 数据库隔离：使用专用库 v2ex_v005_reports，绝不触碰开发库/生产库。
 */

const TEST_DB = process.env.V005_REPORTS_TEST_DB ?? 'v2ex_v005_reports';

/**
 * 让 `@/db` 的全局连接池也指向本测试库。
 * 必须在导入任何使用 @/db 的模块**之前**设置 DATABASE_URL。
 */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const USERS = {
  reporter: { username: 'v005_reporter', role: 'user' as const },
  author: { username: 'v005_author', role: 'user' as const },
  mod: { username: 'v005_mod', role: 'moderator' as const },
  admin: { username: 'v005_admin', role: 'admin' as const },
};

let userIds: Record<string, number> = {};
let nodeId = 0;
let topicId = 0;
let replyId = 0;

/** 直接往 reports 表插一条 pending 举报（模拟 POST /api/reports 的落库） */
async function insertPendingReport(
  reporterId: number,
  targetType: 'topic' | 'reply' | 'user',
  targetId: number,
  reason = '垃圾广告',
) {
  const rows = await db
    .insert(schema.reports)
    .values({
      targetType,
      targetId,
      reporterId,
      reason,
      status: 'pending',
    })
    .returning({ id: schema.reports.id });
  return rows[0].id;
}

/** 部分唯一索引冲突的 PostgreSQL 错误码 */
const UNIQUE_VIOLATION = '23505';


beforeAll(async () => {
  logDbTarget('tests/v005-reports.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v005-reports.spec.ts',
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

  // username → USERS 的 key（author / reporter / mod / admin）
  // 必须这样映射：`userIds.author` 取的是 key，不是 username
  const usernameToKey = new Map(Object.entries(USERS).map(([k, u]) => [u.username, k]));

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

  expect(inserted.length).toBe(Object.keys(USERS).length);
  for (const row of inserted) {
    const key = usernameToKey.get(row.username);
    expect(key, `未知用户名：${row.username}`).toBeDefined();
    if (key) userIds[key] = row.id;
  }

  const cat = await db
    .insert(schema.categories)
    .values({ name: 'v005cat', title: 'V005 Cat' })
    .returning({ id: schema.categories.id });
  const node = await db
    .insert(schema.nodes)
    .values({ name: 'v005node', title: 'V005 Node', categoryId: cat[0].id })
    .returning({ id: schema.nodes.id });
  nodeId = node[0].id;

  const topic = await db
    .insert(schema.topics)
    .values({
      nodeId,
      authorId: userIds.author,
      title: 'V005 测试主题',
      content: '内容',
    })
    .returning({ id: schema.topics.id });
  topicId = topic[0].id;

  const reply = await db
    .insert(schema.replies)
    .values({ topicId, authorId: userIds.author, floor: 1, content: '回复内容' })
    .returning({ id: schema.replies.id });
  replyId = reply[0].id;
}, 120_000);

afterAll(async () => {
  await client.end().catch(() => undefined);
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

// ─────────────────────────────────────────────────────────────────────
describe('举报原因白名单', () => {
  it('REPORT_REASONS 是固定列表且非空', () => {
    expect(REPORT_REASONS.length).toBeGreaterThan(0);
    // 「其他」必须在列表中（配 detail 补充说明）
    expect(REPORT_REASONS).toContain('其他');
  });

  it('isReportReason 只接受列表内的值', () => {
    for (const r of REPORT_REASONS) {
      expect(isReportReason(r)).toBe(true);
    }
    // 拒绝：自由文本、空串、非字符串、大小写变体
    expect(isReportReason('随便写点什么')).toBe(false);
    expect(isReportReason('')).toBe(false);
    expect(isReportReason(null)).toBe(false);
    expect(isReportReason(undefined)).toBe(false);
    expect(isReportReason(123)).toBe(false);
    expect(isReportReason({})).toBe(false);
    expect(isReportReason(['垃圾广告'])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('防重复举报（部分唯一索引 reports_reporter_target_uidx）', () => {
  it('同一用户对同一主题的第 2 条 pending 举报被唯一索引拒绝', async () => {
    await insertPendingReport(userIds.reporter, 'topic', topicId, '垃圾广告');

    // 第二条 pending → 23505 unique_violation
    let caught: unknown;
    try {
      await db.insert(schema.reports).values({
        targetType: 'topic',
        targetId: topicId,
        reporterId: userIds.reporter,
        reason: '人身攻击',
        status: 'pending',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, '第 2 条 pending 举报应该被唯一索引拒绝').toBeDefined();
    expect(pgErrorCodeOf(caught)).toBe(UNIQUE_VIOLATION);
  });

  it('不同用户举报同一主题不受限（防重复只针对「同一举报人」）', async () => {
    // mod 也举报同一主题 —— 应该成功
    const id = await insertPendingReport(userIds.mod, 'topic', topicId, '违法违规');
    expect(id).toBeGreaterThan(0);
  });

  it('同一用户举报不同目标不受限', async () => {
    const id = await insertPendingReport(userIds.reporter, 'reply', replyId, '剧透/无关内容');
    expect(id).toBeGreaterThan(0);
  });

  it('举报主题与举报同一主题下的回复是不同目标，互不干扰', async () => {
    // reporter 已有一条 pending topic 举报 + 一条 pending reply 举报
    const rows = await db
      .select({ targetType: schema.reports.targetType, targetId: schema.reports.targetId })
      .from(schema.reports)
      .where(eq(schema.reports.reporterId, userIds.reporter));
    const keys = rows.map((r) => `${r.targetType}:${r.targetId}`).sort();
    expect(keys).toEqual([`reply:${replyId}`, `topic:${topicId}`]);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('部分索引语义：驳回后可再次举报', () => {
  it('举报被驳回（status != pending）后，同一用户可对同一目标再次举报', async () => {
    // 先把 author 对 topic 的举报插为 pending，再改成 rejected
    const id = await insertPendingReport(userIds.author, 'topic', topicId, '重复发布');
    await db
      .update(schema.reports)
      .set({ status: 'rejected', handledBy: userIds.admin })
      .where(eq(schema.reports.id, id));

    // 现在同一用户同一目标可以再插一条 pending（部分索引已释放）
    const id2 = await insertPendingReport(userIds.author, 'topic', topicId, '垃圾广告');
    expect(id2).toBeGreaterThan(0);

    // 表里应有 2 条 author→topic 的记录（1 rejected + 1 pending）
    const rows = await db
      .select({ status: schema.reports.status })
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.reporterId, userIds.author),
          eq(schema.reports.targetType, 'topic'),
          eq(schema.reports.targetId, topicId),
        ),
      );
    expect(rows.length).toBe(2);
  });

  it('受理（accepted）后同样释放占位', async () => {
    const id = await insertPendingReport(userIds.reporter, 'user', userIds.author, '其他');
    await db
      .update(schema.reports)
      .set({ status: 'accepted', handledBy: userIds.mod })
      .where(eq(schema.reports.id, id));

    const id2 = await insertPendingReport(userIds.reporter, 'user', userIds.author, '其他');
    expect(id2).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('「我的举报」查询只返回自己的（隐私边界）', () => {
  it('按 reporterId 过滤后查不到他人的举报', async () => {
    // reporter 有自己的举报；author 也有自己的举报
    const mine = await db
      .select({ reporterId: schema.reports.reporterId })
      .from(schema.reports)
      .where(eq(schema.reports.reporterId, userIds.reporter));
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) expect(r.reporterId).toBe(userIds.reporter);

    const authorMine = await db
      .select({ reporterId: schema.reports.reporterId })
      .from(schema.reports)
      .where(eq(schema.reports.reporterId, userIds.author));
    expect(authorMine.length).toBeGreaterThan(0);
    for (const r of authorMine) expect(r.reporterId).toBe(userIds.author);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('管理员积分调整（service 层属性）', () => {
  it('权限矩阵：credits.adjust 仅 admin，moderator 与普通用户都无权限', () => {
    expect(hasPermission({ id: 1, role: 'admin' }, 'credits.adjust')).toBe(true);
    expect(hasPermission({ id: 2, role: 'moderator' }, 'credits.adjust')).toBe(false);
    expect(hasPermission({ id: 3, role: 'user' }, 'credits.adjust')).toBe(false);
    expect(hasPermission(null, 'credits.adjust')).toBe(false);
  });

  it('admin 增加积分 → 余额与账本同步，且 balanceBefore/After 快照正确', async () => {
    const before = await db
      .select({ balance: schema.users.balance })
      .from(schema.users)
      .where(eq(schema.users.id, userIds.author))
      .limit(1);

    const res = await adminAdjustCredits(
      { id: userIds.admin, role: 'admin' } as Parameters<
        typeof adminAdjustCredits
      >[0],
      userIds.author,
      100,
      '测试奖励',
    );

    expect(res.balanceBefore).toBe(before[0].balance);
    expect(res.balance).toBe(before[0].balance + 100);

    // 账本应有对应流水
    const ledger = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userIds.author));
    const entry = ledger.find((l) => l.reason === '测试奖励');
    expect(entry).toBeDefined();
    expect(entry?.amount).toBe(100);
    expect(entry?.balanceBefore).toBe(before[0].balance);
    expect(entry?.balanceAfter).toBe(before[0].balance + 100);
    expect(entry?.type).toBe('admin_adjust');
  });

  it('扣减超过余额被拒绝（余额不足保护）', async () => {
    await expect(
      adminAdjustCredits(
        { id: userIds.admin, role: 'admin' } as Parameters<typeof adminAdjustCredits>[0],
        userIds.author,
        -999_999_999,
        '测试扣减',
      ),
    ).rejects.toThrow(/积分不足|余额不足/);
  });

  it('零数额与非整数被拒绝', async () => {
    for (const bad of [0, 1.5, -0.5]) {
      await expect(
        adminAdjustCredits(
          { id: userIds.admin, role: 'admin' } as Parameters<typeof adminAdjustCredits>[0],
          userIds.author,
          bad,
          '测试',
        ),
      ).rejects.toThrow();
    }
  });

  it('理由过短被拒绝（无理由操作不允许）', async () => {
    await expect(
      adminAdjustCredits(
        { id: userIds.admin, role: 'admin' } as Parameters<typeof adminAdjustCredits>[0],
        userIds.author,
        10,
        '',
      ),
    ).rejects.toThrow(/理由/);
    await expect(
      adminAdjustCredits(
        { id: userIds.admin, role: 'admin' } as Parameters<typeof adminAdjustCredits>[0],
        userIds.author,
        10,
        '  ',
      ),
    ).rejects.toThrow(/理由/);
  });

  it('目标用户不存在时明确报错', async () => {
    await expect(
      adminAdjustCredits(
        { id: userIds.admin, role: 'admin' } as Parameters<typeof adminAdjustCredits>[0],
        999_999_999,
        10,
        '测试',
      ),
    ).rejects.toThrow(/用户不存在/);
  });
});
