import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as schema from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { attachTags } from '../src/server/tags';
import { buildFeedEntries } from '../src/lib/feed-builder';
import {
  getTopicById,
  listHotTopics,
  listReplies,
  listTopics,
  listTopicsByNodeIds,
  listTopicsByTag,
} from '../src/server/queries';
import { getTopicDetail } from '../src/lib/content-service';
import { listNotificationsForUser } from '../src/server/notifications';
import { loadLegacyFeed } from '../src/server/legacy-feed';
import { loadLegacyReplies } from '../src/server/legacy-replies';
import { loadLegacyTopics } from '../src/server/legacy-topics';
import { GET as searchTopics } from '../src/app/api/search/route';
import { GET as suggestTopics } from '../src/app/api/search/suggest/route';
import { GET as followedTopics } from '../src/app/api/users/follows/topics/route';
import { GET as getTopicApi } from '../src/app/api/topics/[id]/route';
import { GET as getReports } from '../src/app/api/reports/route';
import { POST as collectTopic } from '../src/app/api/collections/route';
import { POST as voteForTopic } from '../src/app/api/votes/route';
import { POST as thankReply } from '../src/app/api/thanks/route';
import { POST as reportTarget } from '../src/app/api/reports/route';
import { POST as createReply } from '../src/app/api/replies/route';
import MemberPage from '../src/app/member/[username]/page';
import XnaPage from '../src/app/xna/page';
import BookmarksPage from '../src/app/bookmarks/page';

/**
 * v0.0.18 public content visibility regression tests.
 *
 * Every test uses a dedicated database created through the repository guard.
 * The suite proves both directions: ordinary content remains readable and
 * interactive, while soft-deleted/hidden content disappears from public reads
 * and is rejected by interaction APIs.
 */

const TEST_DB = process.env.V018_CONTENT_VIS_TEST_DB ?? 'v2ex_test_v018_content_visibility';
const MARKER = 'v018visibilityprobe';
const TAG = 'v018vistag';
const REPLY_MARKER = 'v018-deleted-reply-secret';

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

vi.mock('@/lib/community-rate-limit', () => ({
  guardCommunityAction: vi.fn(async () => null),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByUser: vi.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}));

vi.mock('@/components/Wrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({
      href,
      children,
      className,
    }: {
      href: string;
      children: React.ReactNode;
      className?: string;
    }) => createElement('a', { href, className }, children),
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let categoryId = 0;
let nodeId = 0;
let author: SessionUser;
let reader: SessionUser;
let moderator: SessionUser;
let fixtureSequence = 0;

beforeAll(async () => {
  logDbTarget('tests/v018-content-visibility.spec.ts', TEST_DB);
  await provisionTestDatabase({
    file: 'tests/v018-content-visibility.spec.ts',
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
    .values({ name: 'v018viscat', title: 'V018 Visibility Category' })
    .returning({ id: schema.categories.id });
  categoryId = category.id;

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'vxna', title: 'VXNA', categoryId })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const users = await db
    .insert(schema.users)
    .values([
      { username: 'v018_author', passwordHash: 'x' },
      { username: 'v018_reader', passwordHash: 'x' },
      { username: 'v018_mod', passwordHash: 'x', role: 'moderator' },
    ])
    .returning();
  const byName = new Map(users.map((user) => [user.username, user]));
  author = byName.get('v018_author')!;
  reader = byName.get('v018_reader')!;
  moderator = byName.get('v018_mod')!;
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
  authState.user = null;
  await client.unsafe(`
    TRUNCATE topics, replies, votes, thanks, collections, follows, notifications,
      reports, edit_history, credit_ledger, daily_checkins, floor_counters,
      topic_tags, tags, moderation_logs
    RESTART IDENTITY CASCADE
  `);
  await db.update(schema.nodes).set({ status: 'active' }).where(eq(schema.nodes.id, nodeId));
});

interface Fixture {
  topicId: number;
  replyId: number;
  title: string;
}

async function seedFixture(): Promise<Fixture> {
  fixtureSequence += 1;
  const title = `${MARKER} topic ${fixtureSequence}`;
  const [topic] = await db
    .insert(schema.topics)
    .values({
      title,
      content: `${MARKER} public topic body`,
      nodeId,
      authorId: author.id,
    })
    .returning({ id: schema.topics.id });
  const [reply] = await db
    .insert(schema.replies)
    .values({
      topicId: topic.id,
      authorId: author.id,
      floor: 1,
      content: REPLY_MARKER,
    })
    .returning({ id: schema.replies.id });

  await attachTags(topic.id, [TAG]);
  await db.insert(schema.collections).values({
    userId: author.id,
    target: 'topic',
    topicId: topic.id,
  });
  await db.insert(schema.follows).values({
    followerId: reader.id,
    followingId: author.id,
  });
  await db.insert(schema.reports).values({
    reporterId: moderator.id,
    targetType: 'topic',
    targetId: topic.id,
    reason: '垃圾广告',
  });
  await db.insert(schema.notifications).values({
    userId: reader.id,
    type: 'reply',
    actorId: author.id,
    topicId: topic.id,
    replyId: reply.id,
    message: `通知包含标题：${title}`,
  });

  return { topicId: topic.id, replyId: reply.id, title };
}

