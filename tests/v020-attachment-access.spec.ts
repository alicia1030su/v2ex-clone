import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth';
import { UPLOAD_ROOT } from '../src/lib/upload-storage';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { GET as getUpload } from '../src/app/uploads/[...path]/route';

const TEST_DB = process.env.V020_ATTACHMENT_ACCESS_TEST_DB ?? 'v2ex_test_v020_attachment_access';

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

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let categoryId = 0;
let nodeId = 0;
let owner: SessionUser;
let other: SessionUser;
const createdFiles = new Set<string>();
let sequence = 0;

beforeAll(async () => {
  logDbTarget('tests/v020-attachment-access.spec.ts', TEST_DB);
  await provisionTestDatabase({
    file: 'tests/v020-attachment-access.spec.ts',
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
    .values({ name: 'v020accesscat', title: 'V020 Attachment Access' })
    .returning({ id: schema.categories.id });
  categoryId = category.id;

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v020access', title: 'V020 Access', categoryId })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const users = await db
    .insert(schema.users)
    .values([
      { username: 'v020_access_owner', passwordHash: 'x' },
      { username: 'v020_access_other', passwordHash: 'x' },
    ])
    .returning();
  owner = users.find((user) => user.username === 'v020_access_owner')!;
  other = users.find((user) => user.username === 'v020_access_other')!;
});

afterAll(async () => {
  for (const file of createdFiles) {
    await unlink(file).catch(() => undefined);
  }
  for (const dir of [...new Set([...createdFiles].map((file) => path.dirname(file)))].sort().reverse()) {
    await rmdir(dir).catch(() => undefined);
  }
  await client?.end({ timeout: 5 });
  const globalForDb = globalThis as unknown as { __v2exSql?: ReturnType<typeof postgres> };
  await globalForDb.__v2exSql?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

beforeEach(async () => {
  authState.user = null;
  await client.unsafe(`
    TRUNCATE topics, replies, reply_images, reply_image_links,
      attachment_purge_queue, avatars
    RESTART IDENTITY CASCADE
  `);
  await db.update(schema.users).set({ avatar: null });
  await db.update(schema.nodes).set({ status: 'active' }).where(eq(schema.nodes.id, nodeId));
});

async function createFile(storagePath: string): Promise<void> {
  const absolute = path.resolve(UPLOAD_ROOT, storagePath);
  if (absolute !== UPLOAD_ROOT && !absolute.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('test storage path escaped upload root');
  }
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from('v020-attachment-probe'));
  createdFiles.add(absolute);
}

async function fetchUpload(storagePath: string, viewer: SessionUser | null = null) {
  authState.user = viewer;
  const response = await getUpload(
    new Request(`http://localhost/uploads/${storagePath}`),
    {
      params: Promise.resolve({ path: storagePath.split('/') }),
    } as Parameters<typeof getUpload>[1],
  );
  if (response.status === 200) await response.arrayBuffer();
  return response;
}

interface TopicFixtureOptions {
  topicStatus?: 'published' | 'deleted' | 'locked';
  topicDeleted?: boolean;
  nodeStatus?: 'active' | 'pending' | 'hidden';
  replyDeleted?: boolean;
}

async function seedLinkedImage(
  state: 'active' | 'superseded' | 'deleted' | 'purged',
  options: TopicFixtureOptions = {},
): Promise<string> {
  sequence += 1;
  const storagePath = `replies/${owner.id}/d${sequence.toString(16).padStart(8, '0')}.png`;
  await createFile(storagePath);

  if (options.nodeStatus) {
    await db.update(schema.nodes).set({ status: options.nodeStatus }).where(eq(schema.nodes.id, nodeId));
  }

  const [topic] = await db
    .insert(schema.topics)
    .values({
      title: `v020 access topic ${sequence}`,
      content: 'attachment visibility probe',
      nodeId,
      authorId: owner.id,
      status: options.topicStatus ?? 'published',
      deletedAt: options.topicDeleted ? new Date() : null,
    })
    .returning({ id: schema.topics.id });

  const [reply] = await db
    .insert(schema.replies)
    .values({
      topicId: topic.id,
      authorId: owner.id,
      floor: 1,
      content: `![probe](/uploads/${storagePath})`,
      deletedAt: options.replyDeleted ? new Date() : null,
    })
    .returning({ id: schema.replies.id });

  const [image] = await db
    .insert(schema.replyImages)
    .values({
      userId: owner.id,
      storagePath,
      mimeType: 'image/png',
      size: 21,
      width: 1,
      height: 1,
      state,
      purgedAt: state === 'purged' ? new Date() : null,
    })
    .returning({ id: schema.replyImages.id });

  await db.insert(schema.replyImageLinks).values({
    replyId: reply.id,
    attachmentId: image.id,
  });

  return storagePath;
}

describe('v0.0.20 attachment authorization route', () => {
  it('serves only the current avatar, to both anonymous and other logged-in users', async () => {
    sequence += 1;
    const current = `avatars/${owner.id}/a${sequence.toString(16).padStart(8, '0')}.png`;
    const old = `avatars/${owner.id}/b${sequence.toString(16).padStart(8, '0')}.png`;
    await createFile(current);
    await createFile(old);
    await db.insert(schema.avatars).values([
      { userId: owner.id, storagePath: current, mimeType: 'image/png', size: 21, width: 1, height: 1 },
      { userId: owner.id, storagePath: old, mimeType: 'image/png', size: 21, width: 1, height: 1 },
    ]);
    await db.update(schema.users).set({ avatar: `/uploads/${current}` }).where(eq(schema.users.id, owner.id));

    for (const viewer of [null, owner, other]) {
      const response = await fetchUpload(current, viewer);
      expect(response.status, `current avatar viewer=${viewer?.username ?? 'anonymous'}`).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }

    const oldByOwner = await fetchUpload(old, owner);
    expect(oldByOwner.status).toBe(404);
    const oldByOther = await fetchUpload(old, other);
    expect(oldByOther.status).toBe(404);
  });

  it('keeps a pending reply image private to its owner', async () => {
    sequence += 1;
    const storagePath = `replies/${owner.id}/c${sequence.toString(16).padStart(8, '0')}.png`;
    await createFile(storagePath);
    await db.insert(schema.replyImages).values({
      userId: owner.id,
      storagePath,
      mimeType: 'image/png',
      size: 21,
      width: 1,
      height: 1,
      state: 'active',
    });

    const ownerResponse = await fetchUpload(storagePath, owner);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetchUpload(storagePath, other)).status).toBe(404);
    expect((await fetchUpload(storagePath, null)).status).toBe(404);
  });

  it('serves an active image bound to a published topic as public content', async () => {
    const storagePath = await seedLinkedImage('active');

    for (const viewer of [null, owner, other]) {
      const response = await fetchUpload(storagePath, viewer);
      expect(response.status, `public image viewer=${viewer?.username ?? 'anonymous'}`).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-type')).toBe('image/png');
    }
  });

  it('immediately revokes public access when the reply is soft-deleted', async () => {
    const storagePath = await seedLinkedImage('active', { replyDeleted: true });

    const ownerResponse = await fetchUpload(storagePath, owner);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetchUpload(storagePath, other)).status).toBe(404);
    expect((await fetchUpload(storagePath, null)).status).toBe(404);
  });

  it.each([
    ['soft-deleted topic', { topicDeleted: true }],
    ['non-published topic', { topicStatus: 'locked' as const }],
    ['hidden node', { nodeStatus: 'hidden' as const }],
  ])('immediately revokes public access for a %s', async (_label, options) => {
    const storagePath = await seedLinkedImage('active', options);

    const ownerResponse = await fetchUpload(storagePath, owner);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetchUpload(storagePath, other)).status).toBe(404);
    expect((await fetchUpload(storagePath, null)).status).toBe(404);
  });

  it('keeps superseded images owner-only during the grace period', async () => {
    const storagePath = await seedLinkedImage('superseded');

    const ownerResponse = await fetchUpload(storagePath, owner);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetchUpload(storagePath, other)).status).toBe(404);
    expect((await fetchUpload(storagePath, null)).status).toBe(404);
  });

  it.each(['deleted', 'purged'] as const)('returns 404 to everyone for a %s image', async (state) => {
    const storagePath = await seedLinkedImage(state);

    expect((await fetchUpload(storagePath, owner)).status).toBe(404);
    expect((await fetchUpload(storagePath, other)).status).toBe(404);
    expect((await fetchUpload(storagePath, null)).status).toBe(404);
  });

  it('rejects traversal and unknown paths without touching the filesystem', async () => {
    authState.user = owner;
    for (const segments of [
      ['avatars', String(owner.id), '..', 'secret.png'],
      ['replies', String(owner.id), 'not-a-hash.png'],
      ['avatars', String(owner.id)],
    ]) {
      const response = await getUpload(
        new Request(`http://localhost/uploads/${segments.join('/')}`),
        { params: Promise.resolve({ path: segments }) } as Parameters<typeof getUpload>[1],
      );
      expect(response.status).toBe(404);
    }
  });
});
