import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { listReplies } from '../src/server/queries';
import { getReplyContext } from '../src/server/reply-threads';
import {
  getUserPreferences,
  updateUserPreferences,
} from '../src/server/reply-preferences';
import { resolveReplyImagePath, processReplyImage } from '../src/lib/reply-images';
import { POST as createReply } from '../src/app/api/replies/route';
import { POST as uploadReplyImage } from '../src/app/api/reply-images/route';

const TEST_DB = process.env.V019_REPLY_THREAD_TEST_DB ?? 'v2ex_test_v019_reply_threads';

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const globalForDb = globalThis as unknown as {
    __v2exSql?: unknown;
    __v2exDrizzle?: unknown;
  };
  globalForDb.__v2exSql = undefined;
  globalForDb.__v2exDrizzle = undefined;
}

const authState = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    getSessionUser: vi.fn(async () => authState.user),
  };
});

vi.mock('@/lib/csrf-guard', () => ({
  guardCsrf: vi.fn(async () => null),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByUser: vi.fn(async () => ({
    ok: true,
    count: 1,
    limit: 20,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
  rateLimitSlidingByUser: vi.fn(async () => ({
    ok: true,
    count: 1,
    limit: 20,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
  rateLimitSlidingByIp: vi.fn(async () => ({
    ok: true,
    count: 1,
    limit: 20,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  })),
}));

vi.mock('@/lib/community-rate-limit', () => ({
  guardCommunityAction: vi.fn(async () => null),
}));

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let nodeId = 0;
let author: SessionUser;
let otherUser: SessionUser;

beforeAll(async () => {
  logDbTarget('tests/v019-reply-threads.spec.ts', TEST_DB);
  await provisionTestDatabase({
    file: 'tests/v019-reply-threads.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 10 });
  db = drizzle(client, { schema });

  const [category] = await db
    .insert(schema.categories)
    .values({ name: 'v019cat', title: 'V019 Category' })
    .returning({ id: schema.categories.id });
  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v019node', title: 'V019 Node', categoryId: category.id })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const users = await db
    .insert(schema.users)
    .values([
      { username: 'v019_author', passwordHash: 'x' },
      { username: 'v019_other', passwordHash: 'x' },
    ])
    .returning();
  const byName = new Map(users.map((user) => [user.username, user]));
  author = byName.get('v019_author')!;
  otherUser = byName.get('v019_other')!;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  const globalForDb = globalThis as unknown as {
    __v2exSql?: ReturnType<typeof postgres>;
  };
  await globalForDb.__v2exSql?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

beforeEach(async () => {
  authState.user = author;
  await client.unsafe(`
    TRUNCATE topics, replies, reply_images, user_preferences, notifications,
      credit_ledger, floor_counters
    RESTART IDENTITY CASCADE
  `);
  await db.update(schema.nodes).set({ status: 'active' }).where(eq(schema.nodes.id, nodeId));
});

async function seedTopic(title = 'v019 topic'): Promise<number> {
  const [topic] = await db
    .insert(schema.topics)
    .values({ title, content: 'body', nodeId, authorId: author.id })
    .returning({ id: schema.topics.id });
  return topic.id;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('v0.0.19 父子回复 API 与幂等', () => {
  it('同一 clientRequestId 只创建一条回复并返回相同 replyId', async () => {
    const topicId = await seedTopic();
    const requestId = '019-idempotency-request-0001';
    const first = await createReply(jsonRequest('/api/replies', {
      topicId,
      content: '第一条无刷新回复',
      clientRequestId: requestId,
    }));
    const firstBody = await readJson(first);
    expect(first.status).toBe(200);
    expect(firstBody.ok).toBe(true);
    const replyId = Number(firstBody.replyId);

    const second = await createReply(jsonRequest('/api/replies', {
      topicId,
      content: '第一条无刷新回复',
      clientRequestId: requestId,
    }));
    const secondBody = await readJson(second);
    expect(second.status).toBe(200);
    expect(secondBody.duplicated).toBe(true);
    expect(secondBody.replyId).toBe(replyId);

    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.replies)
      .where(eq(schema.replies.topicId, topicId));
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it('同主题父回复可写，跨主题父回复被服务端拒绝', async () => {
    const topicId = await seedTopic('topic A');
    const otherTopicId = await seedTopic('topic B');
    const [otherParent] = await db
      .insert(schema.replies)
      .values({
        topicId: otherTopicId,
        authorId: otherUser.id,
        content: 'other topic parent',
        floor: 1,
      })
      .returning({ id: schema.replies.id });

    const rejected = await createReply(jsonRequest('/api/replies', {
      topicId,
      content: '不能跨主题引用',
      parentReplyId: otherParent.id,
      clientRequestId: '019-cross-topic-request-0001',
    }));
    expect(rejected.status).toBe(404);
    expect((await readJson(rejected)).error).toBe('父回复不存在或不可见');

    const [parent] = await db
      .insert(schema.replies)
      .values({
        topicId,
        authorId: author.id,
        content: 'same topic parent',
        floor: 1,
      })
      .returning({ id: schema.replies.id });
    const accepted = await createReply(jsonRequest('/api/replies', {
      topicId,
      content: 'same topic child',
      parentReplyId: parent.id,
      clientRequestId: '019-same-topic-request-0001',
    }));
    expect(accepted.status).toBe(200);
    const body = await readJson(accepted);
    const reply = body.reply as { parentReplyId: number | null };
    expect(reply.parentReplyId).toBe(parent.id);
  });

  it('数据库拒绝自引用与环形父子关系', async () => {
    const topicId = await seedTopic();
    const [a, b] = await db
      .insert(schema.replies)
      .values([
        { topicId, authorId: author.id, content: 'a', floor: 1 },
        { topicId, authorId: author.id, content: 'b', floor: 2 },
      ])
      .returning({ id: schema.replies.id });

    await expect(
      client.unsafe(`UPDATE replies SET parent_reply_id = ${a.id} WHERE id = ${a.id}`),
    ).rejects.toThrow(/不能引用自己/);

    await db.update(schema.replies).set({ parentReplyId: a.id }).where(eq(schema.replies.id, b.id));
    await expect(
      client.unsafe(`UPDATE replies SET parent_reply_id = ${b.id} WHERE id = ${a.id}`),
    ).rejects.toThrow(/不能成环/);
  });
});

describe('v0.0.19 跨页上下文与容量', () => {
  it.each([100, 500, 2000])(' %i 条回复保持分页与跨页父链可用', async (count) => {
    const topicId = await seedTopic(`capacity ${count}`);
    await client.unsafe(`
      INSERT INTO replies (topic_id, author_id, content, floor, parent_reply_id)
      SELECT ${topicId}, ${author.id}, 'capacity reply ' || g, g,
        CASE WHEN g = 101 THEN 1 ELSE NULL END
      FROM generate_series(1, ${count}) AS g
    `);

    const page2 = await listReplies(topicId, 2, 100);
    expect(page2.total).toBe(count);
    if (count > 100) {
      expect(page2.items[0]?.floor).toBe(101);
      expect(page2.items[0]?.parentReplyId).toBe(1);

      const context = await getReplyContext(topicId, 101);
      expect(context).not.toBeNull();
      expect(context?.parentChain[0]?.floor).toBe(1);
      expect(context?.parentChain[0]?.excerpt).toContain('capacity reply 1');
    } else {
      expect(page2.items).toHaveLength(0);
    }
  });

  it('楼中楼子回复按 cursor 增量返回且不泄露正文给不可见父回复', async () => {
    const topicId = await seedTopic();
    const [parent] = await db
      .insert(schema.replies)
      .values({ topicId, authorId: author.id, content: 'parent', floor: 1 })
      .returning({ id: schema.replies.id });
    await db.insert(schema.replies).values([
      { topicId, authorId: otherUser.id, content: 'child one', floor: 2, parentReplyId: parent.id },
      { topicId, authorId: otherUser.id, content: 'child two', floor: 3, parentReplyId: parent.id },
    ]);

    const first = await getReplyContext(topicId, parent.id);
    expect(first?.childrenTotal).toBe(2);
    expect(first?.children.map((child) => child.floor)).toEqual([2, 3]);
    expect(first?.children[0]?.html).toContain('child one');

    const next = await getReplyContext(topicId, parent.id, { childCursor: 2 });
    expect(next?.children.map((child) => child.floor)).toEqual([3]);

    await db.update(schema.replies).set({ deletedAt: new Date() }).where(eq(schema.replies.id, parent.id));
    const publicContext = await getReplyContext(topicId, 2);
    expect(publicContext?.parentChain[0]?.inaccessible).toBe(true);
    expect(publicContext?.parentChain[0]?.excerpt).toBeNull();
  });
});

describe('v0.0.19 偏好与回复图片安全', () => {
  it('用户偏好可更新且非法值不会写入', async () => {
    await updateUserPreferences(author.id, {
      replyDisplayMode: 'tree',
      themePreference: 'dark',
    });
    expect(await getUserPreferences(author.id)).toEqual({
      replyDisplayMode: 'tree',
      themePreference: 'dark',
    });
  });

  it('SVG 上传被拒绝，路径穿越解析被拒绝', async () => {
    const form = new FormData();
    form.append('file', new File(['<svg onload="alert(1)"></svg>'], 'evil.svg', { type: 'image/svg+xml' }));
    const request = new Request('http://localhost/api/reply-images', { method: 'POST', body: form });
    const response = await uploadReplyImage(request);
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain('只支持 PNG');

    expect(resolveReplyImagePath('replies/1/../../etc/passwd.png')).toBeNull();
    expect(resolveReplyImagePath('avatars/1/abc.png')).toBeNull();
  });

  it('真实 PNG 可处理并剥离元数据', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const processed = await processReplyImage(png, 'png');
    expect(processed.format).toBe('png');
    expect(processed.width).toBeGreaterThan(0);
    expect(processed.height).toBeGreaterThan(0);
  });
});
