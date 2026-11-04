# 本地真实测试基线 —— v0.0.4

> **取证人**：严过关（Yan）· QA 工程师
> **取证时间**：2026-11-04T12:36Z – 2026-11-04T12:41Z（本地 20:36 – 20:41 +0800）
> **代码基线**：`feat/v0.0.4-high-fidelity` @ `097c1b9`（工作区除 3 个新增文件外干净）
> **环境**：Windows / Node v22.22.2 / Vitest 5.0.5 / Playwright（系统 Edge 渠道）
> **数据库**：本机 PostgreSQL 17.5 @ `127.0.0.1:55433`（**隔离测试实例**，非生产库）

---

## 0. 结论速览

| 项 | 权威数字 | 实测方式 | 结果 |
|---|---|---|---|
| **单元测试总数** | **190 条 / 15 个文件** | `vitest run` 的 JSON reporter（`numTotalTests`） | ✅ **190 passed / 0 failed / 0 skipped** |
| **E2E 条数** | **153 条 / 11 个文件** | `npx playwright test --list` | ✅ 153（仅 `--list`，未实跑） |
| **迁移幂等性** | **通过** | `drizzle-kit migrate` 连跑两次 | ✅ 第二次零变更、零报错 |

### 0.1 「185 vs 190」争议 —— **裁决**

> ## **190 条**（15 文件）。**185 是 v0.0.3（master）的数字，已过时。**

**证据链（三段，全部可复核）**：

**① 远端最后一次绿色 CI 的真实输出**（run `41760677505`，master @ `37710fb4`）：

```
Test Files  14 passed (14)
     Tests  185 passed (185)
  Duration  17.68s (tests 85%, import 13%, transform 1%)
```

从 `gh run view 41760677505 --log` 下载日志后解析得到 —— **这是 v0.0.3 的数字，不是 v0.0.4 的**。

**② 差异的来源已定位到具体文件**：

```bash
$ git log --oneline --diff-filter=A -- tests/floor-continuity.spec.ts
1b15f79 docs(v0.0.4): 验收证据闭环、文档纠错、发布门禁双模式与最终交付方案

$ git cat-file -e 37710fb4:tests/floor-continuity.spec.ts && echo YES || echo NO
NO - added after master
```

master（`37710fb4`）有 **14 个** spec 文件，当前 HEAD 有 **15 个** ——
差的就是 `tests/floor-continuity.spec.ts`（提交 `1b15f79` 引入，**5 条**用例）。

```
185 (master, 14 文件)  +  5 (floor-continuity.spec.ts)  =  190 (当前, 15 文件)  ✅
```

**③ 当前分支的实测复现**（见 §1，JSON reporter 权威口径）：**190 / 15，全部通过**。

> ⚠️ **静态 grep 不可用作口径**：`grep -cE "^\s*(it|test)\s*[(']"` 得出的是 **180**，
> 少于实际 190。原因：`tests/admin-permissions.spec.ts` 等文件用**嵌套 for 循环**生成用例
> （例：第 119–129 行 `for (const [permission, expected] of Object.entries(EXPECTED))`
> 内再套 `for (const role of ['user','moderator','admin'])`），静态正则数不出来。
> **口径必须取 Vitest 运行时的 `numTotalTests`。**

### 0.2 证据完整性自检（✅ 实测）

本轮有 **3 条并行的 vitest 后台任务**（其中两条写向**同一个** `/tmp/vitest-baseline.log`
与 `/tmp/vitest-results.json`）。为排除「报告的数字其实来自被覆盖的那次运行」这一风险，
对最终留存的日志与 JSON 做了**双向交叉校验**：

```
LOG summary block                JSON reporter
  Test Files  (15, 15)            numTotalTests          190
  Tests      (190, 190)           numPassedTests         190
                                 numFailedTests         0
                                 numPendingTests        0
                                 numTotalTestSuites     53
                                 numPassedTestSuites    53
                                 numFailedTestSuites    0
                                 success                True

CONSISTENCY CHECK
  OK  total tests:        log=190  json=190
  OK  test files:         log=15   json=15
  OK  passed == total:    log=190  json=190
  OK  failed == 0:        log=0    json=0
  OK  pending/skipped==0: log=0    json=0
  OK  per-file sum:       log=190  json=190

  ALL CONSISTENT
```

