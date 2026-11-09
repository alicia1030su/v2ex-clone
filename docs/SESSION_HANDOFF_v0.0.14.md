# SESSION_HANDOFF — v0.0.14 收尾交接

> 目标版本：**v0.0.14**（安全收口：隐藏节点跨页面泄露、标签总量上限；链路补齐：分类管理、孤儿页入口、page 参数）
> 本文是**持续维护**的交接文档：每次推进后更新 HEAD / PR / CI / 当前测试基线 / 待办 / 授权边界。
> **候选产物绑定 SHA = `5d9413d`**（candidate-verify 源码锚点校验通过）。
> 失效判据：`git diff --name-only 5d9413d HEAD -- src deploy drizzle package.json Dockerfile scripts`
> 必须为空；非空即表示产物与源码树失配，需重建候选。当前该命令**为空**（之后仅文档提交）。
> 最后更新：2026-11-09
> 上位约束：本轮**不扩张新需求**；功能在缺陷收口后冻结。

---

## 0. 一句话状态

代码、文档、护栏与测试已在分支 `release/v0.0.14-closeout` 完成并通过门禁；**已合并、版本载体已同步、最终 SHA 上已完成复验**。
**公开发布：主人已于 2026-11-09 明确作答「1.接受 2.授权」** —— 授权正本见
`docs/RISK_DECISION_v0.0.14.md`；R-01 仍为 **DEFERRED**（接受 ≠ 修复，且**未**授权历史改写）。
v0.0.13 **从未发布**（无 Tag / Release / 镜像），其成果由 v0.0.14 一次性包含 ——
旧候选记录与产物**保持原样，不移动、不改名、不复用**。

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
| 完整单元套件（发布轮前） | 61 文件 / 813 用例 |
| 完整单元套件（发布轮后） | **62 文件 / 817 用例**（含新增的静态护栏 —— 单元配置的 include 覆盖整个 tests 目录，静态文件也在这套里跑） |
| 静态套件（发布轮前） | 20 文件 / 287 用例 |
| 静态套件（发布轮后） | **21 文件 / 291 用例** |
| 真库 `v014-node-visibility` | 6/6 |
| 真库 `categories-admin` | 22/22 |
| 真库 `tags-db` | 25/25 |
| `tag-encoding` / `page-param` | 15/15 / 24/24 |
| 完整 E2E | 263 passed / 0 failed（10.2m） |
| v014 定向 E2E | 6/6（干净端口） |

> 发布轮新增 `tests/static/v014-release-chain.spec.ts`（4 条）：把「版本载体里的版本号
> 必须在 `release.yml` 的 tag 白名单里」变成可执行断言。**已做负向对照**：删掉
> `- 'v0.0.14'` 那一行后该用例判红、退出码 1；恢复后复绿。

> ⚠️ **必须披露的一次环境态失败（不得写成「单元全绿」）**：发布轮全量跑
> `npx vitest run` 的结果是 `777 passed | 40 skipped (817)`，其中 **`tests/tags-db.spec.ts`
> 与 `tests/v005-reports.spec.ts` 两个套件的 `beforeAll` 触发 120s hook 超时**，
> 各自的 25 + 15 = **40 条被跳过**。**跳过没有算作通过。**
> 单独复跑这两个文件：**2 文件 / 40 用例全通过**（退出码 0），
> 阶段日志 `createMs=58009 / migrateMs=31741 / totalMs=89929` —— 建库 58s、迁移 32s，
> 合计 89.9s 已逼近 120s 上限，属本机 PG 处于 I/O 积压态（脚本自己也打印了
> `⚠️ 检测到 recovery / fsync 积压痕迹`）。
> **未调整任何超时或门槛**；按纪律记为「环境瞬时故障 + 已复现 + 单独复跑通过」。

---

## 4. Go/No-Go 判据（发布前必须逐项为 PASS）

| 门禁 | 判据 | 当前 |
|---|---|---|
| 代码合并 | PR #52 / #53 合并到 master，工作区 clean | ✅ 已合并（`08848c1` / `62229e8`），**最终 SHA `5d9413d`** |
| 版本载体 | `0.0.14` 在 20 个载体上一致，`sync-version --verify` 全通过 | ✅ 已同步 |
| 发行一致性 | `verify-release-consistency.sh --expect 0.0.14` = PASS 20 / FAIL 0 | ✅ |
| 静态与类型 | `tsc` 0；静态 **21 文件 / 291 用例**（发布轮新增 4 条链路护栏，含负向对照） | ✅ |
| 单元与真库 | 完整单元 60+ 文件；四个 v014 真库 spec 全绿 | ✅（`tags-db` / `v005-reports` 在全量跑时因本机 PG I/O 积压触发 hook 超时，单独复跑 40/40 通过；**未调高门槛**） |
| E2E | 本地 CI 等价复现全绿；跨浏览器 15 分片全绿 | ✅ |
| 视觉 / 安全 | 视觉回归 + Host Header 攻击矩阵 + CSRF 权限 | ✅ |
| 候选构建 + 隔离安装 | 真 Docker（ubuntu runner）28 项通过 / 0 失败 | ✅ `42629662396`（headSha `5d9413d`，源码锚点校验通过） |
| 升级与备份恢复 | v0.0.12 → 0.0.14 双基线 + 备份恢复 | ✅ PASS=20 FAIL=0（业务指纹 46 项逐字节一致；备份 73KB → 恢复指纹完全一致） |
| 授权 | 主人对 v0.0.14 的**明确风险接受 + 公开发布授权** | ✅ **已取得**（2026-11-09，「1.接受 2.授权」；见 `docs/RISK_DECISION_v0.0.14.md`） |

