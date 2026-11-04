import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { runDrizzleKit, repoRoot } from './helpers/local-bin';
import { allocateFloor, ensureFloorCounter } from '@/server/floor';
import { parse as parseEnvFile } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.4 —— 楼层号「连续性」回归测试（B-05 漏检根因）
 *
 * ## 为什么需要这个文件
 *
 * `scripts/loadtest/README.md` L505–523 记录了真实缺陷：
 *   旧 `allocateFloor` 的 DO UPDATE 分支写成
 *     `SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1`
 *   而 EXCLUDED.last_floor 本身已经是 `max(floor) + 1`，于是每次分配都跳一号
 *   （实测连发 3 条得到 16、14、12）。
 *
 *   `tests/floor-counter.spec.ts` 的用例只断言「楼层号**递增且不重复**」，
 *   而**跳号恰好满足递增**，所以没抓到它；该测试文件自身还复刻了**旧实现**
 *   （L58 仍是 `greatest(...) + 1`）来做「计数表自愈」验证 —— 它验证的是
 *   自愈逻辑，不是当前产品代码。
 *
 * ## 本测试的三个硬约束
 *
 *  1. **调用真实实现**：直接 `import { allocateFloor, ensureFloorCounter } from '@/server/floor'`。
 *     `vitest.config.ts` 已把 `server-only` 映射到 `tests/stubs/server-only.ts`（空模块），
 *     因此真实模块可在纯 Node 下加载；`@/db` 是惰性代理，在首次调用前把
 *     `DATABASE_URL` 指向独立库即可。
 *  2. **真实写库**：每次分配后都真实 `INSERT` 一条 reply，最后从数据库读回 floor
 *     列做断言 —— 不写死假数据、不只断言函数返回值。
 *  3. **独立库**：专用库 `v2ex_floorcont_v004`，先 DROP/CREATE 再迁移，
 *     afterAll 关闭全部连接并删除，绝不复用或污染任何现有库。
 *
 * ## 判定口径
 *
 *  连续发 N 条回复后，楼层号必须**严格等于 [1..N]**，
 *  而非仅仅「唯一 / 递增」。这是 B-05 修复是否被真正守住的唯一判据。
 */

const TEST_DB = 'v2ex_floorcont_v004';
const N = 12;
const PRESEED_FLOORS = 5;

/**
 * 基础连接串。
 *
 * ⚠️ 不能直接用 `process.env.DATABASE_URL`：
 * `tests/setup.ts` 会加载 `.env.local`，而该文件指向 **5432**（本机无该实例，
 * 首次实跑得到 `ECONNREFUSED 127.0.0.1:5432`）。隔离测试实例在
 * `.env.test` 的 **55433**。这里只读文件解析连接串，不改写全局
 * `process.env`（避免污染同进程其它测试），仅在 beforeAll 里把
 * DATABASE_URL 临时指向本测试的独立库，afterAll 恢复原值。
 */