**结论：日志与 JSON 两个独立产物完全自洽，且与 §1.3 的逐文件明细（15 文件求和 = 190）三方一致。**
本报告的 190 / 15 三个数字来自同一次完整运行，不存在混用不同运行结果的情况。

> 另注：本轮**未复现**「hook 超时 + 28 条被跳过」的历史现象，
> `numPendingTests: 0` 证明**没有任何用例被静默跳过**（这是比「全绿」更强的结论）。

### 0.3 基线归属证明：**190 这个数字只对应 `097c1b9`，不含任何未提交改动**

本轮运行期间（20:36:39 – 20:40:14）有并发队友在编辑 `deploy/`。
架构师随后提出质疑：「190 是否包含了未提交改动？」—— **答案是不含，且可证明**。

**证据 A —— mtime 时序**：所有测试输入文件的 mtime **全部早于**我的运行窗口。

| 路径 | mtime | 相对我的运行窗口（20:36:39–20:40:14） |
|---|---|---|
| `tests/*.spec.ts`（15 个） | 最晚 `2026-11-04 18:18:34` | **全部更早** ✅ |
| `vitest.config.ts` | `2026-11-04 18:42:12` | **更早** ✅ |
| `src/db/index.ts` / `schema.ts` | `11-03 22:39` / `11-04 09:55` | **更早** ✅ |
| `drizzle/*.sql` | 最晚 `11-04 16:22:59` | **更早** ✅ |
| `drizzle.config.ts` | `11-03 13:06:58` | **更早** ✅ |
| `package.json` | `11-04 09:55:18` | **更早** ✅ |
| `docker-compose.yml` / `Dockerfile` | 未修改 | **更早** ✅ |
| `deploy/.env.example` | `2026-11-04 20:36:43` | ⚠️ **在窗口内**（见证据 B） |
| `deploy/update.sh` | `2026-11-04 20:52:05` | 窗口**之后** ✅ |
| `scripts/release/verify-update-script.sh` | `2026-11-04 20:58:34` | 窗口**之后** ✅ |

**证据 B —— `deploy/` 不在任何测试的输入路径里**：

```bash
$ grep -rn "deploy/" tests/
tests/client-ip.spec.ts:7: * 而应用端口直接映射到宿主机（`deploy/docker-compose.yml` 的
```

**唯一一处 `deploy/` 出现在一个注释里**，没有任何测试**读取** `deploy/` 下任何文件。
`tests/docker-config.spec.ts`（42 条用例，占比最大）读的是：
`docker-compose.yml`、`docker-compose.debug.yml`、`Dockerfile`、
`scripts/docker-entrypoint.sh`、`scripts/seed.ts`、`scripts/verify.sh`、
`scripts/check-residual-exposure.sh`、`.github/workflows/ci.yml`、`package.json`
—— **全部在仓库根，不在 `deploy/`**。

**证据 C —— 工作区对测试输入零改动**：

```bash
$ git status --short -- tests/ src/ drizzle/ scripts/docker-entrypoint.sh scripts/seed.ts \
    scripts/verify.sh docker-compose.yml docker-compose.debug.yml Dockerfile package.json \
    .github/workflows/ci.yml
（空 —— 全部测试输入与 HEAD 097c1b9 逐字节一致）
```

**结论**：`190 / 15` 这个基线**严格对应 commit `097c1b9`**，
与运行期间并发产生的 `deploy/` 改动**完全无关**，可以安全引用。
（唯一在窗口内的改动是 `deploy/.env.example`（20:36:43，比 START 晚 4 秒），
但它不在任何测试的输入路径上，因此对结果零影响。）

### 0.4 🔴 **新发现的高危缺陷：v0.0.4 的 CI 单元测试 job 必然红灯**

架构师提出「`floor-continuity.spec.ts` 在 CI 上必崩」，我**独立复现并确认**，
且把机理与影响面测得更清楚。

**复现方法**（不是推测，是真实跑出来的）：
用 `git archive HEAD` 导出一份**纯净检出**（= GitHub Actions 看到的 checkout，
不含任何 gitignored 文件），再按 `ci.yml` 的方式提供 `DATABASE_URL`：

```bash
$ git archive HEAD | tar -x -C /tmp/ci-sim      # 纯净 CI 检出
$ ls /tmp/ci-sim/.env.test
  *** NO — .env.test ABSENT in CI checkout ***
```