> **当前 Go/No-Go 结论**：**开发侧 GO（候选可构建、可安装、可升级）／公开发布 GO（已获授权）**。
> 授权后新增了一个**必须修的真实链路缺口**：`release.yml` 的 Tag 白名单原本只到 `v0.0.13`
> ⇒ 推 `v0.0.14` Tag 不会触发任何 job。已在打 Tag **之前**修复（见 `RELEASE_GATE.md` §8.2），
> 否则该版本会被不可移动的 Tag 卡死。
> 公开发布的**结果**（Release 可见性 / 资产 / Digest / 匿名拉取）由发布流水线与
> 发布后独立验收给出，回填在 `RELEASE_GATE.md` §8.3 —— 本节不预先宣称成功。

## 5. 发布执行记录（全部完成）

1. ~~PR #52 CI 全绿 → 合并到 master~~ ✅ 已合并（`08848c1`）
2. ~~同步版本载体到 `0.0.14` + README 入口口径 → PR → 合并~~ ✅ 已合并（`62229e8`）
3. ~~最终 SHA 上复验~~ ✅ `tsc` 0、发行门禁 20/0
4. ~~`candidate-verify`（真 Docker，含候选镜像 + 隔离安装）~~ ✅ run `42629662396` 28/0
5. ~~`v0.0.12 → 0.0.14` 双基线升级 + 备份恢复~~ ✅ PASS=20 FAIL=0
6. ~~回填最终 SHA 与候选证据~~ ✅
7. ~~提交发布授权请求~~ ✅ 主人已作答「1.接受 2.授权」
8. ~~补 `release.yml` 的 v0.0.14 Tag 白名单~~ ✅ 提交 `0e9f74c`（缺口见 `RELEASE_GATE.md` §8.2）
9. ~~该提交上重跑门禁 → 推送 master~~ ✅ `tsc` 0、静态 291、发行门禁 20/0；CI 全绿
10. ~~创建并推送 annotated Tag `v0.0.14`~~ ✅ → commit `6d73139`
11. ~~发布流水线~~ ⚠️ **首次失败**（run `42661344826`：`publish-release` 缺 checkout ⇒
    `ENOENT: CHANGELOG.md`；镜像已推、Release 未建）→ 修复 `765f895` → **dispatch 补救成功**
    （run `42664285905` 11/11 全绿）
12. ~~回填发布结果~~ ✅ `RELEASE_GATE.md` §8.3
13. ~~触发 `post-release-verify`~~ ✅ run `42667120882`，**8 项全 PASS**

### 5.1 发布后最终状态

| 项 | 值 |
|---|---|
| Tag | `v0.0.14` → `6d731392b17fe94852fbf966765587719c31a993`（未移动） |
| Release | id `439444090`，`draft=false`、`prerelease=true`，2026-11-09T17:37:20Z |
| 部署包 | 143,361 B，SHA256 `2faa8f87…4570`（**与候选阶段完全一致**） |
| 镜像 | `sha256:29dabe3d57977f40c47188a8d3fc5790ee21fb8f9ec03384b979a3c8731c0354`（匿名 200） |
| 独立验收 | 全新 runner、全程匿名、官方包真实安装 + 备份恢复 + 重启保数据 → 8/8 PASS |
| R-01 | **DEFERRED 不变**（本版本被明确接受，未授权历史改写） |

> ⚠️ **已披露的一处瑕疵**：v0.0.14 的线上 Release Notes 有一行状态写着
> 「待主人裁决」，与「已获授权」的事实不符（模板写死）。按「不修改已发布 Release」
> 的纪律**只披露不修改**；模板已修 + 加静态护栏，后续版本不再复现。
> 详见 `RELEASE_GATE.md` §8.5。

---

## 6. 授权边界（本轮实际执行范围）

