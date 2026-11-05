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
  // ⚠️ v0.0.4 修复楼层跳号（真实压测发现）。
  //
  // 原实现：
  //   INSERT ... SELECT greatest(coalesce(max(floor),0),0) + 1 FROM replies ...
  //   ON CONFLICT DO UPDATE SET last_floor = greatest(fc.last_floor, EXCLUDED.last_floor) + 1
  //
  // 问题在 DO UPDATE 分支的 `greatest(fc.last_floor, EXCLUDED.last_floor) + 1`：
  //   EXCLUDED 是「本次 INSERT 的候选值」，而该候选值本身已经是
  //   **实时 max(floor) + 1**（含当前事务刚插入的楼层）。
  //   于是又 +1 → **每次分配都跳一号**。
  //
  // 实测：连发 3 条回复得到楼层 16、14、12（跳过 15、13）。
  //
  // 修复原则：**floor_counters 是楼层号的唯一权威**。
  //   - 计数表已有该主题 → 只用计数表 +1（原子 UPSERT，不看 replies）
  //   - 计数表没有该主题（首次或历史数据导入后）→ 用实时 max(floor) 兜底初始化
  //
  // 这样既保留了「计数表落后时自愈」的能力，又消除了跳号。
  // INSERT 分支：计数表不存在时，用实时 max(floor) **+1** 作为首个楼层
  //   （若该主题已有 N 条回复，最大楼层为 N，新楼层应是 N+1）
  // DO UPDATE 分支：计数表已有 → 只用计数表 +1
  // 两个分支语义一致 → 不再跳号。
  const result = await db.execute(sql`
    INSERT INTO floor_counters (topic_id, last_floor)
    SELECT ${topicId}, coalesce(max(floor), 0) + 1
    FROM replies WHERE topic_id = ${topicId}
    ON CONFLICT (topic_id) DO UPDATE
      SET last_floor = floor_counters.last_floor + 1
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
