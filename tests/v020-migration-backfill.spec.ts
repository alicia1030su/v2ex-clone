import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_DB = process.env.V020_MIGRATION_TEST_DB ?? 'v2ex_test_v020_migration_backfill';

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);

let client: ReturnType<typeof postgres>;

async function executeMigration(file: string): Promise<void> {
  const raw = readFileSync(path.join(ROOT, 'drizzle', file), 'utf8');
  const statements = raw.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) {
    await client.unsafe(statement);
  }
}

beforeAll(async () => {
  logDbTarget('tests/v020-migration-backfill.spec.ts', TEST_DB);
  await provisionTestDatabase({
    file: 'tests/v020-migration-backfill.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    // 本用例先手工执行 0000–0005，模拟真实 v0.0.19 数据库。
    migrate: () => undefined,
  });
  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 5, onnotice: () => {} });

  for (const file of [
    '0000_init.sql',
    '0001_striped_magdalene.sql',
    '0002_v004_perf_indexes.sql',
    '0003_v005_reports.sql',
    '0004_v014_categories.sql',
    '0005_v019_reply_threads.sql',
  ]) {
    await executeMigration(file);
  }

  await client.unsafe(`
    INSERT INTO categories (name, title) VALUES ('v020migcat', 'V020 Migration');
    INSERT INTO nodes (name, title, category_id, status)
      VALUES ('v020mig', 'V020 Migration', (SELECT id FROM categories WHERE name='v020migcat'), 'active');
    INSERT INTO users (username, password_hash) VALUES
      ('v020_mig_owner', 'x'), ('v020_mig_other', 'x');

    INSERT INTO topics (title, content, node_id, author_id)
      VALUES ('migration topic', 'body', (SELECT id FROM nodes WHERE name='v020mig'),
        (SELECT id FROM users WHERE username='v020_mig_owner'));

    INSERT INTO replies (topic_id, author_id, floor, content)
      VALUES ((SELECT id FROM topics WHERE title='migration topic'),
        (SELECT id FROM users WHERE username='v020_mig_owner'), 1,
        'active ![x](/uploads/replies/1/aaaaaaaaaaaaaaaa.png)');
    INSERT INTO replies (topic_id, author_id, floor, content)
      VALUES ((SELECT id FROM topics WHERE title='migration topic'),
        (SELECT id FROM users WHERE username='v020_mig_owner'), 2, 'no current image');
    INSERT INTO replies (topic_id, author_id, floor, content)
      VALUES ((SELECT id FROM topics WHERE title='migration topic'),
        (SELECT id FROM users WHERE username='v020_mig_other'), 3,
        'cross owner ![x](/uploads/replies/1/cccccccccccccccc.png)');
    INSERT INTO replies (topic_id, author_id, floor, content, deleted_at)
      VALUES ((SELECT id FROM topics WHERE title='migration topic'),
        (SELECT id FROM users WHERE username='v020_mig_owner'), 4,
        'deleted reply ![x](/uploads/replies/1/dddddddddddddddd.png)', now());

    INSERT INTO reply_images (user_id, reply_id, storage_path, mime_type, size)
      VALUES
        ((SELECT id FROM users WHERE username='v020_mig_owner'), 1, 'replies/1/aaaaaaaaaaaaaaaa.png', 'image/png', 10),
        ((SELECT id FROM users WHERE username='v020_mig_owner'), 2, 'replies/1/bbbbbbbbbbbbbbbb.png', 'image/png', 10),
        ((SELECT id FROM users WHERE username='v020_mig_owner'), 3, 'replies/1/cccccccccccccccc.png', 'image/png', 10),
        ((SELECT id FROM users WHERE username='v020_mig_owner'), 4, 'replies/1/dddddddddddddddd.png', 'image/png', 10),
        ((SELECT id FROM users WHERE username='v020_mig_owner'), NULL, 'replies/1/eeeeeeeeeeeeeeee.png', 'image/png', 10);
  `);

  await executeMigration('0006_v020_attachment_lifecycle.sql');
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
});

describe('v0.0.19 → v0.0.20 附件迁移回填', () => {
  it('只为未删除、同作者且正文仍包含精确 URL 的历史附件建立 link', async () => {
    const links = await client`
      SELECT ri.storage_path, r.floor
      FROM reply_image_links l
      JOIN reply_images ri ON ri.id = l.attachment_id
      JOIN replies r ON r.id = l.reply_id
      ORDER BY ri.storage_path
    `;
    expect(links).toEqual([
      { storage_path: 'replies/1/aaaaaaaaaaaaaaaa.png', floor: 1 },
    ]);
  });

  it('历史无当前引用的附件进入 superseded + 7 天宽限期队列', async () => {
    const rows = await client`
      SELECT storage_path, state, purge_after
      FROM reply_images
      ORDER BY storage_path
    `;
    const byPath = new Map(rows.map((row) => [row.storage_path, row]));
    expect(byPath.get('replies/1/aaaaaaaaaaaaaaaa.png')?.state).toBe('active');
    for (const file of [
      'replies/1/bbbbbbbbbbbbbbbb.png',
      'replies/1/cccccccccccccccc.png',
      'replies/1/dddddddddddddddd.png',
    ]) {
      expect(byPath.get(file)?.state).toBe('superseded');
      expect(byPath.get(file)?.purge_after).not.toBeNull();
      const purgeAfter = new Date(byPath.get(file)!.purge_after as Date).getTime();
      expect(purgeAfter).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    }
    expect(byPath.get('replies/1/eeeeeeeeeeeeeeee.png')?.state).toBe('active');

    const queue = await client`
      SELECT storage_path FROM attachment_purge_queue ORDER BY storage_path
    `;
    expect(queue.map((row) => row.storage_path)).toEqual([
      'replies/1/bbbbbbbbbbbbbbbb.png',
      'replies/1/cccccccccccccccc.png',
      'replies/1/dddddddddddddddd.png',
    ]);
  });

  it('约束存在且 0006 可幂等重入', async () => {
    await expect(client.unsafe(`
      UPDATE reply_images SET state = 'invalid' WHERE id = 1
    `)).rejects.toThrow(/reply_images_state_check/);

    const before = await client`SELECT count(*)::int AS n FROM reply_image_links`;
    await executeMigration('0006_v020_attachment_lifecycle.sql');
    const after = await client`SELECT count(*)::int AS n FROM reply_image_links`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});
