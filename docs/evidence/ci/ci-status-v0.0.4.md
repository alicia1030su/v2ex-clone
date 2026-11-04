# 远端状态核查证据 —— v0.0.4

> **取证人**：严过关（Yan）· QA 工程师
> **取证时间**：2026-11-04T12:38Z（本地 2026-11-04 20:38 +0800）
> **取证工具**：`gh` CLI 2.103.3（已登录 `alicia1030su`，scopes: gist / read:org / repo / workflow）
> **取证对象**：`https://github.com/alicia1030su/v2ex-clone`（Public）
> **本地基线**：`feat/v0.0.4-high-fidelity` @ `097c1b9`

---

## 0. 一句话结论

> **远端的一切都还是 v0.0.3 的状态；本轮 v0.0.4 的 9 个提交从未离开过本机。**
> 远端最后一次绿色 CI 跑的是 `master @ 37710fb4`（= v0.0.3 的代码基线），
> **不包含** v0.0.4 的任何一行改动。因此：
> **「CI 已验证 v0.0.4」这句话目前是错的**，远端没有任何一条 run 能作为 v0.0.4 的证据。

---

## 1. 仓库基本状态

| 项 | 实测值 | 判定 |
|---|---|---|
| 仓库名 | `v2ex-clone` | — |
| 可见性 | `PUBLIC`（`isPrivate: false`, `visibility: "PUBLIC"`） | ✅ 符合「必须保持 Public」 |
| 默认分支 | `master` | — |
| 创建时间 | `2026-11-03T03:35:45Z` | — |
| 最近一次 push（到远端） | `2026-11-04T02:25:41Z` | ✅ 本轮改动之后**无任何 push** |
| master 分支保护 | **未设置**（`GET /branches/master/protection` → `404 Branch not protected`） | ⚠️ 见 §7 |
| GHCR 包可见性 | **无法核实** —— 当前 token 缺 `read:packages` scope，`GET /users/alicia1030su/packages` → `403` | 🔴 见 §7 |

**可见性未被破坏**：本轮全程未调用任何修改可见性的接口，仓库仍为 Public。

---

## 2. 分支与推送状态（**关键阻断点**）

```
$ git rev-list --count origin/master..HEAD
9                      ← 领先 9 个提交（任务说明时为 8 个，架构师期间新增 1 个交接文档提交）

$ git log --oneline origin/master..HEAD
097c1b9 docs(v0.0.4): 建立跨会话交接文件 —— 记录真实 Git 状态、PG 三问题根因与 UI 缺口现状
301a8a5 docs(v0.0.4): 最终 E2E 153/153 全绿证据 + R-23 修复后的口径同步
0824c6a fix(e2e): 修复关注用例静默跳过（R-23）+ 全量回归证据与口径闭环
1b15f79 docs(v0.0.4): 验收证据闭环、文档纠错、发布门禁双模式与最终交付方案
89d6b4e perf(fix): v0.0.4 真实压测发现并修复 3 个真实缺陷 + 3 项性能优化
f57552e feat(visual): v0.0.4 视觉对照矩阵完成（4 视口 × 17 页面）+ 差异量化报告
314aa53 feat(visual,release): v0.0.4 视觉对照矩阵扩展 + GHCR Bearer 协议实测 + 历史清理隔离演练
04b107b fix(e2e,api): v0.0.4 —— 修复 4 个真实缺陷 + 新增 77 条真实浏览器 E2E
37eba3c docs: v0.0.4 第一阶段 —— 功能真实性独立审计
```

远端现有分支（`git ls-remote --heads origin`）：

| 远端分支 | SHA | 备注 |
|---|---|---|
| `master` | `37710fb4` | v0.0.3 的代码基线 |
| `feat/v0.0.3-complete` | `b30245bd` | 已合并 |
| `feature/v0.0.2-hardening` | `37443cea` | 已合并 |
| `fix/p0-review-hardening` | `ab2aa042` | 已合并 |

**`feat/v0.0.4-high-fidelity` 在远端不存在。**

### 2.1 为什么我没有触发 `workflow_dispatch`

`ci.yml` 有 `workflow_dispatch` 触发器，本可对已存在的远端分支触发。但：

