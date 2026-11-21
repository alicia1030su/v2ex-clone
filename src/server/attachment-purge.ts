import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { deleteAvatarFile } from '@/lib/avatar';
import { deleteReplyImageFile } from '@/lib/reply-images';
import { extractRows } from '@/server/sql-rows';

type PurgeKind = 'avatar' | 'reply_image';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

type QueueRow = {
  id: number;
  storage_path: string;
  kind: string;
};

export async function enqueueAttachmentPurge(
  tx: {
    execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
  },
  input: {
    storagePath: string;
    kind: PurgeKind;
    userId: number | null;
    purgeAfter?: Date;
  },
): Promise<void> {
  const purgeAfter = (input.purgeAfter ?? new Date()).toISOString();
  await tx.execute(sql`
    INSERT INTO attachment_purge_queue (storage_path, kind, user_id, purge_after)
    VALUES (${input.storagePath}, ${input.kind}, ${input.userId}, ${purgeAfter}::timestamptz)
    ON CONFLICT (storage_path) DO UPDATE
      SET purge_after = LEAST(attachment_purge_queue.purge_after, EXCLUDED.purge_after),
          last_error = NULL
  `);
}

function rowsOf<T>(result: unknown): T[] {
  return extractRows<T>(result);
}

/**
 * 阶段 1：领取到期任务并提交 claim。
 *
 * 不在事务内删除物理文件；DB 先持久化 locked_at/locked_by 后才允许进入 IO 阶段。
 * 进程在 claim 后崩溃，其它 worker 在锁超时后可幂等重领。
 */
async function claimPurgeItems(limit: number, workerId: string): Promise<QueueRow[]> {
  return await db.transaction(async (tx) => {
    const due = rowsOf<QueueRow>(await tx.execute(sql`
      SELECT id, storage_path, kind
      FROM attachment_purge_queue
      WHERE purge_after <= now()
        AND (locked_at IS NULL OR locked_at < now() - ${LOCK_TIMEOUT_MS} * interval '1 millisecond')
      ORDER BY purge_after, id
      LIMIT ${Math.max(1, Math.min(limit, 200))}
      FOR UPDATE SKIP LOCKED
    `));

    const claimed: QueueRow[] = [];
    for (const item of due) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${item.storage_path}, 0))`);
      const current = rowsOf<QueueRow & { locked_at: string | null; locked_by: string | null }>(
        await tx.execute(sql`
          SELECT id, storage_path, kind, locked_at, locked_by
          FROM attachment_purge_queue
          WHERE id = ${item.id}
          FOR UPDATE
        `),
      )[0];
      if (!current) continue;
      if (current.locked_at && Date.now() - new Date(current.locked_at).getTime() < LOCK_TIMEOUT_MS) {
        continue;
      }

      if (current.kind === 'reply_image') {
        const image = rowsOf<{ state: string }>(await tx.execute(sql`
          SELECT state
          FROM reply_images
          WHERE storage_path = ${current.storage_path}
          FOR UPDATE
        `))[0];
        const links = rowsOf<{ count: number }>(await tx.execute(sql`
          SELECT count(*)::int AS count
          FROM reply_image_links
          WHERE attachment_id = (
            SELECT id FROM reply_images WHERE storage_path = ${current.storage_path}
          )
        `))[0];
        if (!image || image.state === 'purged' || image.state === 'active' || Number(links?.count ?? 0) > 0) {
          await tx.execute(sql`DELETE FROM attachment_purge_queue WHERE id = ${current.id}`);
          continue;
        }
      } else if (current.kind === 'avatar') {
        const inUse = rowsOf<{ count: number }>(await tx.execute(sql`
          SELECT count(*)::int AS count
          FROM users
          WHERE avatar = ${'/uploads/' + current.storage_path}
        `))[0];
        if (Number(inUse?.count ?? 0) > 0) {
          await tx.execute(sql`DELETE FROM attachment_purge_queue WHERE id = ${current.id}`);
          continue;
        }
      } else {
        await tx.execute(sql`
          UPDATE attachment_purge_queue
          SET attempts = attempts + 1, last_error = ${`未知附件类型：${current.kind}`}, locked_at = NULL
          WHERE id = ${current.id}
        `);
        continue;
      }

      await tx.execute(sql`
        UPDATE attachment_purge_queue
        SET locked_at = now(), locked_by = ${workerId}, last_error = NULL
        WHERE id = ${current.id}
      `);
      claimed.push({ id: current.id, storage_path: current.storage_path, kind: current.kind });
    }
    return claimed;
  });
}

/** 阶段 2：物理删除后提交 purged tombstone；失败则释放锁并保留 superseded/deleted 状态。 */
async function finalizePurgeItem(item: QueueRow, workerId: string): Promise<boolean> {
  try {
    if (item.kind === 'avatar') {
      await deleteAvatarFile(item.storage_path);
    } else if (item.kind === 'reply_image') {
      await deleteReplyImageFile(item.storage_path);
    } else {
      throw new Error(`未知附件类型：${item.kind}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${item.storage_path}, 0))`);
      await tx.execute(sql`
        UPDATE attachment_purge_queue
        SET attempts = attempts + 1, last_error = ${message}, locked_at = NULL, locked_by = NULL
        WHERE id = ${item.id} AND locked_by = ${workerId}
      `);
    });
    return false;
  }

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${item.storage_path}, 0))`);
    const queued = rowsOf<{ id: number }>(await tx.execute(sql`
      SELECT id
      FROM attachment_purge_queue
      WHERE id = ${item.id} AND locked_by = ${workerId}
      FOR UPDATE
    `))[0];
    if (!queued) return false;

    if (item.kind === 'reply_image') {
      await tx.execute(sql`
        UPDATE reply_images
        SET state = 'purged', purged_at = now(), purge_after = NULL
        WHERE storage_path = ${item.storage_path}
      `);
    }
    await tx.execute(sql`DELETE FROM attachment_purge_queue WHERE id = ${item.id}`);
    return true;
  });
}

/** 执行一轮幂等清理；返回成功完成 tombstone 的任务数。 */
export async function purgeAttachmentQueue(limit = 50): Promise<number> {
  const workerId = randomUUID();
  const claimed = await claimPurgeItems(limit, workerId);
  let purged = 0;
  for (const item of claimed) {
    if (await finalizePurgeItem(item, workerId)) purged += 1;
  }
  return purged;
}

export function startAttachmentPurgeWorker(): void {
  const run = () => {
    void purgeAttachmentQueue(50).catch((err) => {
      console.error('[attachment-purge] worker run failed', err);
    });
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
}