> 根因：`.env.test` 被 `.gitignore` 第 16 行排除（`git ls-files` 只跟踪
> `.env.example` 与 `deploy/.env.example`），**CI 检出里根本没有这个文件**。

**真实失败输出**：

```
 FAIL  tests/floor-continuity.spec.ts > 楼层号严格连续 1..N（真实 allocateFloor + 真实 INSERT）
Error: ENOENT: no such file or directory, open '.../ci-sim/.env.test'
 ❯ baseDatabaseUrl tests/floor-continuity.spec.ts:64:5
    64|     readFileSync(path.join(repoRoot, '.env.test'), 'utf8'),
       |     ^
 ❯ testDatabaseUrl tests/floor-continuity.spec.ts:72:23
 ❯ tests/floor-continuity.spec.ts:104:30

 Test Files  1 failed (1)
      Tests  5 skipped (5)
```

**精确机理**（`tests/floor-continuity.spec.ts:60-68`）：

```ts
function baseDatabaseUrl(): string {
  const injected = process.env.DATABASE_URL;
  if (injected && /:55433\//.test(injected)) return injected;   // ← 只认 55433
  const fromTestFile = parseEnvFile(
    readFileSync(path.join(repoRoot, '.env.test'), 'utf8'),      // ← CI 下 ENOENT
  ).DATABASE_URL;
  ...
}
```

CI 的 `DATABASE_URL` 是 `postgres://...@localhost:5432/v2ex_ci`（`ci.yml` 第 146 行），
**不匹配 `/:55433\//`** → 落到 `readFileSync('.env.test')` → **ENOENT**。

**反证（证明机理正确，不是别的原因）**：把 `DATABASE_URL` 换成带 `:55433/` 的值，
同一份纯净检出立刻通过：

```
$ DATABASE_URL=postgres://v2ex:***@127.0.0.1:55433/postgres npx vitest run tests/floor-continuity.spec.ts
 Test Files  1 passed (1)
```

**影响面 —— 只有 1 个文件真正中招**（这点很关键，不要误伤其它文件）：

| 测试文件 | 读 `.env.test`？ | CI 下表现 |
|---|---|---|
| `tests/floor-continuity.spec.ts` | ✅ **是**（且有 `:55433/` 硬门） | 🔴 **ENOENT → 5 条 skipped** |
| `tests/seed-idempotency.spec.ts` | ❌ 否（只用 `process.env.DATABASE_URL`；第 48 行的 `.env.test` 只是**注释**） | ✅ 正常 |
| 其余 13 个文件 | ❌ 否 | ✅ 正常 |

**纯净 CI 检出的全量结果**（`DATABASE_URL` 指向真实 PG，剔除本机无 5432 造成的
`ECONNREFUSED` 噪声）：

```
 Test Files  1 failed | 14 passed (15)
      Tests  148 passed (148)
      Duration  238.83s
```

唯一失败的是 `docker-config.spec.ts`，**但那是我纯净检出没有 `.git` 目录导致的
本地伪影**（它执行 `git ls-files` 校验「原站素材不入库」）—— GitHub Actions 的
checkout **有完整 `.git`**，不会失败。**已排除。**

> **所以最终结论**：
> 在纯净 CI 检出下，**只有 `tests/floor-continuity.spec.ts` 会真实失败**，
> 表现为 **1 个文件 failed + 5 条用例 skipped**。
> 其余 14 个文件 / 148 条用例**全部通过**。
>
> ⚠️ **影响**：`ci.yml` 的 `unit` job 会**红灯** → `e2e` job 因 `needs: unit` **被跳过**
> → **整个 CI 红灯**。这会让「推送后 CI 全绿」无法成立，**必须在推送前修复**。
>
> ⚠️ **且注意 `5 skipped` 这个形态**：这正是 R-23 修复的那类**静默跳过** ——
> 如果只看「148 passed」，会误以为通过；实际是 `1 failed + 5 skipped`。
> **核对 CI 时必须看 `Test Files` 行，不能只看 `Tests` 行。**

### 0.5 候选修复方案 —— **已实跑验证通过**（供架构师 T01/T03 直接采纳）

修复思路：**去掉 `:55433/` 硬编码门 + `.env.test` 读取前先判断文件存在**。
这同时满足两条要求：**CI 用环境变量**、**本地仍可用 `.env.test` 兜底**。