1. **对 `master` 触发毫无意义** —— `master` 上是 v0.0.3 的代码，CI 再跑一遍不会验证 v0.0.4 的任何一行改动，
   产出的绿灯是**误导性证据**（会让人误以为 v0.0.4 已过 CI）。
2. **对 `feat/v0.0.4-high-fidelity` 触发需要该分支先在远端** —— 而推送权限不在我手上。

> **因此我没有触发任何 run。** 触发一次「明知覆盖不到目标改动」的 run，只会污染
> Actions 历史并制造假绿灯。这比不跑更糟。
> 详见 §7 的推进动作。

---

## 3. PR 状态

`gh pr list --state all` —— **4 个 PR，全部 MERGED，无 OPEN、无 Draft PR**：

| # | 标题 | 分支 → 目标 | 状态 | 创建时间 | URL |
|---|---|---|---|---|---|
| 4 | fix(release): Release 默认保持 Draft，不自动转为正式发布 | `feat/v0.0.3-complete` → master | MERGED | 2026-11-04T01:21:22Z | https://github.com/alicia1030su/v2ex-clone/pull/4 |
| 3 | feat: v0.0.3 完整功能版本 —— 主题/回复生命周期、账户系统、积分体系、后台管理、Feed 与响应式 | `feat/v0.0.3-complete` → master | MERGED | 2026-11-04T01:03:22Z | https://github.com/alicia1030su/v2ex-clone/pull/3 |
| 2 | feat: v0.0.2 全项目缺陷清零、安全加固与发布流水线修复 | `feature/v0.0.2-hardening` → master | MERGED | 2026-11-03T16:28:42Z | https://github.com/alicia1030su/v2ex-clone/pull/2 |
| 1 | fix: P0/P1 复审修复 —— seed 只初始化、容器三阶段、端口收紧、CI 与开源条件 | `fix/p0-review-hardening` → master | MERGED | 2026-11-03T08:42:20Z | https://github.com/alicia1030su/v2ex-clone/pull/1 |

**本轮 v0.0.4 没有开 PR**（分支尚未推送，PR 无从谈起）。

---

## 4. Tag 与 Release 状态

### 4.1 Tag（`gh api repos/.../tags`）

| Tag | 指向 commit | 判定 |
|---|---|---|
| `v0.0.3` | `9af3b893` | ✅ 存在，保持不动 |
| `v0.0.2` | `4488e7fe` | ✅ 存在，保持不动 |
| `v0.0.1` | `94cc132a` | ✅ 存在，保持不动 |

**没有 `v0.0.4` Tag** —— 符合预期（v0.0.4 处于开发态，Tag 应在最终 SHA 固定后一次性创建）。
本轮我**未创建、未删除、未移动任何 Tag**。

### 4.2 Release（`gh api repos/.../releases`）

| Tag | draft | prerelease | published_at | 资产数 | URL |
|---|---|---|---|---|---|
| `v0.0.3` | **true** | true | `null` | 2 | https://github.com/alicia1030su/v2ex-clone/releases/tag/untagged-d072936ca46134f68478 |
| `v0.0.2` | false | true | 2026-11-03T18:05:48Z | 2 | https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.2 |
| `v0.0.1` | false | true | 2026-11-03T15:43:26Z | 2 | https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1 |

**v0.0.3 的 Draft Release 完好无损**（`draft=true`, `published_at=null`），
符合「不得破坏 Draft」的硬性约束。本轮我**未创建、未修改、未发布、未删除任何 Release**。

> 注：Draft Release 的 URL 是 `.../releases/tag/untagged-<id>` 形式（GitHub 对未发布 Release 的
> 固有行为），这是**正常的**，不是异常。

---

## 5. Workflow 与 CI Run 历史

### 5.1 已启用的 workflow（`gh workflow list`）

| Workflow | 状态 | ID |
|---|---|---|
| CI | active | 405468983 |
| 安装验证 | active | 405944466 |
| Release | active | 405820793 |

> **本轮新增的 `Docker/Redis 隔离验证`（`.github/workflows/docker-verify.yml`）尚未出现在此列表**——
> 因为它还未被推送，GitHub 从未见过这个文件。推送后它会自动注册。

### 5.2 最近 25 条 run（全仓库）

