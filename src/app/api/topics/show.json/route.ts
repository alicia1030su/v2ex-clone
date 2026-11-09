import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { and, eq, sql } from 'drizzle-orm';
import { resolveBaseUrl } from '@/lib/feed-builder';
import { loadLegacyTopics } from '@/server/legacy-topics';
import { PUBLIC_NODE_CONDITION } from '@/server/legacy-assemblers';
import { parseLegacyId } from '@/lib/legacy-topic-api';
import {
  LEGACY_LIST_LIMIT,
  guardLegacyRateLimit,
  legacyJsonHeaders,
  legacyNotFoundResponse,
  legacyRateLimited,
} from '@/lib/legacy-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics/show.json —— **V2EX 旧版公开 JSON API 兼容端点**
 *
 * ## 为什么有这个端点
 *
 * `docs/PAGE_INVENTORY.md` §2.4 记录了原站「其他可发现端点」：
 * `/api/topics/show.json?id=1` 是**旧版 API 中唯一仍返回 200 的 JSON 端点**
 * （`/api/topics.json` 与 `/api/nodes.json` 均已下线 404）。
 *
 * 本项目此前把它实现为 404 —— 任何按 V2EX 旧版 API 写好的第三方客户端 /
 * 脚本接到本站后会直接失败。这是一个**真实的兼容性缺口**。
 *
 * ## 契约来源（全部实测，不是猜的）
 *
 * 2026-11-08 通过本机 xray 代理抓取原站，逐条记录在
 * `src/lib/legacy-topic-api.ts` 顶部的契约表里。要点：
 *
 *  | 请求 | 行为 |
 *  |---|---|
 *  | `?id=1` | 200，`[topic]`（长度 1） |
 *  | `?id=999999999` | **200**，`[]` |
 *  | `?id=0` / `?id=abc` | **404**，`{status:"error",message:"Object Not Found",rate_limit}` |
 *  | `?id=1&id=2&id=3` | 200，只返回 **3**（同名参数取最后一个） |
 *  | `?username=<存在>` | 200，10 条，`created` 降序 |
 *  | `?username=<不存在>` | 404，同上错误体 |
 *  | `?node_name=<存在>` | 200，10 条，`created` 降序 |
 *  | `?node_name=<不存在>` | 404，同上错误体 |
 *  | 无参数 | 404，同上错误体 |
 *  | `?id=…&node_name=…` / `?username=…&node_name=…` | 优先级 **id > username > node_name** |
 *  | `?limit=` | **被忽略**（固定 10 条） |
 *
 * 响应头：`Content-Type: application/json;charset=UTF-8`、
 * `Cache-Control: public, max-age=120`、`x-rate-limit-limit/remaining/reset`。
 *
 * ## 与原站的差异（不掩盖）
 *
 * 见 `src/lib/legacy-topic-api.ts` 顶部「本项目的映射取舍」六条：
 * `pro` 恒 0、`twitter/github/psn/btc` 恒 null、`node.header/footer/aliases` 空值、
 * 头像为确定性占位 data URI、软删除主题对公众不可见（`?id=` 命中返回 `[]`）。
 *
 * ## 安全
 *
 * - 只读、只暴露**已发布**主题（软删除一律不可见）
 * - 与原站同口径限流（600 次/小时/IP），并回写 `x-rate-limit-*` 头
 * - 所有 SQL 走 drizzle 参数化查询，无字符串拼接
 */
export async function GET(request: Request) {
  const rl = await guardLegacyRateLimit('topics-show');
  if (!rl.ok) return legacyRateLimited(rl);

  const url = new URL(request.url);
  const origin = resolveBaseUrl(request.url);

  const idValues = url.searchParams.getAll('id');
  const username = url.searchParams.get('username');
  const nodeName = url.searchParams.get('node_name');

  // ── 优先级：id > username > node_name（实测确认）──
  if (idValues.length > 0) {
    const id = parseLegacyId(idValues);
    // `?id=abc` / `?id=0` ⇒ 404（实测），与「合法 id 但不存在 ⇒ 200 []」不同
    if (id === null) return legacyNotFoundResponse(rl, 120);
    const topics = await loadLegacyTopics({ filter: { kind: 'id', id }, limit: 1, origin });
    // 合法 id 但不存在（或已软删除）⇒ 200 []
    return new Response(JSON.stringify(topics), {
      status: 200,
      headers: legacyJsonHeaders(rl, 120),
    });
  }

  if (username) {
    // 用户不存在 ⇒ 404（实测）
    const lower = username.toLowerCase();
    const exists = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = ${lower}`)
      .limit(1);
    if (exists.length === 0) return legacyNotFoundResponse(rl, 120);
    const topics = await loadLegacyTopics({
      filter: { kind: 'username', username },
      limit: LEGACY_LIST_LIMIT,
      origin,
    });
    return new Response(JSON.stringify(topics), {
      status: 200,
      headers: legacyJsonHeaders(rl, 120),
    });
  }

  if (nodeName) {
    const lower = nodeName.toLowerCase();
    const exists = await db
      .select({ id: schema.nodes.id })
      .from(schema.nodes)
      .where(and(PUBLIC_NODE_CONDITION, eq(schema.nodes.name, lower)))
      .limit(1);
    if (exists.length === 0) return legacyNotFoundResponse(rl, 120);
    const topics = await loadLegacyTopics({
      filter: { kind: 'node', nodeName },
      limit: LEGACY_LIST_LIMIT,
      origin,
    });
    return new Response(JSON.stringify(topics), {
      status: 200,
      headers: legacyJsonHeaders(rl, 120),
    });
  }

  // 无参数 ⇒ 404（实测）
  return legacyNotFoundResponse(rl, 120);
}