```ts
// tests/floor-continuity.spec.ts
import { existsSync, readFileSync } from 'node:fs';

function baseDatabaseUrl(): string {
  const injected = process.env.DATABASE_URL;
  if (injected) return injected;                       // ← 优先用环境变量（CI 走这条）

  const testFilePath = path.join(repoRoot, '.env.test');
  if (existsSync(testFilePath)) {                      // ← 本地兜底前先判存在
    const fromTestFile = parseEnvFile(readFileSync(testFilePath, 'utf8')).DATABASE_URL;
    if (fromTestFile) return fromTestFile;
  }

  throw new Error('无法解析隔离测试实例的 DATABASE_URL（环境变量与 .env.test 均缺失）');
}
```

**验证结果（在纯净 CI 检出 `/tmp/ci-sim` 上实跑，不是纸面推演）**：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| **CI 条件**（`DATABASE_URL` 不含 `:55433/`、无 `.env.test`） | 🔴 `ENOENT .env.test` → `1 failed + 5 skipped` | ✅ **`1 passed (1)` / `5 passed (5)`** |
| **本地条件**（`.env.test` 存在） | ✅ 5 passed | ✅ **`1 passed (1)` / `5 passed (5)`**（无回归） |

> ⚠️ **我没有修改仓库里的这个文件** —— `tests/**` 是架构师/工程师的所有权，
> 且 T01/T03 正在做统一改造（`provisionTestDatabase()` 封装），
> 我在他们的设计里直接改会造成并行冲突。
> **以上补丁是在 `/tmp/ci-sim` 的副本上验证的，仓库原文未被触碰。**
> 建议以 T01 的「shell > ENV_FILE」裁决为准，把这段逻辑并入统一封装。

---

## 1. 单元测试实测（✅ 真实运行）

### 1.1 运行命令与结果

```bash
$ ENV_FILE=.env.test npx vitest run \
    --reporter=default --reporter=json --outputFile=/tmp/vitest-results.json
```

```
START_UTC=2026-11-04T12:36:39Z  HEAD=097c1b9
EXIT=0
END_UTC=2026-11-04T12:40:14Z
```

**总耗时 3 分 35 秒**（215 秒）。

### 1.2 JSON reporter 权威计数

```json
{
  "numTotalTests":     190,
  "numPassedTests":    190,
  "numFailedTests":    0,
  "numPendingTests":  0,     ← 0 条 skipped
  "numTodoTests":     0,
  "numTotalTestSuites":  53,
  "numPassedTestSuites": 53,
  "numFailedTestSuites": 0,
  "success": true
}
```

> **`numPendingTests: 0` 是关键** —— 本轮「0 skipped」是硬指标
> （上一轮的 R-23 就是「关注用例静默跳过」，静默跳过比红灯更危险）。

### 1.3 逐文件明细（真实耗时来自 JSON reporter）

| 文件 | 用例数 | 通过 | 耗时(ms) | 状态 |
|---|---:|---:|---:|---|
| `tests/admin-cli.spec.ts` | 11 | 11 | 20838 | ✅ passed |
| `tests/admin-permissions.spec.ts` | **24** | 24 | 23 | ✅ passed |
| `tests/captcha.spec.ts` | 28 | 28 | 324 | ✅ passed |
| `tests/client-ip.spec.ts` | 8 | 8 | 131 | ✅ passed |
| `tests/content-lifecycle.spec.ts` | 13 | 13 | 22230 | ✅ passed |
| `tests/credits-concurrency.spec.ts` | 8 | 8 | 322 | ✅ passed |
| `tests/db-lazy-init.spec.ts` | 5 | 5 | 7417 | ✅ passed |
| `tests/docker-config.spec.ts` | 42 | 42 | 100 | ✅ passed |
| `tests/feed-search.spec.ts` | 12 | 12 | 9981 | ✅ passed |
| **`tests/floor-continuity.spec.ts`** | **5** | 5 | 290 | ✅ passed |
| `tests/floor-counter.spec.ts` | 6 | 6 | 40 | ✅ passed |
| `tests/middleware-client-ip.spec.ts` | 6 | 6 | 47 | ✅ passed |
| `tests/password-reset.spec.ts` | 11 | 11 | 637 | ✅ passed |
| `tests/rate-limit-clear.spec.ts` | 3 | 3 | 155 | ✅ passed |
| `tests/seed-idempotency.spec.ts` | 8 | 8 | 16302 | ✅ passed |
| **合计** | **190** | **190** | **78844** | ✅ **15/15 passed** |