```
41760677505  CI         master                37710fb4  success  push        2026-11-04T02:25:43Z
41759712235  Release     v0.0.3                9af3b893  success  push        2026-11-04T02:17:01Z
41759671866  CI         master                9af3b893  success  push        2026-11-04T02:16:39Z
41758734582  Release     v0.0.3                b963ee04  failure  push        2026-11-04T02:08:14Z
41758700318  CI         master                b963ee04  success  push        2026-11-04T02:07:55Z
41757442592  Release     v0.0.3                045043cd  failure  push        2026-11-04T01:56:37Z
41757383352  CI         master                045043cd  success  push        2026-11-04T01:56:04Z
41757295150  CI         master                da4307f0  cancelled push       2026-11-04T01:55:15Z
41757294938  安装验证    master                da4307f0  success  push        2026-11-04T01:55:14Z
41757293337  Release     master                da4307f0  failure  push        2026-11-04T01:55:14Z
41754998422  CI         feat/v0.0.3-complete   b30245bd  success  pull_request 2026-11-04T01:34:40Z
41754998415  安装验证    feat/v0.0.3-complete   b30245bd  success  pull_request 2026-11-04T01:34:40Z
41754993469  CI         feat/v0.0.3-complete   b30245bd  success  push        2026-11-04T01:34:37Z
41754993450  安装验证    feat/v0.0.3-complete   b30245bd  success  push        2026-11-04T01:34:38Z
41754992002  Release     feat/v0.0.3-complete   b30245bd  failure  push        2026-11-04T01:34:37Z
41753899574  CI         feat/v0.0.3-complete   f5902bed  failure  pull_request 2026-11-04T01:24:59Z
41753899400  安装验证    feat/v0.0.3-complete   f5902bed  success  pull_request 2026-11-04T01:24:59Z
41753894461  CI         feat/v0.0.3-complete   f5902bed  failure  push        2026-11-04T01:24:57Z
41753892436  Release     feat/v0.0.3-complete   f5902bed  failure  push        2026-11-04T01:24:56Z
41753630404  CI         feat/v0.0.3-complete   b95d3070  cancelled pull_request 2026-11-04T01:22:40Z
...
```

**观察**：
- 最近一次 CI（`41760677505`，master @ `37710fb4`）**三个 job 全绿**。
- `Release` 工作流近期频繁 `failure` —— 这是**预期的**：release.yml 的 tag 白名单只有
  `v0.0.2` / `v0.0.3`，推 `v0.0.3` tag 时流水线在早期 job 失败（后续被修复，见提交
  `9af3b89`「改用列表接口读取 Release —— 按 tag 查询不返回 draft」）。
- **没有任何一条 run 的 head SHA 落在 v0.0.4 的 9 个提交里。**

### 5.3 最后一次绿色 CI 的完整 job 明细（run `41760677505`）

Run URL: https://github.com/alicia1030su/v2ex-clone/actions/runs/41760677505