function jsonRequest(path: string, body: unknown, method = 'POST'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function renderPage(page: Promise<React.ReactElement>): Promise<string> {
  return renderToStaticMarkup(await page);
}

async function publicReadSnapshot(fixture: Fixture) {
  const byNode = await listTopics({ nodeId, perPage: 50 });
  const byNodeIds = await listTopicsByNodeIds([nodeId], 1, 50);
  const hot = await listHotTopics(50);
  const byTag = await listTopicsByTag(TAG, 1, 50);
  const detail = await getTopicById(fixture.topicId);
  const detailService = await getTopicDetail(fixture.topicId, null);
  const replies = await listReplies(fixture.topicId, 1, 50);
  const feed = await buildFeedEntries(db, { baseUrl: 'https://example.test', limit: 30 });
  const legacyTopics = await loadLegacyTopics({
    filter: { kind: 'id', id: fixture.topicId },
    limit: 1,
    origin: 'https://example.test',
  });
  const legacyReplies = await loadLegacyReplies(fixture.topicId, 'https://example.test');
  const legacyFeed = await loadLegacyFeed({ origin: 'https://example.test', limit: 30 });

  const searchResponse = await searchTopics(
    new Request(`http://localhost/api/search?q=${MARKER}`),
  );
  const searchBody = await searchResponse.json();
  const suggestResponse = await suggestTopics(
    new Request(`http://localhost/api/search/suggest?q=${MARKER}`),
  );
  const suggestBody = await suggestResponse.json();

  authState.user = reader;
  const followsResponse = await followedTopics(
    new Request('http://localhost/api/users/follows/topics'),
  );
  const followsBody = await followsResponse.json();
  const topicResponse = await getTopicApi(
    new Request(`http://localhost/api/topics/${fixture.topicId}`),
    { params: Promise.resolve({ id: String(fixture.topicId) }) },
  );
  const topicBody = await topicResponse.json();
  const notifications = await listNotificationsForUser(reader.id);

  authState.user = null;
  const memberHtml = await renderPage(
    MemberPage({
      params: Promise.resolve({ username: author.username }),
      searchParams: Promise.resolve({}),
    }),
  );
  const xnaHtml = await renderPage(XnaPage());

  authState.user = author;
  const bookmarksHtml = await renderPage(BookmarksPage());
  authState.user = null;

  return {
    listTopics: byNode.items.some((topic) => topic.id === fixture.topicId),
    listTopicsByNodeIds: byNodeIds.items.some((topic) => topic.id === fixture.topicId),
    hot: hot.some((topic) => topic.id === fixture.topicId),
    tag: byTag.items.some((topic) => topic.id === fixture.topicId),
    detail: detail?.id === fixture.topicId,
    detailService: detailService.topic?.id === fixture.topicId,
    detailApi: topicBody.topic?.id === fixture.topicId,
    replies: replies.items.some((reply) => reply.id === fixture.replyId),
    feed: feed.some((entry) => entry.id === fixture.topicId),
    legacyTopics: legacyTopics.some((topic) => topic.id === fixture.topicId),
    legacyReplies: legacyReplies.some((reply) => reply.id === fixture.replyId),
    legacyFeed: legacyFeed?.entries.some((entry) => entry.topicId === fixture.topicId) ?? false,
    search: searchBody.results.some((topic: { id: number }) => topic.id === fixture.topicId),
    suggest: suggestBody.items.some(
      (item: { type: string; id: number }) => item.type === 'topic' && item.id === fixture.topicId,
    ),
    follows: followsBody.topics.some((topic: { id: number }) => topic.id === fixture.topicId),
    member: memberHtml.includes(fixture.title) && memberHtml.includes(REPLY_MARKER),
    xna: xnaHtml.includes(fixture.title),
    bookmarks: bookmarksHtml.includes(fixture.title),
    notification: notifications.items.some((item) => item.message.includes(fixture.title)),
  };
}

async function expectTopicInteractionsRejected(fixture: Fixture): Promise<void> {
  authState.user = reader;
  const responses = [
    await collectTopic(jsonRequest('/api/collections', { target: 'topic', id: fixture.topicId })),
    await voteForTopic(
      jsonRequest('/api/votes', { topicId: fixture.topicId, direction: 'up' }),
    ),
    await thankReply(jsonRequest('/api/thanks', { replyId: fixture.replyId })),
    await reportTarget(
      jsonRequest('/api/reports', {
        targetType: 'topic',
        targetId: fixture.topicId,
        reason: '垃圾广告',
      }),
    ),
    await createReply(
      jsonRequest('/api/replies', { topicId: fixture.topicId, content: '不应写入的回复内容' }),
    ),
  ];
  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  authState.user = null;
}

describe('公开内容可见性：正常内容仍可读、可互动', () => {
  it('所有公共读取面都能看到正常主题与回复，写接口成功', async () => {
    const fixture = await seedFixture();
    const visible = await publicReadSnapshot(fixture);
    for (const [surface, isVisible] of Object.entries(visible)) {
      expect(isVisible, `正常内容必须在 ${surface} 可见`).toBe(true);
    }

    authState.user = reader;
    const collected = await collectTopic(
      jsonRequest('/api/collections', { target: 'topic', id: fixture.topicId }),
    );
    const voted = await voteForTopic(
      jsonRequest('/api/votes', { topicId: fixture.topicId, direction: 'up' }),
    );
    const thanked = await thankReply(jsonRequest('/api/thanks', { replyId: fixture.replyId }));
    const reported = await reportTarget(
      jsonRequest('/api/reports', {
        targetType: 'reply',
        targetId: fixture.replyId,
        reason: '垃圾广告',
      }),
    );
    const replied = await createReply(
      jsonRequest('/api/replies', { topicId: fixture.topicId, content: '正常的新回复内容' }),
    );
    authState.user = null;

    expect([collected.status, voted.status, thanked.status, reported.status, replied.status]).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect((await voted.json()).votes).toBe(1);
    expect((await thanked.json()).thanks).toBe(1);
    expect((await replied.json()).replyId).toBeGreaterThan(0);
  });
});

describe('公开内容可见性：软删除主题全面不可见', () => {
  it('删主题后公共读取面不泄露，但举报人自己的历史反馈仍保留', async () => {
    const fixture = await seedFixture();
    await db
      .update(schema.topics)
      .set({ status: 'deleted', deletedAt: new Date(), deletedBy: moderator.id })
      .where(eq(schema.topics.id, fixture.topicId));

    const raw = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.id, fixture.topicId));
    expect(raw, '证明数据仍在库里，负面结果不是假绿').toHaveLength(1);

    const visible = await publicReadSnapshot(fixture);
    for (const [surface, isVisible] of Object.entries(visible)) {
      expect(isVisible, `软删除主题不得在 ${surface} 可见`).toBe(false);
    }
    expect((await listTopics({ nodeId, perPage: 50 })).total).toBe(0);
    expect((await listReplies(fixture.topicId, 1, 50)).total).toBe(0);

    await expectTopicInteractionsRejected(fixture);
    const counts = await client.unsafe(`
      SELECT
        (SELECT count(*)::int FROM votes) AS votes,
        (SELECT count(*)::int FROM thanks) AS thanks,
        (SELECT count(*)::int FROM collections) AS collections,
        (SELECT count(*)::int FROM reports) AS reports,
        (SELECT count(*)::int FROM replies) AS replies
    `);
    expect(counts[0]).toEqual({
      votes: 0,
      thanks: 0,
      collections: 1,
      reports: 1,
      replies: 1,
    });

    authState.user = moderator;
    const ownReports = await (await getReports(new Request('http://localhost/api/reports'))).json();
    authState.user = null;
    expect(ownReports.reports.some(
      (report: { targetLabel: string }) => report.targetLabel === fixture.title,
    ), '举报人自己的历史反馈必须保留目标标题').toBe(true);
  });

  it('includeDeleted 管理入口仍只对作者/staff 显式开放', async () => {
    const fixture = await seedFixture();
    await db
      .update(schema.topics)
      .set({ status: 'deleted', deletedAt: new Date(), deletedBy: moderator.id })
      .where(eq(schema.topics.id, fixture.topicId));

    expect(await getTopicById(fixture.topicId)).toBeNull();
    expect((await getTopicById(fixture.topicId, { includeDeleted: true }))?.id).toBe(fixture.topicId);
    expect((await getTopicDetail(fixture.topicId, null)).topic).toBeNull();
    expect((await getTopicDetail(fixture.topicId, reader)).topic).toBeNull();
    expect(
      (await getTopicDetail(fixture.topicId, author, { includeDeleted: true })).topic?.id,
    ).toBe(fixture.topicId);
    expect(
      (await getTopicDetail(fixture.topicId, moderator, { includeDeleted: true })).topic?.id,
    ).toBe(fixture.topicId);
    expect((await listReplies(fixture.topicId, 1, 50)).items).toHaveLength(0);
    expect(
      (await listReplies(fixture.topicId, 1, 50, { includeDeleted: true })).items.map(
        (reply) => reply.id,
      ),
    ).toContain(fixture.replyId);
  });

  it.each([
    { name: '仅 deletedAt', status: 'published' as const, deletedAt: new Date() },
    { name: '仅 status=deleted', status: 'deleted' as const, deletedAt: null },
    { name: '非 published 状态', status: 'locked' as const, deletedAt: null },
  ])('不一致/非公开状态：$name 也不得进入公共面', async ({ status, deletedAt }) => {
    const fixture = await seedFixture();
    await db
      .update(schema.topics)
      .set({ status, deletedAt })
      .where(eq(schema.topics.id, fixture.topicId));

    const visible = await publicReadSnapshot(fixture);
    for (const [surface, isVisible] of Object.entries(visible)) {
      expect(isVisible, `${surface} 不得暴露非公开主题`).toBe(false);
    }
    await expectTopicInteractionsRejected(fixture);
  });
});