> **`admin-permissions.spec.ts` = 24 条**（静态 grep 只有 14），
> 差额来自嵌套循环生成的用例 —— 见 §0.1 的说明。

### 1.4 耗时观察（**不是**失败，但值得记录）

耗时高度集中在**需要建库 + 跑迁移**的 5 个文件：

| 阶段 | 累计占比 |
|---|---|
| `admin-cli` (20.8s) + `content-lifecycle` (22.2s) + `seed-idempotency` (16.3s) + `feed-search` (10.0s) + `db-lazy-init` (7.4s) | **76.7s / 78.8s ≈ 97%** |
| 其余 10 个文件合计 | ~2.1s |

**根因**（与 `vitest.config.ts` 里已有的注释一致）：
每个文件在 `beforeAll` 里做 `DROP DATABASE` → `CREATE DATABASE` → `drizzle-kit migrate`。
本机磁盘上 `CREATE DATABASE` 是瓶颈（历史实测 38.6s）。

**⚠️ 但本轮实测没有出现 hook 超时** ——
`hookTimeout` 已被提到 120s，且 `fileParallelism: false`（串行），
本轮 190 条**全部在阈值内通过，0 条被跳过**。

> 📌 **给架构师（任务 #1）的实测输入**：
> 本轮**没有复现**「4 个文件 hook 超时 + 28 条用例被跳过」的现象。
> 可能的原因组合：
> 1. `ENV_FILE=.env.test` 显式指定了 55433 隔离实例（`tests/setup.ts` 里的 `override: true` 会让它覆盖 `.env.local` 的 5432）；
> 2. `hookTimeout: 120_000` 已生效；
> 3. `fileParallelism: false` 串行执行，消除了多文件争抢同一 PG 实例的互相拖慢。
>
> **我没有改动 `vitest.config.ts` 或 `tests/setup.ts`**（属他人所有权）。
> 上述归因仅供架构师参考，我未做对照实验。

---

## 2. E2E 条数实测（✅ 真实运行 `--list`）

```bash
$ npx playwright test --list
```

```
Total: 153 tests in 11 files
```

### 2.1 逐文件明细

| 文件 | 条数 |
|---|---:|
| `v004-endpoint-smoke.spec.ts` | 31 |
| `v004-account-admin.spec.ts` | 20 |
| `security-regression.spec.ts` | 19 |
| `v004-api-contract.spec.ts` | 17 |
| `feature.spec.ts` | 16 |
| `v004-content-interaction.spec.ts` | 10 |
| `security.spec.ts` | 10 |
| `v004-four-roles-ui.spec.ts` | 8 |
| `topic.spec.ts` | 8 |
| `auth.spec.ts` | 8 |
| `pagination.spec.ts` | 6 |
| **合计** | **153** |

### 2.2 与基线的一致性

✅ **153 条 / 11 文件** —— 与任务说明给的基线**完全一致**。

### 2.3 边界声明（**必须说清**）

> **`--list` 只统计「被 Playwright 收集到的用例」，不执行它们。**
>
> - 它**能**证明：测试文件能被正确解析、用例数与基线一致、没有用例在收集阶段就丢失。
> - 它**不能**证明：用例真的通过。
>
> 本轮 E2E 的**真实通过数**只能来自：
> 1. 远端最后一次绿色 CI（master @ `37710fb4`）的 `67 passed` —— 但那是 **v0.0.3** 的 E2E 集
>    （当时只有 67 条，v0.0.4 新增了 77 条真实浏览器 E2E，见提交 `04b107b`）；
> 2. **本轮分支的 E2E 实跑 —— 尚未发生**（9 个提交未推送 → CI 未触发）。
>
> ⚠️ **`67` → `153` 的差额已定位到具体文件**（`git ls-tree` 对比 master 与 HEAD）：
>
> | 来源 | 文件 | 条数 |
> |---|---|---:|
> | master（v0.0.3）已有的 6 个文件 | `auth` 8 + `feature` 16 + `pagination` 6 + `security-regression` 19 + `security` 10 + `topic` 8 | **67** |
> | v0.0.4 新增的 5 个文件 | `v004-endpoint-smoke` 31 + `v004-account-admin` 20 + `v004-api-contract` 17 + `v004-content-interaction` 10 + `v004-four-roles-ui` 8 | **86** |
> | **合计** | 11 个文件 | **153** ✅ |
>
> 即 **67 + 86 = 153**，差额 **全部**来自 5 个新增的 `v004-*` 文件，
> 原有 6 个文件的条数**一条未变**（`auth` 8 / `feature` 16 / `pagination` 6 /
> `security-regression` 19 / `security` 10 / `topic` 8 —— 与 master 完全一致）。
>
> ⚠️ 但**这仍然不等于「153 条全绿」**。`--list` 只证明用例被正确收集，
> 证明「全绿」必须实跑。远端最后一次 E2E 绿灯是 **master 的 67 条**，
> **v0.0.4 的 153 条从未在任何 CI run 中跑过**（9 个提交未推送）。