| Job | 结论 | 开始 | 结束 | 耗时 | URL |
|---|---|---|---|---|---|
| 类型检查 / 单元测试 | **success** | 02:25:46Z | 02:26:51Z | ~65s | [job/126347381331](https://github.com/alicia1030su/v2ex-clone/actions/runs/41760677505/job/126347381331) |
| E2E 测试 | **success** | 02:26:54Z | 02:29:58Z | ~184s | [job/126347779425](https://github.com/alicia1030su/v2ex-clone/actions/runs/41760677505/job/126347779425) |
| Docker 构建与启动验证 | **success** | 02:25:46Z | 02:28:25Z | ~159s | [job/126347380941](https://github.com/alicia1030su/v2ex-clone/actions/runs/41760677505/job/126347380941) |

**该 run 的日志实测输出（从 `gh run view --log` 下载后解析）：**

```
Test Files  14 passed (14)
     Tests  185 passed (185)
  Duration  17.68s (tests 85%, import 13%, transform 1%)

E2E: 67 passed (1.0m)
```

> ⚠️ **这条 run 的 185 / 67 是 v0.0.3 的数字，不是 v0.0.4 的。**
> 详见 `test-baseline-v0.0.4.md` §2「185 vs 190 争议的裁决」。

---

## 6. `release.yml` 的 tag 白名单（R-19）

`.github/workflows/release.yml` 第 42–58 行：

```yaml
on:
  push:
    tags:
      # ⚠️ 每次发版都必须手动把新版本号加到这里 —— 这是**刻意的摩擦**，
      #    让「新增 tag = 新发布」这件事必须经过人的确认。
      - 'v0.0.2'
      - 'v0.0.3'
```

**白名单不含 `v0.0.4`** —— 这是**刻意保留的人工摩擦**，按主理人指令**未做任何修改**。

### 6.1 风险量化（实测，不是推测）

如果主理人直接 `git push origin v0.0.4` 而**没有**先把 `'v0.0.4'` 加入白名单：

- GitHub Actions 对 `push` + `tags` 触发器采用**精确匹配**。
  未列入白名单的 tag **不会触发任何 job** —— 不会红灯，而是**静默地什么都不跑**。
- 后果：`v0.0.4` tag 会**存在于远端**，但**没有镜像、没有 Release、没有构建产物**。
- 这是一个**静默失败**（silent failure）：CI 页面全绿（因为压根没有 run），
  极易被误判为「发布成功了」。

### 6.2 处置建议

**在推 tag 之前**，人工把 `- 'v0.0.4'` 加进 `release.yml` 的 tags 白名单，
并作为**独立的一次提交**（这样 diff 清晰可见，便于评审确认这一行确实被加了）。

`scripts/release/preflight.sh --phase=release` 会把这一项判为 **FAIL**（阻断发布），
其检查逻辑（脚本第 180–186 行）：

```bash
if grep -qE "^\s*-\s*'${VTAG}'" .github/workflows/release.yml 2>/dev/null; then
  ok "release.yml 的 push tag 白名单已包含 ${VTAG}"
elif [ "$PHASE" = 'release' ]; then
  fail "release.yml 的 push tag 白名单**未包含** ${VTAG}（当前仅 v0.0.2 / v0.0.3）—— 发布时必须人工加入，否则推 tag 不触发任何 job"
```

✅ **preflight 已经覆盖了这一项**，且在 dev 阶段只报 `[INFO]` 不判 FAIL，
与「刻意摩擦」的设计一致。**无需额外代码改动。**

---

## 7. 本轮**无法实跑**的项与推进动作

| # | 项目 | 为何无法实跑 | 主理人推进动作 |
|---|---|---|---|
| **A** | v0.0.4 的 CI 实跑 | 9 个提交未推送 → 无 push/PR 触发；`workflow_dispatch` 对 `master` 触发覆盖不到目标改动（假绿灯） | 推送 `feat/v0.0.4-high-fidelity`（PR 方式或直接 push）→ Actions 自动触发 → 按 §8 清单逐条核对 |
| **B** | `docker-verify.yml` 的实跑 | 同 A（本机无 Docker + 未推送） | 推送后该工作流自动跑；或 `gh workflow run docker-verify.yml --ref feat/v0.0.4-high-fidelity` |
| **C** | GHCR 包可见性 | 当前 gh token 缺 `read:packages` scope，`GET /users/alicia1030su/packages` → 403 | 主理人用有该 scope 的 token 核验，或直接浏览器访问 https://github.com/users/alicia1030su/packages |
| **D** | `master` 分支保护 | 未设置（404）。这是**现状**，不是我造成的 | 若要加保护规则需主人授权；本轮**未改动**任何保护设置 |

---

## 8. 主理人推送后**必须逐条核对**的清单

> 这份清单是为「推送后 CI 跑完」准备的验收标准。**每一条都必须能在 Actions 日志里找到实证**，
> 不能只看绿灯图标。

### 8.1 CI（workflow `CI`，run id 见推送后新建的 run）

- [ ] **C1** run 的 `head SHA` == 推送后的最终 SHA（不是 master 的 `37710fb4`）
- [ ] **C2** job `类型检查 / 单元测试` = success，且日志里 `Test Files 15 passed (15)` / `Tests 190 passed (190)`
      —— 15 文件 / 190 条（依据见 `test-baseline-v0.0.4.md`）
- [ ] **C3** job `E2E 测试` = success，且日志里 `153 passed`，**且 0 skipped**
      —— 重点核对 **0 skipped**（R-23 的修复就是针对「静默跳过」）
- [ ] **C4** job `Docker 构建与启动验证` = success
- [ ] **C5** `npx tsc --noEmit` 无输出即通过（`node scripts/ui-verify.cjs` 也必须无失败）
- [ ] **C6** 单元测试与 E2E 的**限流阈值未被调高**
      （日志/环境里 `RATE_LIMIT_LOGIN_MAX` 必须仍为 10，否则 E2E 的两条限流用例会永远等不到 429）

### 8.2 Docker/Redis 隔离验证（workflow `Docker/Redis 隔离验证`，本轮新增）

- [ ] **D1** job `R-16/R-17 九项验证` = success
- [ ] **D2** 逐项找到 9 个断言步骤的输出（步骤名带 `[1/9]`…`[9/9]`）
- [ ] **D3** `[9/9]` 步骤确认：容器内 `id -u` **非 0**
- [ ] **D4** `[9/9]` 步骤确认：镜像内**不含** `playwright` / `vitest` / `typescript`
- [ ] **D5** `[9/9]` 步骤确认：镜像内**不含**任何 `.env*` / `INSTALL_CREDENTIALS.txt`
- [ ] **D6** `[4/9]` 步骤确认：`down`（不带 `-v`）+ `up` 后探针数据**仍在**
- [ ] **D7** `[5/9]` 步骤确认：重启后管理员 `password_hash` **不变**、主题数**不变**
- [ ] **D8** `[R-17a]` 步骤确认：Redis 停止期间应用**未返回 5xx**，恢复后回到 200
- [ ] **D9** `[R-17b]` 步骤确认：PG 恢复后应用**自动回到 200**（未重启容器）
- [ ] **D10** `[7/9]` 步骤确认：`install.sh` 真实跑通，`.env` 权限 = **600**
- [ ] **D11** artifact `docker-verify-evidence` 可下载，内含 `/tmp/summary.md`

### 8.3 Release 流水线

- [ ] **R1** `release.yml` 的 tags 白名单**已含** `'v0.0.4'`（**推 tag 之前**必须完成）
- [ ] **R2** `bash scripts/release/preflight.sh --phase=release` 退出码 = 0
      （或明确记录剩余 FAIL/BLOCK 的处置结论）
- [ ] **R3** 推 `v0.0.4` tag 后，**Actions 页面上确实出现了对应的 Release run**
      —— 这是防 §6.1「静默失败」的关键检查点

---

## 9. 本轮**未执行**的破坏性操作（自我声明）

| 操作 | 状态 |
|---|---|
| `git push` | ❌ 未执行 |
| `git commit` | ❌ 未执行 |
| 创建 / 删除 / 移动 Tag | ❌ 未执行 |
| 创建 / 修改 / 发布 / 删除 Release | ❌ 未执行 |
| 修改仓库可见性 | ❌ 未执行（仍为 Public） |
| 改写远端历史 / force push | ❌ 未执行 |
| 修改 `release.yml` 的 tag 白名单 | ❌ 未执行（保持人工摩擦） |
| DROP 任何非隔离测试库 | ❌ 未执行（`v2ex_loadtest` / `v2ex_v002_baseline` / `v2ex_e2e` 均未动） |
| 清空 PG data 目录 | ❌ 未执行 |

**我唯一写入仓库的文件**是本目录下 3 个新增的证据 markdown，
以及 `.github/workflows/docker-verify.yml`（新建）。

---

## 10. 复现命令

```bash
# 仓库可见性
gh repo view --json name,visibility,isPrivate,defaultBranchRef,url,pushedAt

# PR 列表
gh pr list --state all --limit 20 \
  --json number,title,state,headRefName,baseRefName,createdAt,url,isDraft

# Tag 列表
gh api repos/alicia1030su/v2ex-clone/tags --jq '.[] | "\(.name)\t\(.commit.sha[0:8])"'

# Release 列表（含 draft 标志）
gh api repos/alicia1030su/v2ex-clone/releases \
  --jq '.[] | "\(.tag_name)\tdraft=\(.draft)\tprerelease=\(.prerelease)\tpublished=\(.published_at)"'

# 全部 run
gh run list --limit 25 \
  --json databaseId,workflowName,headBranch,headSha,status,conclusion,event,createdAt,url

# 某次 run 的 job 明细
gh run view 41760677505 --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'

# 下载 run 日志并提取测试计数
gh run view 41760677505 --log > /tmp/ci.log
grep -E "Test Files|Tests  |passed \(" /tmp/ci.log

# 未推送提交数
git rev-list --count origin/master..HEAD
```
