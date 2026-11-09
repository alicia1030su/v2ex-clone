# SESSION_HANDOFF — v0.0.14 收尾交接

> 目标版本：**v0.0.14**（安全收口：隐藏节点跨页面泄露、标签总量上限；链路补齐：分类管理、孤儿页入口、page 参数）
> 本文是**持续维护**的交接文档：每次推进后更新 HEAD / PR / CI / 当前测试基线 / 待办 / 授权边界。
> 最后更新：2026-11-09
> 上位约束：本轮**不扩张新需求**；功能在缺陷收口后冻结。

---

## 0. 一句话状态

代码、文档、护栏与测试已在分支 `release/v0.0.14-closeout` 完成并通过门禁，**待合并 + 版本载体同步 + 最终 SHA 复验**。
**公开发布为 NO-GO**：未找到主人对 v0.0.14 的明确风险接受与公开发布授权，R-01 仍为 DEFERRED。
v0.0.13 **从未发布**（无 Tag / Release / 镜像），其成果将由 v0.0.14 一次性包含 —— 旧候选记录与产物**保持原样，不移动、不改名、不复用**。

---

## 1. 接管基线

| 项 | 值 |
|---|---|
| 接管时 `origin/master` HEAD | `6212938fdbeb2a98b99a29990950f8d9dd353b50` — `Merge pull request #51 from alicia1030su/fix/v0014-tag-pagination` |
| 接管时工作区 | `working tree clean`，无 stash |
| 本轮分支 | `release/v0.0.14-closeout`（从 `origin/master` 新建） |
| 功能提交 | `d7b50bb`（P0-1 + P0-2 + 分类管理 + page 参数，52 文件 / +5030 −221） |
| 测试修正提交 | `9aef8bb`（E2E 区分 staff 审核视角与公众视角） |
| 文档同步提交 | `e518d30`（CHANGELOG / FEATURE_MATRIX / RISK_REGISTER） |
| 移除链路 E2E | `e2701e3`（点 × → 保存 → 消失 + 保留项 + 标签页语义 + 可加回） |
| PR | **#52** `release/v0.0.14-closeout → master` |
| 最新已发布版本 | **v0.0.12**（GitHub Pre-release，含部署 ZIP 与 GHCR 镜像） |
| v0.0.13 Tag / Release / GHCR | **均不存在**（已核查） |
| 版本载体（dev 态） | `0.0.13` —— 按 G-VER-01，**最终 SHA 固定前不同步**；合并后在独立分支统一同步到 `0.0.14` |

---

## 2. 本轮改动清单

### P0-1 隐藏节点跨页面泄露

- 收敛层：`src/server/queries.ts`（8 个查询 + 新增 `listTopicsByTag`）、
  `src/lib/content-service.ts`（`getTopicDetail` join 取 nodeStatus）
- 14 个直接持 SQL 的文件：首页 / `/hot` / `/recent` / `/go/[name]` / `/go/search` /
  `/tag/[name]` / `/t/[id]` / `/xna` / `/following` / `/bookmarks` / `/member/[username]` /
  `/api/search` / `/api/search/suggest` / `/api/users/follows/topics` /
  `/api/collections` / `/api/replies` / `/api/topics`（POST 校验）/ `HotNodes`
- 唯一例外：`getTopicById(id, { includeHiddenNode })` 与
  `listReplies(..., { includeHiddenNode })`，由 `canReviewHiddenNodes(user)` 显式传入
- 真库三态：`tests/v014-node-visibility.spec.ts`（6 条）
- 静态护栏：`tests/static/v014-node-visibility.spec.ts`
- E2E：`e2e/v014-node-visibility.spec.ts`（staff 审核 200 + 登出后公众 404）

### P0-2 标签总量上限与移除

- `src/server/tags.ts`：事务内 `FOR UPDATE` 锁主题行、剩余额度写入、插入按名排序防死锁；
  `detachTags()` 只删关联不删本体
- `PUT /api/topics/[id]`：新增 `removeTags`；**鉴权先于写标签**（修 403 请求改标签的漏洞）
- `TopicEditForm` / `TopicActions`：标签 chips 可移除、可撤销、可追加
- 真库：`tests/tags-db.spec.ts` 25 条（含真 `Promise.all` 并发总量 ≤ 5）
- E2E：`e2e/v014-tags.spec.ts` 5 条（含点 × 移除全链路）

### 链路补齐

- `/hot` `/recent`：入口收敛到 `src/lib/nav-links.ts` 的 `CONTENT_LINKS`
- 分类管理：迁移 `0004_v014_categories.sql`、`src/server/categories.ts`、
  两个 admin 路由、四个审计 action、后台「分类」tab
- `page` 参数：`src/lib/page-param.ts` + 10 个公共列表页接入

---

## 3. 当前测试基线（本机实测）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 |
| 完整单元套件 | 60 文件 / 802 用例 |
| 静态套件 | 20 文件 / 285 用例 |
| 真库 `v014-node-visibility` | 6/6 |
| 真库 `categories-admin` | 22/22 |
| 真库 `tags-db` | 25/25 |
| `tag-encoding` / `page-param` | 15/15 / 24/24 |
| 完整 E2E | 263 passed / 0 failed（10.2m） |
| v014 定向 E2E | 6/6（干净端口） |