---

## 3. 数据库迁移幂等性复核（✅ 真实运行）

### 3.1 隔离性保证

**使用全新建的专用测试库 `v2ex_qa_migidem_v004`**，未触碰任何既有库：

```
v2ex_loadtest       890 MB   ← 压测库，未动
v2ex_v002_baseline  9.2 MB   ← 未动
v2ex_e2e            9.7 MB   ← 未动
v2ex_qa_migidem_v004  9.0 MB  ← 本次新建（QA 专用）
```

### 3.2 ⚠️ 首次尝试暴露了一个**真实配置缺陷**（已绕过，未改代码）

**第一次尝试**用 `ENV_FILE=.env.test DATABASE_URL=<QA库> npx drizzle-kit migrate`，
结果**迁移打到了 `v2ex_e2e` 而不是指定的 QA 库**：

```
$ psql -d v2ex_qa_migidem_v004 -c "select ... from pg_tables where schemaname='public'"
（空 —— QA 库一张表都没有）

$ psql -d v2ex_e2e -c "select schemaname||'.'||tablename from pg_tables where schemaname='drizzle'"
drizzle.__drizzle_migrations    ← 迁移跑到 v2ex_e2e 去了
```

**根因**（`drizzle.config.ts` 第 4–9 行）：

```ts
if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true, override: true });   // ← override: true
}
config({ path: '.env.local', quiet: true });
```

`override: true` 让 **`ENV_FILE` 指向的文件覆盖已存在的环境变量** ——
所以 `ENV_FILE=.env.test` 会**无条件覆盖**我临时传入的 `DATABASE_URL`。
命令行传 `DATABASE_URL=` 在 `ENV_FILE` 存在时**是无效的**。

> 🔴 **这是一个真实的配置陷阱**：任何「临时指定数据库跑迁移」的操作，
> 只要同时设了 `ENV_FILE`，指定的库就会被静默替换成 `ENV_FILE` 里的那个。
> **风险**：在生产/压测库上误跑迁移、或以为在测试库跑其实跑到了别的库。
>
> **我没有修改 `drizzle.config.ts`**（不在我的所有权范围内，且改动会影响
> 架构师正在进行的 `tests/setup.ts` 修复）。在此如实上报。

**绕过方式**：不设 `ENV_FILE`，改用一个**专供本次验证的临时 env 文件**（放在仓库外，
不进版本库），让 `ENV_FILE` 本身就指向 QA 库：

```
/tmp/qa-env/migidem.env:
  DATABASE_URL=postgres://v2ex:***@127.0.0.1:55433/v2ex_qa_migidem_v004
  APP_RUNTIME_ENV=test
```

### 3.3 第一次迁移（空库 → 全部迁移）

```
$ time ENV_FILE=/tmp/qa-env/migidem.env npx drizzle-kit migrate
No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Users\TYMO001\WorkBuddy\ai\v2ex-clone\drizzle.config.ts'
Using 'postgres' driver for database querying
[✓] migrations applied successfully!

real    0m5.287s
```

迁移 journal（`drizzle.__drizzle_migrations`）写入 3 行：

```
id | hash
 1 | fe2ac4a18af0fef1772f82761a0b5986b9e81be71470f26428d9699f6055d765
 2 | 4f86114805eefd8002373c8d8fb369ae611f87facfeb8605c2babf725daa6835
 3 | e00e4a09b473f9da51d62f5575f2404a30241b90e394a59f024a5312b66205e2
```

对应的表/索引落地情况：

```
tables  = 26
indexes = 76
```

### 3.4 第二次迁移（幂等性验证）—— ✅ **零变更、零报错**