function baseDatabaseUrl(): string {
  const injected = process.env.DATABASE_URL;
  if (injected && /:55433\//.test(injected)) return injected;

  const fromTestFile = parseEnvFile(
    readFileSync(path.join(repoRoot, '.env.test'), 'utf8'),
  ).DATABASE_URL;
  if (fromTestFile) return fromTestFile;

  throw new Error('无法解析 55433 隔离测试实例的 DATABASE_URL');
}

function testDatabaseUrl(): string {
  const url = new URL(baseDatabaseUrl());
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

type DbGlobals = {
  __v2exSql?: { end(): Promise<void> };
  __v2exDrizzle?: unknown;
};

/** 清除 @/db 的 globalThis 连接池缓存，保证真实实现连到本测试的独立库 */
function clearGlobalDbCache() {
  const g = globalThis as unknown as DbGlobals;
  delete g.__v2exSql;
  delete g.__v2exDrizzle;
}

let ownSql: ReturnType<typeof postgres>;
let ownDb: ReturnType<typeof drizzle<typeof schema>>;
let originalDatabaseUrl: string | undefined;
let topicId: number;
let driftTopicId: number;
let authorId: number;

describe('楼层号严格连续 1..N（真实 allocateFloor + 真实 INSERT）', () => {
  // 建库 + drizzle-kit migrate（0000/0001/0002）在本机可能超过 vitest 默认
  // hookTimeout=30s；与主理人并行复验共享 PostgreSQL 实例时会更慢。
  // 第二次实跑实测在 30s 被判超时（进程 38.98s 才结束），故显式放宽到 120s。
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;

    // 1) 用 admin 连接重建独立库
    const adminUrl = new URL(testDatabaseUrl());
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { prepare: false });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    // 2) 在独立库上跑真实迁移（含 0000 / 0001 / 0002）
    runDrizzleKit(['migrate'], {
      ...process.env,
      ENV_FILE: '',
      DATABASE_URL: testDatabaseUrl(),
    });

    // 3) 让 src/db 的惰性代理在首次调用时连接到独立库
    process.env.DATABASE_URL = testDatabaseUrl();
    clearGlobalDbCache();

    // 4) 本文件自己的连接（用于造数据与读回校验）
    ownSql = postgres(testDatabaseUrl(), { prepare: false });
    ownDb = drizzle(ownSql, { schema });

    const [user] = await ownDb
      .insert(schema.users)
      .values({
        username: 'floorcont_user',
        email: 'floorcont@test.local',
        passwordHash: 'x',
        role: 'user',
        balance: 100,
      })
      .returning({ id: schema.users.id });
    authorId = user.id;

    // 注意外键顺序：users → categories → nodes → topics → replies
    const [category] = await ownDb
      .insert(schema.categories)
      .values({ name: 'floorcont', title: '楼层连续性', sort: 99 })
      .returning({ id: schema.categories.id });

    const [node] = await ownDb
      .insert(schema.nodes)
      .values({
        name: 'floorcont',
        title: '楼层连续性',
        categoryId: category.id,
        createdBy: authorId,
      })
      .returning({ id: schema.nodes.id });

    const [topic] = await ownDb
      .insert(schema.topics)
      .values({
        title: '楼层连续性验证主题',
        content: '用于验证连续发 N 条回复后楼层号严格为 1..N。',
        nodeId: node.id,
        authorId,
      })
      .returning({ id: schema.topics.id });
    topicId = topic.id;

    // 第二个主题：模拟 seed 漂移（写入固定楼层却不同步 floor_counters）
    const [driftTopic] = await ownDb
      .insert(schema.topics)
      .values({
        title: '计数表落后场景',
        content: '预置 5 条固定楼层回复，故意不同步计数表。',
        nodeId: node.id,
        authorId,
      })
      .returning({ id: schema.topics.id });
    driftTopicId = driftTopic.id;

    for (let floor = 1; floor <= PRESEED_FLOORS; floor++) {
      await ownDb.insert(schema.replies).values({
        topicId: driftTopicId,
        authorId,
        content: `预置回复 ${floor}`,
        floor,
      });
    }
    // 故意不写 floor_counters —— 漂移已建立
  }, 120_000);

  afterAll(async () => {
    // 关闭真实 allocateFloor 通过 @/db 建立的连接池，否则 DROP DATABASE 会失败
    const g = globalThis as unknown as DbGlobals;
    await g.__v2exSql?.end().catch(() => undefined);
    clearGlobalDbCache();

    await ownSql?.end().catch(() => undefined);

    const dropUrl = testDatabaseUrl();
    if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl;

    const adminUrl = new URL(dropUrl);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { prepare: false });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => undefined);
    await admin.end();
  }, 120_000);

  it('初始状态：计数表为空（漂移已建立）', async () => {
    const rows = await ownDb
      .select({ lastFloor: schema.floorCounters.lastFloor })
      .from(schema.floorCounters)
      .where(eq(schema.floorCounters.topicId, driftTopicId));
    expect(rows).toHaveLength(0);
  });

  it(`连续发 ${N} 条回复：楼层号严格等于 [1..${N}]（不是仅唯一/递增）`, async () => {
    const assigned: number[] = [];

    for (let i = 0; i < N; i++) {
      // 真实实现（非复刻），分配后立刻真实 INSERT，走完整写路径
      const floor = await allocateFloor(topicId);
      const inserted = await ownDb
        .insert(schema.replies)
        .values({
          topicId,
          authorId,
          content: `连续性验证回复 ${i + 1} —— 用于确认楼层不跳号。`,
          floor,
        })
        .returning({ id: schema.replies.id });
      expect(inserted).toHaveLength(1);
      assigned.push(floor);
    }

    // 硬断言：严格连续，跳号（1,3,5…）会在这一行失败
    expect(assigned).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // 再从数据库读回，避免「只断言函数返回值」的假阳性
    const persisted = await ownDb
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId))
      .orderBy(schema.replies.floor);
    expect(persisted.map((r) => r.floor)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
  });

  it('计数表水位与实际最大楼层一致', async () => {
    const [counter] = await ownDb
      .select({ lastFloor: schema.floorCounters.lastFloor })
      .from(schema.floorCounters)
      .where(eq(schema.floorCounters.topicId, topicId));
    expect(counter?.lastFloor).toBe(N);

    const rows = await ownDb
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    expect(Math.max(...rows.map((r) => r.floor))).toBe(N);
    expect(new Set(rows.map((r) => r.floor)).size).toBe(rows.length);
  });

  it(`计数表落后时自愈后仍连续：预置 1..${PRESEED_FLOORS} + 新增，最终严格 [1..${PRESEED_FLOORS + 5}]`, async () => {
    // 先调用真实 ensureFloorCounter 把计数表抬到实际水位
    await ensureFloorCounter(driftTopicId);

    const assigned: number[] = [];
    for (let i = 0; i < 5; i++) {
      const floor = await allocateFloor(driftTopicId);
      await ownDb.insert(schema.replies).values({
        topicId: driftTopicId,
        authorId,
        content: `自愈后新增回复 ${i + 1}`,
        floor,
      });
      assigned.push(floor);
    }

    // 旧实现在自愈后会从 max+2 起跳；修复后应严格接着 6
    expect(assigned).toEqual([6, 7, 8, 9, 10]);

    const all = await ownDb
      .select({ floor: schema.replies.floor })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, driftTopicId))
      .orderBy(schema.replies.floor);
    expect(all.map((r) => r.floor)).toEqual(
      Array.from({ length: PRESEED_FLOORS + 5 }, (_, i) => i + 1),
    );
  });

  it('回归护栏：当前源码的分配分支不含会跳号的 greatest(...)+1', async () => {
    const { readFileSync: readFile } = await import('node:fs');
    const source = readFile(`${repoRoot}/src/server/floor.ts`, 'utf8');
    // 只看代码行，排除注释里对旧缺陷的描述
    const code = source
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

    expect(code).toContain('SET last_floor = floor_counters.last_floor + 1');
    expect(code).not.toMatch(/greatest\([^)]*EXCLUDED\.last_floor\)\s*\+\s*1/i);
  });
});
