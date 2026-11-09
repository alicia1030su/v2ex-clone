import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

/**
 * 节点可见性的**唯一**判据（v0.0.13 / V13-12 收尾）
 *
 * ## 为什么单独放一个纯模块
 *
 * 这个条件有两个互不相容的消费场景：
 *
 *   · **旧版 / Feed 公共端点**（`src/server/legacy-*.ts`、`src/app/api/topics/*`、
 *     `src/app/api/nodes/*`）—— 它们已经从 `src/server/legacy-assemblers.ts`
 *     拿到 `PUBLIC_NODE_CONDITION`，但那个模块 `import 'server-only'` 且
 *     会 `import '@/db'`（建连接池 + 读 env）；
 *   · **站内 Feed 构建器**（`src/lib/feed-builder.ts`）—— 它刻意**注入** `db`
 *     （`buildFeedEntries(db, ...)`），好让 `tests/feed-search.spec.ts` 指向
 *     专用测试库。若为了拿一个 where 条件去 import `legacy-assemblers`，
 *     就会连带 import `@/db`，在纯单元测试里凭空建一个连到开发库的连接池 ——
 *     这正是该模块当初把 db 做成参数要避免的。
 *
 * 所以条件本体放在这里（只依赖 `drizzle-orm` 与 schema，**无副作用**），
 * `legacy-assemblers.ts` 再 re-export 给旧版端点用；`feed-builder.ts` 直接引用。
 * 全仓**只有这一处**定义 `eq(schema.nodes.status, 'active')`，
 * 由 `tests/static/v013-legacy-privacy.spec.ts` 逐文件钉死，防止口径漂移。
 *
 * ## 口径
 *
 * `pending` / `hidden` 节点下的内容不进入任何**公共**载荷：
 * 目录端点不列出、`?node_name=` 走 404、按 id 查主题返回 `[]`、
 * 节点 Feed 走 404、全站 Feed（旧版 `/feed/all.xml` 与站内 `/api/feed*`）不含其主题。
 *
 * 原站对非 active 节点的旧版 API 行为**无法验证**，本项目不宣称完全兼容；
 * 这是**有意策略**，登记在 `docs/API_SPEC.md` §14.6 与
 * `docs/LEGACY_API_MATRIX_v0.0.13.md` §3「有意偏离清单」。
 */
export const PUBLIC_NODE_CONDITION = eq(schema.nodes.status, 'active');