```
$ time ENV_FILE=/tmp/qa-env/migidem.env npx drizzle-kit migrate
[✓] migrations applied successfully!

real    0m4.290s
```

**两次之后的状态对比**：

| 指标 | 第一次后 | 第二次后 | 判定 |
|---|---:|---:|---|
| `drizzle.__drizzle_migrations` 行数 | 3 | **3** | ✅ 无新增 |
| 每行 hash | 3 条固定 hash | **完全相同** | ✅ 无重写 |
| `public` 表数 | 26 | **26** | ✅ 无变化 |
| `public` 索引数 | 76 | **76** | ✅ 无变化 |
| 退出码 | 0 | **0** | ✅ |
| 报错 | 无 | **无** | ✅ |

第二次的输出只有两条 **NOTICE**（均为 PostgreSQL 的「已存在，跳过」提示，**不是错误**）：

```
NOTICE  42P06  模式 "drizzle" 已存在, 跳过        (CreateSchemaCommand)
NOTICE  42P07  关系 "__drizzle_migrations" 已经存在, 跳过  (transformCreateStmt)
```

> **结论：迁移幂等性 ✅ 通过。**
> 这也与 `scripts/release/preflight.sh` §4 的静态检查一致
> （`0002` 的 7 条 `CREATE INDEX` **全部**带 `IF NOT EXISTS`）。

### 3.4.1 第三次运行（可复现性复核）

为排除「幂等性结论是偶然」以及「架构师并行启动的 PG 持久守护脚本改变了结论」，
在 PG keepalive 生效的状态下**又跑了一次**：

```
BEFORE: journal_rows=3   tables=26   indexes=76
$ time ENV_FILE=/tmp/qa-env/migidem.env npx drizzle-kit migrate
[✓] migrations applied successfully!
real  0m4.065s
AFTER : journal_rows=3   tables=26   indexes=76
```

**第三次运行同样零变更、零报错** ✅ —— 幂等性结论**可复现**，与 PG 守护进程的有无无关。

> 📌 背景说明：本机 PG 由架构师新增的 `_scratch/pg-keepalive-v004.sh` 常驻守护
> （解决「PG 进程随 Bash 调用结束被回收」的问题 C）。该脚本只做
> `pg_ctl status` 探测 + 必要时 `pg_ctl start`，**不修改任何数据**，
> 因此对本报告的结论无影响 —— 上面的第 3 次运行即在守护生效后完成。

### 3.5 0002 性能索引的落地实证

`0002_v004_perf_indexes.sql` 定义的索引，在 QA 库中**逐条核对存在**：

```
thanks -> thanks_reply_id_idx            ✓
replies -> replies_author_alive_idx      ✓
replies -> replies_topic_id_idx           ✓
topics  -> topics_author_alive_idx        ✓
topics  -> topics_title_trgm_idx          ✓   ← pg_trgm GIN
topics  -> topics_content_trgm_idx        ✓   ← pg_trgm GIN
votes   -> votes_topic_id_idx             ✓
```

**7/7 全部落地** ✅（其中 2 个 trgm 索引在 `DO $$ ... EXCEPTION` 块里创建，
说明 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 的异常捕获路径也被真实走通并成功）。

### 3.6 清理

本轮**未删除** `v2ex_qa_migidem_v004`（保留为可复核的现场），
也**未删除**任何其它库。全部 21 个库仍在（数量与开始时一致 + 本次新建的 1 个）。

---

## 4. 其它本地实测项

### 4.1 Compose 配置静态校验（🟡 用 PyYAML 代替 `docker compose config`）

本机无 Docker，`docker compose config` **无法执行**。改用 Python + PyYAML 6.0.3 做等价解析。
完整结果见 `docker-verify-v0.0.4.md` §3.1。核心结论：

| 文件 | YAML 解析 | postgres 暴露端口 | redis 暴露端口 |
|---|---|---|---|
| `docker-compose.yml` | ✅ OK | ❌ 无 | ❌ 无 |
| `deploy/docker-compose.yml` | ✅ OK | ❌ 无 | ❌ 无 |
| `docker-compose.debug.yml` | ✅ OK | ✅ 有（绑 `127.0.0.1`，仅本机可达） | ✅ 有（同左） |

### 4.2 `preflight.sh` 实跑（✅ 真实运行）

```bash
$ bash scripts/release/preflight.sh --phase=dev
```

