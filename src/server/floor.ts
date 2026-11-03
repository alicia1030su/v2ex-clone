import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { extractRows } from '@/server/sql-rows';

/**
 * 楼层号分配器
 *
 * 用 PostgreSQL 的独立计数表做原子分配，避免并发回复产生重复楼层号。
 * 表结构（由迁移 0002_floor_counters.sql 创建）：
 *   floor_counters(topic_id PK, last_floor INT)
 *
 * 通过 UPSERT 实现原子递增：并发请求各自拿到不同的 last_floor。
 *
 * 自愈（关键）：
 *   计数表可能落后于实际数据 —— 典型场景是 seed 写入了固定楼层的回复，
 *   却没同步计数表。此时 allocateFloor 会返回**已被占用**的楼层号，
 *   插入触发 replies_topic_floor_uidx 唯一索引冲突。
 *   路由层虽有「冲突就 +1 重试」的兜底，但只试 5 次；
 *   落后超过 5 层时全部冲突 → 500。
 *
 *   因此分配时把计数表与实际 max(floor) 取较大值，
 *   再原子递增 —— 计数器偏低时自动抬到正确水位。
 */
export async function allocateFloor(topicId: number): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO floor_counters (topic_id, last_floor)
    SELECT ${topicId}, greatest(coalesce(max(floor), 0), 0) + 1
    FROM replies WHERE topic_id = ${topicId}
    ON CONFLICT (topic_id) DO UPDATE
      SET last_floor = greatest(floor_counters.last_floor, EXCLUDED.last_floor) + 1
    RETURNING last_floor
  `);

  return Number(extractRows<{ last_floor: number }>(result)[0]?.last_floor ?? 1);
}

/**
 * 同步计数表，使其不低于该主题当前的最大楼层号。
 * 用于导入历史数据后或计数表缺失时自愈。
 */
export async function ensureFloorCounter(topicId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO floor_counters (topic_id, last_floor)
    SELECT ${topicId}, coalesce(max(floor), 0) FROM replies WHERE topic_id = ${topicId}
    ON CONFLICT (topic_id) DO UPDATE
      SET last_floor = GREATEST(floor_counters.last_floor, EXCLUDED.last_floor)
  `);
}
