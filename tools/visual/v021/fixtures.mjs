import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { SEED_TIME_ANCHOR } from './spec.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const ENV_FILE = path.join(ROOT, '.env.test');

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertAuditDatabase(url) {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(?:test|audit)/i.test(database)) {
    throw new Error(`refusing non-audit database: ${database}`);
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error(`refusing non-loopback audit database host: ${parsed.hostname}`);
  }
  return database;
}

/**
 * Prepare deterministic, project-owned fixtures in the isolated test database.
 * This function never drops a database and never touches development/production
 * data. Existing fixture rows are updated in place.
 *
 * @param {{envFile?:string, seed?:boolean}} [options]
 * @returns {Promise<object>}
 */
export async function prepareFixtures(options = {}) {
  const envFile = options.envFile ?? ENV_FILE;
  if (!fs.existsSync(envFile)) throw new Error(`missing audit environment file: ${envFile}`);
  dotenv.config({ path: envFile, quiet: true });
  const env = { ...process.env, APP_NOW: SEED_TIME_ANCHOR, SEED_TIME_ANCHOR };
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for visual fixtures');
  const database = assertAuditDatabase(databaseUrl);

  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    // Always run the idempotent migration chain. An existing migration table only
    // proves that some migration ran; it does not prove the latest journal entry
    // (for example 0006 attachment lifecycle) has been applied.
    run(process.execPath, [path.join(ROOT, 'node_modules', 'drizzle-kit', 'bin.cjs'), 'migrate'], env);
    const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'));
    const applied = await sql`
      SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
    `;
    if (Number(applied[0]?.n ?? 0) < journal.entries.length) {
      throw new Error(`audit database migration journal is incomplete: ${applied[0]?.n ?? 0}/${journal.entries.length}`);
    }

    let userCount = Number((await sql`SELECT count(*)::int AS n FROM users`)[0]?.n ?? 0);
    if (userCount === 0 && options.seed !== false) {
      run(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')], env);
      userCount = Number((await sql`SELECT count(*)::int AS n FROM users`)[0]?.n ?? 0);
    }
    if (userCount === 0) throw new Error('audit database has no users after fixture preparation');

    const uploadRoot = path.resolve(env.UPLOAD_ROOT || path.join(ROOT, 'data', 'uploads'));
    const placeholder = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const referencedPaths = await sql`
      SELECT storage_path FROM reply_images
      UNION
      SELECT substring(avatar FROM '/uploads/(.*)$') AS storage_path FROM users WHERE avatar LIKE '/uploads/%'
    `;
    let createdUploadFixtures = 0;
    for (const row of referencedPaths) {
      const relative = String(row.storage_path ?? '');
      if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
        throw new Error(`unsafe audit upload path: ${relative}`);
      }
      const target = path.resolve(uploadRoot, relative);
      const rel = path.relative(uploadRoot, target);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`audit upload path escapes root: ${relative}`);
      }
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, placeholder, { flag: 'wx' });
        createdUploadFixtures += 1;
      }
    }

    const admin = (await sql`SELECT id, username FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1`)[0];
    const node = (await sql`SELECT id, name FROM nodes ORDER BY id LIMIT 1`)[0];
    if (!admin || !node) throw new Error('audit database requires at least one user and one node');

    const longTitle = `[V021-AUDIT] 长标题 ${'视觉审计与响应式布局'.repeat(5)}`.slice(0, 128);
    const longContent = `# 长正文 fixture\n\n${'这是用于验证换行、段落间距、代码块与移动端阅读体验的确定性内容。'.repeat(24)}`;
    const existing = (await sql`SELECT id FROM topics WHERE title = ${longTitle} AND deleted_at IS NULL LIMIT 1`)[0];
    let topicId = existing?.id ?? null;
    if (topicId === null) {
      topicId = (await sql`
        INSERT INTO topics (title, content, node_id, author_id, status, replies_count, views, votes, locked, pinned, created_at, updated_at, last_reply_at)
        VALUES (${longTitle}, ${longContent}, ${node.id}, ${admin.id}, 'published', 0, 1, 0, true, false, ${SEED_TIME_ANCHOR}, ${SEED_TIME_ANCHOR}, ${SEED_TIME_ANCHOR})
        RETURNING id
      `)[0].id;
    } else {
      await sql`
        UPDATE topics SET content = ${longContent}, node_id = ${node.id}, author_id = ${admin.id},
          status = 'published', replies_count = 0, locked = true, pinned = false,
          updated_at = ${SEED_TIME_ANCHOR}, last_reply_at = ${SEED_TIME_ANCHOR}
        WHERE id = ${topicId}
      `;
    }

    const tagName = 'visual-audit';
    const tag = (await sql`SELECT id FROM tags WHERE name = ${tagName} LIMIT 1`)[0];
    const tagId = tag?.id ?? (await sql`INSERT INTO tags (name) VALUES (${tagName}) RETURNING id`)[0].id;
    await sql`INSERT INTO topic_tags (topic_id, tag_id) VALUES (${topicId}, ${tagId}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE nodes SET topics_count = (SELECT count(*) FROM topics WHERE node_id = ${node.id} AND deleted_at IS NULL) WHERE id = ${node.id}`;

    const counts = await sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM topics WHERE deleted_at IS NULL) AS topics,
        (SELECT count(*)::int FROM replies) AS replies,
        (SELECT count(*)::int FROM nodes) AS nodes,
        (SELECT count(*)::int FROM tags) AS tags
    `;
    const fixtures = {
      topicId: Number(topicId),
      nodeName: node.name,
      username: admin.username,
      tagName,
      query: 'claude',
      replyMode: 'classic',
      longTitle,
      seedTimeAnchor: SEED_TIME_ANCHOR,
      counts: counts[0],
      createdUploadFixtures,
    };
    fixtures.fingerprint = `sha256:${createHash('sha256').update(JSON.stringify(fixtures)).digest('hex')}`;
    return fixtures;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  prepareFixtures().then((fixtures) => {
    process.stdout.write(`${JSON.stringify(fixtures)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