```
phase=dev  PASS=22  WARN=2  FAIL=0  BLOCK=1  INFO=13
结论：无工程 FAIL，但存在 1 个 BLOCK（R-01 授权未决） —— **禁止发布 / Release 只能停在 Draft**。
```

- **FAIL = 0** ✅ —— 无工程缺陷
- **BLOCK = 1** —— `RISK_REGISTER` 的 R-01 授权未决（**预期**，需主人单独授权，与本轮无关）
- **WARN = 2** —— ① 工作区有未提交变更（正常，队友在并行编辑）；
  ② `deploy/update.sh` 已出现 v0.0.4 字面量（**部署工程师正在改**，属预期）
- 退出码 `1`（因 BLOCK）—— **符合脚本设计**

覆盖度矩阵见 `docker-verify-v0.0.4.md` §3.2。

### 4.3 一个命令行陷阱（供团队参考）

任务说明给的命令 `npx vitest run --reporter=basic` **在 Vitest 5.0.5 下会直接失败**：

```
[cause]: Error: Failed to load url basic (resolved id: basic). Does the file exist?
  code: 'ERR_LOAD_URL'
```

Vitest 5 已移除 `basic` reporter。**可用的等价命令**：

```bash
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/vitest-results.json
```

`--reporter=json` 还能给出机器可读的 `numTotalTests` / `numPendingTests` 等权威字段 ——
**这正是判定「0 skipped」和「185 vs 190」最可靠的依据**。

---

## 5. 汇总：本次基线快照

```
基线 commit : 097c1b9 (feat/v0.0.4-high-fidelity)
取证时间   : 2026-11-04T12:36:39Z ~ 12:41Z
工作区状态 : 仅 3 个新增文件（docker-verify.yml + docs/evidence/ci/ + verify-update-script.sh）

┌─ 单元测试 ─────────────────────────────────────────────────┐
│ 190 条 / 15 文件  |  190 passed  0 failed  0 skipped      │
│ 总耗时 3m35s（其中 97% 花在 5 个建库+迁移的文件上）        │
│ Vitest 5.0.5 · Node 22.22.2 · PG 17.5 @ 127.0.0.1:55433   │
└─────────────────────────────────────────────────────────────┘

┌─ E2E ───────────────────────────────────────────────────────┐
│ 153 条 / 11 文件（playwright test --list，未实跑）          │
│ 与基线完全一致 ✅                                           │
└─────────────────────────────────────────────────────────────┘

┌─ 迁移幂等 ──────────────────────────────────────────────────┐
│ drizzle-kit migrate ×2 → 第二次零变更、零报错              │
│ journal 3 行不变 / 26 表不变 / 76 索引不变 / 0002 的 7 个索引全落地 │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 需要他人跟进的两项（**我未修改，属他人所有权**）

| # | 问题 | 位置 | 归属 | 建议 |
|---|---|---|---|---|
| **1** | `preflight.sh` 第 285 行硬编码「单元基线 **185** 条」 | `scripts/release/preflight.sh:285` | `software-engineer-deploy` | 改为 **190 条 / 15 文件**（或改为动态读取，避免再次过时） |
| **2** | `drizzle.config.ts` 的 `override: true` 使命令行 `DATABASE_URL` 被 `ENV_FILE` 静默覆盖 | `drizzle.config.ts:5-7` | 架构师（任务 #1 正在改 `tests/setup.ts`）/ `software-engineer-deploy` | 至少在注释里写明「`ENV_FILE` 存在时命令行 `DATABASE_URL` 无效」；理想是显式提示而非静默 |

---

## 7. 自我声明

- ❌ 未修改 `vitest.config.ts`、`tests/**`、`src/**`、`e2e/**`、`deploy/**`、`.env*`
- ❌ 未提高任何超时阈值（120s 的 `hookTimeout` 是既有值，我未动）
- ❌ 未 DROP 任何非隔离测试库（`v2ex_loadtest` / `v2ex_v002_baseline` / `v2ex_e2e` 均未动）
- ❌ 未执行破坏性数据库操作、未清空 PG data 目录
- ❌ 未在本文档中输出任何真实数据库口令（连接串一律以 `***` 打码）
- ✅ 本轮唯一新建的数据库：`v2ex_qa_migidem_v004`（QA 专用隔离库，保留现场）
- ✅ 本轮新增的仓库文件：`.github/workflows/docker-verify.yml`、`docs/evidence/ci/**`