**已获授权并执行（均已完成）**：
- 补 `release.yml` 的 `v0.0.14` Tag 白名单（**链路就绪的必要条件**，不是发布本身）
- 创建 annotated Tag `v0.0.14` 并推送（触发公开 Pre-release 发布流水线）
- 推送 GHCR 镜像标签 `:v0.0.14`（由流水线执行）
- 创建公开 Pre-release（`prerelease=true`、`--latest=false`）
- 触发发布后独立验收（`post-release-verify`，匿名视角）

**仍然禁止（授权不包含）**：
- 未改写历史、未 force push、未移动 / 删除任何旧 Tag
- 未修改已发布的 v0.0.12 Release Notes
- 未更改仓库 Public 状态、未删除任何数据
- `v0.0.13` **仍然不发布**
- R-01 仍 **DEFERRED**（81 个对象，历史仍可达）—— 接受 ≠ 修复

---

## 7. 环境坑（本机，非产品缺陷）

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

## 8. hook timeout 现状（本轮统一后的真实口径）

基线 `6212938` 本来就有 **4 处** >120s 的 `beforeAll` hook timeout：
`tags-db` / `tag-pagination`（各 300s）、`feed-search` / `v005-floor-concurrency`（各 180s）。
本轮新增的 3 处（`categories-admin` 900s、`v014-edit-noop` / `v014-node-visibility` 各 300s）
已在 `22957d2` 收回；基线中的 `tags-db` / `tag-pagination` 两处在 `4065f4f` 一并收回
（实测 27/27，最慢单文件 17s，相对 120s 有 7 倍余量）。

**仍剩 2 处 180s**：`feed-search.spec.ts:125`、`v005-floor-concurrency.spec.ts:98`。
两处都是**基线资产**、本轮未动，属下一轮「全仓 hook timeout 审计」的一项，**不在本轮冻结范围**。
本轮已实测两处的真实 provision（本机正常态）：

```
feed-search             drop=248  create=3956  migrate=8352  total=12556
v005-floor-concurrency  drop=91   create=6276  migrate=8627  total=14994
（2 文件 / 18 用例全绿，46s；最慢 15~16s，相对 120s 有 7.5 倍余量）
```

两处 `beforeAll` 都只有「建库 + migrate + 3~4 条单行 insert」，**没有批量造数、没有并发准备**
（`v005-floor-concurrency` 的 100 并发在 `it` 内）⇒ 180s 与已收回的 300s 同属无依据放宽。
收的时候注意：`v005-floor-concurrency` 的**测试体**上也有 `120_000` / `60_000` 的显式超时，
与 hook 是同一个病（无依据放宽），下一轮一并审计；`feed-search` 无 per-test 覆盖，可直接收回默认。


> **本节上限 / 耗时数字的有效前提**：① vitest 5.x（`file` duration 含 `beforeAll`）；
> ② `fileParallelism: false`；③ 未配 `bail` / `retry` / `repeat`；
> ④ 该文件 `beforeAll` 仅做「建库 + migrate + **常数规模**的 insert / 准备代码」；判据是**规模与数据量参数无关**（O(1)）：对刚插入的常数行做 `for…of` / `.map()` / `new Map()` 建查找表**不算违规**，只有当循环上界来自变量 / 环境变量 / 夹具时才违反。扫描必须按 `beforeAll` 块边界（`floor-continuity` 的 `Array.from` 在 `it` 里，不计入 hook）；
> ⑤ 该文件无 `beforeEach` / `afterEach`。
> **任一条件变化需重算**：升级 vitest 后 `runSuite` 若重构，`file` 是否仍含 hook 必须重测；
> 若给 `beforeAll` 加入批量造数，其合理耗时会上一量级，`hookTimeout` 与 `testTimeout` 都需重新评估。
> 判据是「**规模是否与数据量相关**」，不是「语句数」「每条语句几行」或「有没有循环」——
> `v005` 的 users 是一条语句插 2 行（语句数少但行数多，仍 O(1)）；
> `content-lifecycle` 的 `for (const row of inserted)` 遍历的是刚插入的常数行（有循环但 O(1)）。

## 9. 已知取舍（登记于 `RISK_REGISTER.md`）

- ~~纯标签编辑会 `editCount + 1` 并写空 `edit_history` 快照~~ —— **已修**：`editTopic()` 空改动提前返回（`tests/v014-edit-noop.spec.ts` **9 条**真库覆盖：不计数 / 不留快照 / 不改 editedAt/updatedAt / 未授权 403 / 超时限 403 / 已删除 404 / 真改动仍计数 / 传了标题≠改了标题）
- 移除标签不删 `tags` 本体 ⇒ `/tag/{name}` 在无关联后仍 200 空列表（有意语义）
- `/notifications` 与 `/reports`（用户私有视图）仍展示用户自己相关的隐藏节点标题 —— 未改，语义待单独定义