---

## 4. 待办（按顺序）

1. PR #52 CI 全绿 → 合并到 master
2. 独立分支同步版本载体到 `0.0.14`（`sync-version.mjs`）+ README 入口口径 → PR → 合并
3. 最终 SHA 上复验：`tsc` / 静态 / 版本载体 / 发行门禁 / 候选 ZIP 双次构建同哈希
4. 最终 SHA 上触发 `candidate-verify`（真 Docker，含候选镜像 + 隔离安装）
5. `v0.0.12 → 0.0.14` 双基线原地升级 + 备份恢复（本机 PG）
6. 回填 `RELEASE_GATE.md` / 本文档的最终 SHA 与候选证据
7. 集中提交一次发布授权请求（风险接受 + 公开发布授权）

---

## 5. 授权边界（未越界）

- 未创建 `v0.0.14` Tag / Release / Draft
- 未推送任何 GHCR 镜像；匿名核验 `:v0.0.13` = 404
- 未改写历史、未 force push、未移动 / 删除任何旧 Tag
- 未修改已发布的 v0.0.12 Release Notes
- R-01 仍 **DEFERRED**（81 个对象，历史仍可达）

---

## 6. 环境坑（本机，非产品缺陷）

- **并行会话共用 `55440` / `3010` 会互相干扰**：实测出现过
  `CREATE DATABASE` 被另一库的 migrate 阻塞（2m53s~4m54s，正常 2.0~2.3s）、
  `3D000 database does not exist`（他人并发删同名库）、以及 `.next` 被并发
  `next build` 替换导致的水合超时。收尾轮**不改** `scripts/ci/run-e2e-locally.sh`
  （CI 基础设施，改动需重验全部 E2E 入口）；后续版本可考虑给脚本加
  `DB_NAME` / `APP_PORT` 的并行唯一化默认值。
- **静态套件的瞬时 worker 超时（本轮复现两次）**：`Failed to start forks worker ...
  Timeout waiting for worker to respond` —— 整次运行只跑到 19/20 文件、耗时 60s
  （正常 ~12s）。同一命令紧接着复跑即 20 文件 / 287 用例全绿。判定为本机并发
  （同时有 E2E 服务、`next build`、另一会话的 PG 操作）导致的资源竞争，
  **未调整任何超时/门槛**；按纪律记为「环境瞬时故障 + 已复现必须披露」。
- **扫描类结论必须打印分母（本轮两次因此得出假事实）**：用
  `grep "}, [0-9]\{4,\});"` 统计 hook timeout 时字符集漏了下划线 ⇒ 静默少报
  `180_000`；用 `glob.glob`（Windows 反斜杠）与 `git ls-tree`（正斜杠）做
  `in` 比较 ⇒ 基线侧全部判定为「不存在」，扫出「基线 0 处放宽」的假结论。
  两者外观都与「确实是 0」完全相同。以后凡「全仓无 X」的结论，先报分母。
- **提交前必须 `git diff --cached` 逐文件核对**：本轮发生过一次真实提交事故 —— 工程师做负向
  对照时留在工作区的 `[NEG] 只点不保存` 版本被一并提交，导致 v014 移除用例
  在 CI 必红并拖红 9 个跨浏览器分片。已由 `cc6843c` 修正。这也是本轮**唯一造成过真实红灯**的流程问题（其余红灯都是环境态或测试自身断言选错观察点）。

## 7. hook timeout 现状（本轮统一后的真实口径）

基线 `6212938` 本来就有 **4 处** >120s 的 `beforeAll` hook timeout：
`tags-db` / `tag-pagination`（各 300s）、`feed-search` / `v005-floor-concurrency`（各 180s）。
本轮新增的 3 处（`categories-admin` 900s、`v014-edit-noop` / `v014-node-visibility` 各 300s）
已在 `22957d2` 收回；基线中的 `tags-db` / `tag-pagination` 两处在 `4065f4f` 一并收回
（实测 27/27，最慢单文件 17s，相对 120s 有 7 倍余量）。

**仍剩 2 处 180s**：`feed-search.spec.ts:125`、`v005-floor-concurrency.spec.ts:98`。
两处都是**基线资产**、本轮未动；要不要收需要先实测各自 `[db-phase]` 的真实
`createMs + migrateMs`，属下一轮「全仓 hook timeout 审计」的一项，**不在本轮冻结范围**。
注意 `v005-floor-concurrency` 的 `beforeAll` 含并发楼层种子准备，可能确实比别的 spec 慢。

## 8. 已知取舍（登记于 `RISK_REGISTER.md`）

- ~~纯标签编辑会 `editCount + 1` 并写空 `edit_history` 快照~~ —— **已修**：`editTopic()` 空改动提前返回（`tests/v014-edit-noop.spec.ts` 8 条真库覆盖）
- 移除标签不删 `tags` 本体 ⇒ `/tag/{name}` 在无关联后仍 200 空列表（有意语义）
- `/notifications` 与 `/reports`（用户私有视图）仍展示用户自己相关的隐藏节点标题 —— 未改，语义待单独定义