describe('公开内容可见性：软删除回复不可见、不可互动', () => {
  it('删回复后列表与会员页不泄露正文，感谢/举报拒绝，正常主题仍在', async () => {
    const fixture = await seedFixture();
    const [liveReply] = await db
      .insert(schema.replies)
      .values({
        topicId: fixture.topicId,
        authorId: reader.id,
        floor: 2,
        content: 'v018-live-reply',
      })
      .returning({ id: schema.replies.id });
    await db.insert(schema.reports).values({
      reporterId: moderator.id,
      targetType: 'reply',
      targetId: fixture.replyId,
      reason: '垃圾广告',
    });
    await db
      .update(schema.replies)
      .set({ deletedAt: new Date(), deletedBy: moderator.id })
      .where(eq(schema.replies.id, fixture.replyId));

    const replies = await listReplies(fixture.topicId, 1, 50);
    expect(replies.total, '总数与列表同口径，不泄露已删除回复').toBe(1);
    expect(replies.items.map((reply) => reply.id)).toEqual([liveReply.id]);
    expect((await getTopicById(fixture.topicId))?.id).toBe(fixture.topicId);
    expect((await loadLegacyReplies(fixture.topicId, 'https://example.test')).map((r) => r.id)).toEqual([
      liveReply.id,
    ]);

    const memberHtml = await renderPage(
      MemberPage({
        params: Promise.resolve({ username: author.username }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(memberHtml).toContain(fixture.title);
    expect(memberHtml).not.toContain(REPLY_MARKER);

    authState.user = moderator;
    const reportsBody = await (await getReports(new Request('http://localhost/api/reports'))).json();
    authState.user = reader;
    const thanked = await thankReply(jsonRequest('/api/thanks', { replyId: fixture.replyId }));
    const reported = await reportTarget(
      jsonRequest('/api/reports', {
        targetType: 'reply',
        targetId: fixture.replyId,
        reason: '垃圾广告',
      }),
    );
    authState.user = null;

    expect(thanked.status).toBe(404);
    expect(reported.status).toBe(404);
    expect(JSON.stringify(reportsBody), '举报人自己的历史反馈保留回复片段').toContain(REPLY_MARKER);
  });
});

describe('公开内容可见性：隐藏节点与审核入口', () => {
  it('隐藏节点下主题/回复不可读、不可互动，staff 显式审核入口仍可用', async () => {
    const fixture = await seedFixture();
    await db.update(schema.nodes).set({ status: 'hidden' }).where(eq(schema.nodes.id, nodeId));

    const visible = await publicReadSnapshot(fixture);
    for (const [surface, isVisible] of Object.entries(visible)) {
      expect(isVisible, `隐藏节点内容不得在 ${surface} 可见`).toBe(false);
    }
    await expectTopicInteractionsRejected(fixture);

    expect(
      (await getTopicById(fixture.topicId, { includeHiddenNode: true }))?.id,
    ).toBe(fixture.topicId);
    expect(
      (await listReplies(fixture.topicId, 1, 50, { includeHiddenNode: true })).items.map(
        (reply) => reply.id,
      ),
    ).toContain(fixture.replyId);
    expect((await getTopicDetail(fixture.topicId, moderator)).topic?.id).toBe(fixture.topicId);
    expect((await getTopicDetail(fixture.topicId, author)).topic).toBeNull();
  });
});
