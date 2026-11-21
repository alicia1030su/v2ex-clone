import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth';
import { UPLOAD_ROOT } from '../src/lib/upload-storage';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import {
  AttachmentLinkError,
  syncReplyImageLinks,
} from '../src/server/attachment-links';
import { resolveReplyImageVisibility } from '../src/server/attachment-access';
import { DELETE as deleteReplyImage } from '../src/app/api/reply-images/route';

const TEST_DB = process.env.V020_ATTACHMENT_LIFECYCLE_TEST_DB ?? 'v2ex_test_v020_attachment_lifecycle';

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
const purgeControl = vi.hoisted(() => ({
  delegate: true,
  actual: null as null | ((limit?: number) => Promise<number>),
}));

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
  rateLimitByUser: vi.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
  rateLimitSlidingByUser: vi.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}));

vi.mock('@/server/attachment-purge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/attachment-purge')>();
  purgeControl.actual = actual.purgeAttachmentQueue;
  return {
    ...actual,
    purgeAttachmentQueue: async (limit = 50) => {
      if (!purgeControl.delegate || !purgeControl.actual) return 0;
      return purgeControl.actual(limit);
    },
  };
});

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let categoryId = 0;
let nodeId = 0;
let owner: SessionUser;
let other: SessionUser;
let sequence = 0;
const createdFiles = new Set<string>();

async function runActualPurge(limit = 50): Promise<number> {
  const actual = await vi.importActual<typeof import('../src/server/attachment-purge')>(
    '@/server/attachment-purge',
  );
  return actual.purgeAttachmentQueue(limit);
}

beforeAll(async () => {
  logDbTarget('tests/v020-attachment-lifecycle.spec.ts', TEST_DB);
  await provisionTestDatabase({
    file: 'tests/v020-attachment-lifecycle.spec.ts',
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
    .values({ name: 'v020lifecat', title: 'V020 Lifecycle' })
    .returning({ id: schema.categories.id });
  categoryId = category.id;

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v020life', title: 'V020 Lifecycle', categoryId })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const users = await db
    .insert(schema.users)
    .values([
      { username: 'v020_life_owner', passwordHash: 'x' },
      { username: 'v020_life_other', passwordHash: 'x' },
    ])
    .returning();
  owner = users.find((user) => user.username === 'v020_life_owner')!;
  other = users.find((user) => user.username === 'v020_life_other')!;
});

afterAll(async () => {
  for (const file of createdFiles) await unlink(file).catch(() => undefined);
  for (const dir of [...new Set([...createdFiles].map((file) => path.dirname(file)))].sort().reverse()) {
    await rmdir(dir).catch(() => undefined);
  }
  await client?.end({ timeout: 5 });
  const globalForDb = globalThis as unknown as { __v2exSql?: ReturnType<typeof postgres> };
  await globalForDb.__v2exSql?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

beforeEach(async () => {
  authState.user = owner;
  purgeControl.delegate = true;
  await client.unsafe(`
    TRUNCATE topics, replies, reply_images, reply_image_links,
      attachment_purge_queue
    RESTART IDENTITY CASCADE
  `);
});

afterEach(async () => {
  for (const file of createdFiles) await unlink(file).catch(() => undefined);
  createdFiles.clear();
});

async function createReply(authorId = owner.id): Promise<number> {
  const [topic] = await db
    .insert(schema.topics)
    .values({
      title: `v020 lifecycle topic ${++sequence}`,
      content: 'lifecycle probe',
      nodeId,
      authorId,
    })
    .returning({ id: schema.topics.id });
  const [reply] = await db
    .insert(schema.replies)
    .values({
      topicId: topic.id,
      authorId,
      floor: 1,
      content: 'lifecycle probe',
    })
    .returning({ id: schema.replies.id });
  return reply.id;
}

async function createImage(
  userId = owner.id,
  state: 'active' | 'superseded' | 'deleted' | 'purged' = 'active',
): Promise<{ id: number; storagePath: string }> {
  sequence += 1;
  const storagePath = `replies/${userId}/${sequence.toString(16).padStart(8, '0')}.png`;
  const absolute = path.resolve(UPLOAD_ROOT, storagePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from('lifecycle-probe'));
  createdFiles.add(absolute);
  const [image] = await db
    .insert(schema.replyImages)
    .values({
      userId,
      storagePath,
      mimeType: 'image/png',
      size: 15,
      width: 1,
      height: 1,
      state,
      purgedAt: state === 'purged' ? new Date() : null,
    })
    .returning({ id: schema.replyImages.id });
  return { id: image.id, storagePath };
}

function markdown(storagePath: string): string {
  return `![probe](/uploads/${storagePath})`;
}

async function linkImage(replyId: number, userId: number, storagePath: string, imageId: number) {
  await db.transaction((tx) => syncReplyImageLinks(tx, {
    replyId,
    userId,
    content: markdown(storagePath),
    imageIds: [imageId],
  }));
}

async function unlinkImage(replyId: number, userId: number) {
  await db.transaction((tx) => syncReplyImageLinks(tx, {
    replyId,
    userId,
    content: 'no images',
    imageIds: [],
  }));
}

describe('v0.0.20 附件引用状态机', () => {
  it('pending 绑定后建立当前 link 并进入 active', async () => {
    const replyId = await createReply();
    const image = await createImage();

    await linkImage(replyId, owner.id, image.storagePath, image.id);

    const links = await db.select().from(schema.replyImageLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ replyId, attachmentId: image.id });
    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('active');
    expect(row.usedAt).not.toBeNull();
    expect(row.replyId).toBe(replyId);
  });

  it('编辑移除后进入 superseded、进入宽限期队列且立即撤销公开访问', async () => {
    const replyId = await createReply();
    const image = await createImage();
    await linkImage(replyId, owner.id, image.storagePath, image.id);

    await unlinkImage(replyId, owner.id);

    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('superseded');
    expect(row.purgeAfter).not.toBeNull();
    const queue = await db.select().from(schema.attachmentPurgeQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0].storagePath).toBe(image.storagePath);
    expect(await resolveReplyImageVisibility(image.storagePath, null)).toEqual({ visible: false, isPublic: false });
    expect(await resolveReplyImageVisibility(image.storagePath, owner.id)).toEqual({ visible: true, isPublic: false });
  });

  it('宽限期内重新引用会恢复 active 并取消 purge', async () => {
    const replyId = await createReply();
    const image = await createImage();
    await linkImage(replyId, owner.id, image.storagePath, image.id);
    await unlinkImage(replyId, owner.id);

    await linkImage(replyId, owner.id, image.storagePath, image.id);

    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('active');
    expect(row.purgeAfter).toBeNull();
    expect(await db.select().from(schema.attachmentPurgeQueue)).toHaveLength(0);
    expect(await resolveReplyImageVisibility(image.storagePath, null)).toEqual({ visible: true, isPublic: true });
  });

  it('同一附件被多个回复引用时，移除一个引用不会误删', async () => {
    const replyA = await createReply();
    const replyB = await createReply();
    const image = await createImage();
    await linkImage(replyA, owner.id, image.storagePath, image.id);
    await linkImage(replyB, owner.id, image.storagePath, image.id);

    await unlinkImage(replyA, owner.id);

    const links = await db.select().from(schema.replyImageLinks);
    expect(links).toHaveLength(1);
    expect(links[0].replyId).toBe(replyB);
    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('active');
    expect(await db.select().from(schema.attachmentPurgeQueue)).toHaveLength(0);
  });

  it('拒绝跨用户引用且事务不留下半截 link', async () => {
    const replyId = await createReply();
    const image = await createImage(other.id);

    await expect(linkImage(replyId, owner.id, image.storagePath, image.id)).rejects.toBeInstanceOf(
      AttachmentLinkError,
    );
    expect(await db.select().from(schema.replyImageLinks)).toHaveLength(0);
  });

  it('旧 URL 与图片 ID 无法一一映射时拒绝提交', async () => {
    const replyId = await createReply();
    const first = await createImage();
    const second = await createImage();

    await expect(db.transaction((tx) => syncReplyImageLinks(tx, {
      replyId,
      userId: owner.id,
      content: markdown(first.storagePath),
      imageIds: [second.id],
    }))).rejects.toBeInstanceOf(AttachmentLinkError);
    expect(await db.select().from(schema.replyImageLinks)).toHaveLength(0);
  });

  it('deleted 附件不能通过重新引用复活', async () => {
    const replyId = await createReply();
    const image = await createImage(owner.id, 'deleted');

    await expect(linkImage(replyId, owner.id, image.storagePath, image.id)).rejects.toBeInstanceOf(
      AttachmentLinkError,
    );
    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('deleted');
    expect(await resolveReplyImageVisibility(image.storagePath, owner.id)).toEqual({
      visible: false,
      isPublic: false,
    });
  });

  it('worker 可重领崩溃遗留的过期锁并幂等完成 purge', async () => {
    const previousGrace = process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
    process.env.ATTACHMENT_PURGE_GRACE_SECONDS = '0';
    try {
      const replyId = await createReply();
      const image = await createImage();
      await linkImage(replyId, owner.id, image.storagePath, image.id);
      await unlinkImage(replyId, owner.id);
      await db.update(schema.attachmentPurgeQueue)
        .set({ lockedAt: new Date(Date.now() - 10 * 60 * 1000), lockedBy: 'crashed-worker' })
        .where(eq(schema.attachmentPurgeQueue.storagePath, image.storagePath));

      const queueBefore = await db.select().from(schema.attachmentPurgeQueue);
      const imageBefore = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      const purgedCount = await runActualPurge();
      expect(
        purgedCount,
        JSON.stringify({ queueBefore, imageBefore, queueAfter: await db.select().from(schema.attachmentPurgeQueue) }),
      ).toBe(1);

      const absolute = path.resolve(UPLOAD_ROOT, image.storagePath);
      expect(existsSync(absolute)).toBe(false);
      const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      expect(row.state).toBe('purged');
      expect(row.purgedAt).not.toBeNull();
      expect(await db.select().from(schema.attachmentPurgeQueue)).toHaveLength(0);
      expect(await runActualPurge()).toBe(0);
    } finally {
      if (previousGrace === undefined) delete process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
      else process.env.ATTACHMENT_PURGE_GRACE_SECONDS = previousGrace;
    }
  });

  it('未到期队列不会 purge，重新引用后 worker 不得误删新有效附件', async () => {
    const previousGrace = process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
    process.env.ATTACHMENT_PURGE_GRACE_SECONDS = '3600';
    try {
      const replyId = await createReply();
      const image = await createImage();
      await linkImage(replyId, owner.id, image.storagePath, image.id);
      await unlinkImage(replyId, owner.id);

      expect(await runActualPurge()).toBe(0);
      await linkImage(replyId, owner.id, image.storagePath, image.id);
      expect(await runActualPurge()).toBe(0);

      const absolute = path.resolve(UPLOAD_ROOT, image.storagePath);
      expect(existsSync(absolute)).toBe(true);
      const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      expect(row.state).toBe('active');
    } finally {
      if (previousGrace === undefined) delete process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
      else process.env.ATTACHMENT_PURGE_GRACE_SECONDS = previousGrace;
    }
  });

  it('worker 已 claim 的附件不能被编辑重新引用', async () => {
    const previousGrace = process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
    process.env.ATTACHMENT_PURGE_GRACE_SECONDS = '0';
    try {
      const replyId = await createReply();
      const image = await createImage();
      await linkImage(replyId, owner.id, image.storagePath, image.id);
      await unlinkImage(replyId, owner.id);
      await db.update(schema.attachmentPurgeQueue)
        .set({ lockedAt: new Date(), lockedBy: 'live-worker' })
        .where(eq(schema.attachmentPurgeQueue.storagePath, image.storagePath));

      await expect(linkImage(replyId, owner.id, image.storagePath, image.id)).rejects.toBeInstanceOf(
        AttachmentLinkError,
      );
      const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      expect(row.state).toBe('superseded');
      expect(existsSync(path.resolve(UPLOAD_ROOT, image.storagePath))).toBe(true);
    } finally {
      if (previousGrace === undefined) delete process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
      else process.env.ATTACHMENT_PURGE_GRACE_SECONDS = previousGrace;
    }
  });

  it('purge 与重新引用并发只允许 active+文件存在或 purged+文件删除', async () => {
    const previousGrace = process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
    process.env.ATTACHMENT_PURGE_GRACE_SECONDS = '0';
    try {
      const replyId = await createReply();
      const image = await createImage();
      await linkImage(replyId, owner.id, image.storagePath, image.id);
      await unlinkImage(replyId, owner.id);
      const [beforeRace] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      const queueBeforeRace = await db.select().from(schema.attachmentPurgeQueue);
      expect(beforeRace.state, '并发前置状态必须是 superseded').toBe('superseded');
      expect(queueBeforeRace).toHaveLength(1);

      const [purged, relink] = await Promise.allSettled([
        runActualPurge(),
        db.transaction((tx) => syncReplyImageLinks(tx, {
          replyId,
          userId: owner.id,
          content: markdown(image.storagePath),
          imageIds: [image.id],
        })),
      ]);
      expect(purged.status).toBe('fulfilled');

      const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
      const fileExists = existsSync(path.resolve(UPLOAD_ROOT, image.storagePath));
      if (row.state === 'active') {
        expect(
          relink.status,
          relink.status === 'rejected' ? String(relink.reason) : 'relink unexpectedly fulfilled',
        ).toBe('fulfilled');
        expect(fileExists).toBe(true);
        expect(await db.select().from(schema.attachmentPurgeQueue)).toHaveLength(0);
      } else if (row.state === 'purged') {
        expect(relink.status).toBe('rejected');
        expect(fileExists).toBe(false);
        expect(await db.select().from(schema.attachmentPurgeQueue)).toHaveLength(0);
      } else {
        throw new Error(`非法并发终态：${row.state}`);
      }
    } finally {
      if (previousGrace === undefined) delete process.env.ATTACHMENT_PURGE_GRACE_SECONDS;
      else process.env.ATTACHMENT_PURGE_GRACE_SECONDS = previousGrace;
    }
  });
});

describe('v0.0.20 待绑定图片删除 API', () => {
  it('先提交 deleted + queue，确认后才由 worker 删除物理文件', async () => {
    purgeControl.delegate = false;
    const image = await createImage();

    const response = await deleteReplyImage(
      new Request('http://localhost/api/reply-images', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: image.id }),
      }),
    );
    expect(response.status).toBe(200);

    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('deleted');
    const queue = await db.select().from(schema.attachmentPurgeQueue);
    expect(queue).toHaveLength(1);
    expect(existsSync(path.resolve(UPLOAD_ROOT, image.storagePath))).toBe(true);

    purgeControl.delegate = true;
    expect(await runActualPurge()).toBe(1);
    expect(existsSync(path.resolve(UPLOAD_ROOT, image.storagePath))).toBe(false);
    const [purged] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(purged.state).toBe('purged');
  });

  it('已绑定图片不能直接删除', async () => {
    purgeControl.delegate = false;
    const replyId = await createReply();
    const image = await createImage();
    await linkImage(replyId, owner.id, image.storagePath, image.id);

    const response = await deleteReplyImage(
      new Request('http://localhost/api/reply-images', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: image.id }),
      }),
    );
    expect(response.status).toBe(409);
    const [row] = await db.select().from(schema.replyImages).where(eq(schema.replyImages.id, image.id));
    expect(row.state).toBe('active');
    expect(existsSync(path.resolve(UPLOAD_ROOT, image.storagePath))).toBe(true);
  });
});
