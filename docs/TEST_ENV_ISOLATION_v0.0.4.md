# 测试环境隔离与 PostgreSQL 生命周期治理 —— 增量架构设计（v0.0.4）

> 角色：架构师（高见远 / Gao）
> 仓库：`C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone`
> 分支 / HEAD：`feat/v0.0.4-high-fidelity` @ `301a8a5`
> 技术栈：Next.js 15（App Router）+ Drizzle ORM + PostgreSQL 17.5 + Redis 7 + Vitest 5 + Playwright
> 本文档性质：**只读设计产出**。撰写过程中未执行任何建库 / 删库 / 改代码 / 改配置操作；
> 全部实测数据来自对现有实例的**只读查询**与 `_scratch` 下的**一次性探针**（探针产物已清理）。
>
> **口径三分**：**实跑**（有实测数字） / **静态核查**（读代码得出，未实跑） / **待实测**（设计上预留，需要实施后回填）。
> 凡未实跑的数字一律标「待实测」，不编造。

---

## 0. 结论摘要

| 问题 | 原判定 | 本轮修正后的判定 | 关键实测依据 |
|---|---|---|---|
| **A. 环境变量与子进程目标错误** | 「`.env.test` 未加载导致误连 5432 开发库」 | **判定成立且比预期更严重**：单元测试在**默认情形下**就会解析到 **5432 开发库**并在其上 `CREATE DATABASE`；另有 **1 个已入库测试文件在 CI 上必崩** | 复刻 `tests/setup.ts` 逻辑实跑：`DATABASE_URL = postgres://v2ex:***@127.0.0.1:5432/v2ex`；`git ls-files` 确认 `.env.test` **未入仓**（仅 `.env.example` 入仓）；QA 实测确认 `override: true` 会让命令行 `DATABASE_URL` **完全失效** |
| **B. `CREATE DATABASE` 38.6s** | 「1.4GB 数据目录 / 模板库复制 / fsync 逐文件」 | **归因彻底修正（第三次勘误）**：38.6s 是 **PG 处于 crash recovery / I/O 积压态**时的观测值，**不是稳态**。主理人在**同一个 1.4GB 实例**上实测稳态 `CREATE DATABASE` = **2.0~2.3s**。数据目录大小**根本不是瓶颈** | 主理人实测：连测 3 次 `DROP+CREATE` = 2277 / 1978 / 2243 ms；单独 `CREATE` = 2083 ms；同期 checkpoint `total=0.053s / 0.158s` |
| **C. PG 子进程生命周期** | 「Bash 调用结束回收进程树」 | **判定成立**，但根因不是「进程树回收」本身，而是 **Windows 下 `pg_ctl start` 拉起的 postgres.exe 是独立会话的孙进程**；且本轮 `pg_ctl status` 显示实例**当前仍在运行** | `pg_isready` 实测 `127.0.0.1:55433 - accepting connections`（本次核查期间）；`postmaster.pid` 存在且 `port=55433` |

### 0.1 归因勘误史（三次勘误 —— 完整留痕）

本问题经历了**三轮归因**，每一次都被后续实测推翻或修正。**完整留痕是本节存在的意义**：
避免第四轮会话再次从错误前提出发。

| 轮次 | 归因 | 结论 | 被什么推翻 |
|---|---|---|---|
| **第 1 轮**（写入 `vitest.config.ts` 注释） | 「PG 数据目录 1.4GB / 24 库 → `CREATE DATABASE` 复制模板库并 fsync 新库全部文件 → 数据目录越大越慢」 | ❌ **错误** | 见下方「第 1 轮为何错」 |
| **第 2 轮**（架构师初稿） | 「不是数据目录大小，而是 **fsync 单次 ~5ms** 叠加 **checkpoint 的 write 阶段（实测 21s~147s）**」 | ⚠️ **部分错误** —— 正确指出了 I/O 放大，但**把「恢复期积压」误判成「常态」** | 主理人稳态实测 2.0~2.3s |
| **第 3 轮**（本轮最终） | 「38.6s = **PG 处于 crash recovery / I/O 积压态**时的观测值；稳态建库 ~2s」 | ✅ **成立** | — |

#### 第 1 轮为何错（架构师实测的三条反驳）

1. `CREATE DATABASE` 复制的是 **`template1`（`base/1`）**，实测 **298 个文件 / 7.5MB**，与数据目录总大小（1.4GB）**无关**；
2. 实测 copydir + 逐文件 fsync 全流程仅 **1633ms**（探针：copydir 825ms + 298 文件 fsync 808ms，均值 2.71ms/文件），**无法解释 38.6s**；
3. 1.4GB 里 **891MB 是单个压测库 `v2ex_loadtest`**（`base/279166`），它**不在** `template1` 里，也**不参与** `CREATE DATABASE` 的文件复制。

#### 第 3 轮的正面证据：38.6s 发生在 crash recovery 期

PG 日志（`pg-v003.log`）实测**完整时间线**，这是决定性证据：

```
20:28:51  syncing data directory (fsync), elapsed time: 10.01 s, current path: ./base/243139/14953
20:29:01  syncing data directory (fsync), elapsed time: 20.01 s, current path: ./base/270336/4148
20:29:11  syncing data directory (fsync), elapsed time: 30.01 s, current path: ./base/283715/1418
20:29:21  syncing data directory (fsync), elapsed time: 40.01 s, current path: ./base/345274/348115
20:29:31  syncing data directory (fsync), elapsed time: 50.01 s, current path: ./base/377609/379132
20:29:41  syncing data directory (fsync), elapsed time: 60.00 s, current path: ./base/383131/383197
20:29:51  syncing data directory (fsync), elapsed time: 70.01 s, current path: ./base/5/6229
          ↓ 随后：数据库系统被中断 → redo 开始 → redo done → end-of-recovery checkpoint
```

**关键点**：20:29:41~20:29:51 这一段是 **60~70 秒的逐目录 fsync**，
且紧接着出现 `数据库系统未正确关闭，正在自动恢复状态` → `redo 开始` → `redo done`。
**上一轮观测 38.6s 建库的时刻，PG 正处在「刚做完 70 秒恢复 fsync、磁盘队列仍积压」的状态。**

同期日志里那些 21s~147s 的慢 checkpoint 也落在**同一段积压窗口**内
（19:16~19:31 之间，多次 `checkpoint starting: time`），而**稳态下 checkpoint 只有 0.053s / 0.158s**。

#### 第 3 轮的设计含义（本轮最重要的一条）

> **独立测试实例的价值是「隔离性」与「可复现性」，不是「性能修复」。**

| 维度 | 独立实例带来的价值 | 与性能修复的区别 |
|---|---|---|
| **隔离性** | 不与 24 库实例（含 890MB 压测库、E2E 库）争抢连接数与 I/O；`DROP DATABASE` 不需要在 24 库实例上做 | — |
| **可复现性** | 数据目录小（< 200MB）、库集合固定、**永远处于新建的干净状态**，不会被前几轮的遗留库污染 | — |
| **性能** | **不解决** fsync 5ms 的本机存储特性 —— 但**稳态下建库本来就只要 2s**，所以**根本不需要性能修复** | ❌ **不是**性能方案 |

**因此本设计对「超时」的口径必须改写**：
- ❌ 旧口径：「`CREATE DATABASE` 38.6s > `hookTimeout` 30s，所以要提到 120s」
- ✅ 新口径：「**稳态**建库 ~2s + migrate ~5s + seed，全流程应 **< 30s**；
  `hookTimeout: 120_000` 作为**宽松保险**是合理的，但**不是**用来掩盖问题的」

**配套的硬性要求**：必须提供 **「PG 是否已进入稳态」的判据**（§4.7），
把**「PG 未就绪 / 恢复中」**与**「真超时」**区分开 ——
这是防止把**环境问题误判成产品缺陷**的关键（详见 §4.7.1）。

---

## 1. 范围与所有权边界

### 1.1 本设计覆盖

| 项 | 内容 |
|---|---|
| 问题 A | 环境变量加载优先级、父子进程目标一致性、`.env.test` 入仓策略、防误连护栏 |
| 问题 B | 独立测试 PG 实例的初始化方案、**PG 稳态判据**、超时策略、阶段耗时日志、进一步排查步骤 |
| 问题 C | PG 生命周期托管（启动 → 测试 → 清理）的单次 Bash 调用方案 |
| 任务分解 | 有序、含依赖、标注文件/责任人/验收标准、标注互斥文件 |
| **归因勘误** | **三次勘误的完整留痕**（§0.1）—— 防止第四轮会话从错误前提出发 |

### 1.2 硬性约束（本设计全程遵守）

| 约束 | 落实方式 |
|---|---|
| 禁止修改 `.env.local` | 全部方案**只读** `.env.local`；隔离用**独立 env 文件 + 独立实例 + 独立端口**，不与 5432 共享任何状态 |
| 禁止 DROP 非测试库 | 所有 DROP 走**库名白名单正则**断言（§3.6），不匹配即抛错中止 |
| 禁止清空 `data-v003` | 新实例数据目录**另起路径**（`data-test-v004`），`data-v003` 全程只读 |
| 禁止 `git reset --hard` / `git clean` / 重新克隆 | 任务分解中不含此类操作 |
| `data-v003` 是证据 | 含 891MB `v2ex_loadtest` + `v2ex_v002_baseline`，文档中标注为**只读保留** |

### 1.3 明确的「不做」清单

- **不做**：把 `fsync=off` 写进测试实例配置。理由：掩盖真实 durability 行为；若实例被误用会静默丢数据。**且稳态建库本就只需 2s，根本不需要**。
- **不做**：把 `hookTimeout` 提到 300s/600s。理由见 §4.6.1 —— 120s 已是宽松保险。
- **不做**：**改动 `hookTimeout` 的数值**（初稿曾建议「回落 60s」，现**撤回**）。理由：实测稳态用不到 30s、QA 已实测 120s 下全绿，此时动阈值是**无收益的风险动作**。
- **不做**：删除 `v2ex_loadtest` 来「瘦身」`data-v003`。理由：它与 `v2ex_v002_baseline` 是 v0.0.4 负载测试与升级验证的**一手证据**。
- **不做**：修改 `src/db/index.ts` 的加载顺序来配合测试。原因见 §3.2 的边界说明。
- **不做**：把「独立测试实例」包装成「性能修复」。理由见 §0.1 —— **这是第三次误判的根源**，必须从文档口径上根除。
- **不做**：为提速而换盘 / 装 Docker / 改 `fsync` 参数（§4.4 的 P2 系列）。理由：稳态 2s，**没有性能问题需要解决**；这些是解决不存在的问题。

---

## 2. 现状基线（只读核查结果）

### 2.1 环境变量加载链路

四处**各自独立**地加载环境文件，逻辑完全一致但**没有共享实现**：

| 文件 | 加载逻辑 | 是否 `override` |
|---|---|---|
| `tests/setup.ts` | `ENV_FILE` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `drizzle.config.ts` | `ENV_FILE` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `src/db/index.ts` | `ENV_FILE` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `scripts/seed.ts` | `ENV_FILE` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `scripts/db-admin.mjs` | `ENV_FILE` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `playwright.config.ts` | `ENV_FILE` → `.env.test` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |
| `e2e/global-setup.ts` | `ENV_FILE` → `.env.test` → `.env.local` → `.env` | 仅 `ENV_FILE` 用 `override: true` |

`dotenv` 默认**不覆盖**已存在的变量，因此在这套链路上：

> **`process.env.DATABASE_URL`（来自 shell / CI）优先级高于所有文件**，
> 只有 `ENV_FILE` 因为 `override: true` 能反向覆盖它。

**这是整条链路最反直觉、也最危险的一点**：CI 的 `env: DATABASE_URL: postgres://...@localhost:5432/v2ex_ci` 在 `tests/setup.ts` 里**不会被 `.env.local` 覆盖**（`config()` 无 `override`）——但也**不会被 `.env.test` 覆盖**（除非显式设了 `ENV_FILE`）。

### 2.2 `.env.test` 的入仓状态（实测）

```
$ git ls-files --error-unmatch .env.test
error: pathspec '.env.test' did not match any file(s) known to git

$ git ls-files | grep -i "^\.env"
.env.example
```

`.gitignore:16` 明确忽略 `.env.test` 与 `.env.*.test`。**仓库里只有 `.env.example` 一个 env 模板**。

### 2.3 问题 A 的确切形态（实跑复刻）

复刻 `tests/setup.ts` 的加载序列（无 `ENV_FILE`），实测输出：

```
process.env.DATABASE_URL = postgres://v2ex:***@127.0.0.1:5432/v2ex
子进程目标 (testDatabaseUrl) = postgres://v2ex:***@127.0.0.1:5432/v2ex
admin 连接目标            = postgres://v2ex:***@127.0.0.1:5432/postgres
→ 实际建库位置 host:port  = 127.0.0.1:5432
```

各 spec 的 `testDatabaseUrl()` 实现（10 个建库文件全部一致）：

```ts
function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;          // ← 来自 .env.local → 5432
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;                    // ← 只换库名，不换 host:port
  return url.toString();
}
```

**这意味着**：单元测试会连到 **`127.0.0.1:5432`**，用 `v2ex` 角色（**实测 `rolsuper=t`、`rolcreatedb=t`**）执行 `DROP DATABASE` / `CREATE DATABASE`。
**一旦本机 5432 上跑着开发库，单元测试的第一步就是往开发库里建库** —— 这就是问题 A 的实质危害，
不是「超时」，而是**开发库污染 + 误删**。

`admin-cli.spec.ts` / `seed-idempotency.spec.ts` 用 `adminUrl.pathname = '/postgres'` 连管理库再执行
`DROP DATABASE IF EXISTS <TEST_DB>` / `CREATE DATABASE <TEST_DB>` —— 库名是硬编码的测试名，**DROP 本身安全**；
危险的是**它 DROP/CREATE 的落点在 5432 开发实例上**。

### 2.4 一个此前未发现的 CI 阻断缺陷（实跑复刻）

`tests/floor-continuity.spec.ts`（**已入库**，`git log` 确认在 `1b15f79`）的 `baseDatabaseUrl()`：

```ts
function baseDatabaseUrl(): string {
  const injected = process.env.DATABASE_URL;
  if (injected && /:55433\//.test(injected)) return injected;   // ← 硬编码端口正则
  const fromTestFile = parseEnvFile(
    readFileSync(path.join(repoRoot, '.env.test'), 'utf8'),      // ← 读未入仓的文件
  ).DATABASE_URL;
  ...
}
```

在 **CI（ubuntu-latest）** 里：
- `DATABASE_URL` = `postgres://v2ex:...@localhost:5432/v2ex_ci` → **不匹配** `/55433/`；
- `.env.test` **未入仓** → `readFileSync` 抛 **`ENOENT`**。

实测复刻（用不存在的 repo 路径模拟 CI）：

```
❌ 抛出异常: ENOENT | ENOENT: no such file or directory, open '...\no-env-test-repo\.env.test'
```

**结论**：`floor-continuity.spec.ts` 在 CI 上**必然失败**。上一轮「CI 绿灯」的结论要么来自该文件入库之前的运行，
要么来自未清理该文件的本地运行。**这必须在本次一并修复**——它是问题 A 的直接产物（把本机路径写死进测试）。

> ⚠️ **QA 的 190/190 全绿不能证明 CI 侧通过** —— QA 的实跑是**本机**（`ENV_FILE=.env.test` → 55433）。
> **CI 侧必须独立复验**（T05 验收标准 ②）。这是 Q7 建议登记为独立缺陷的原因。

#### 2.4.1 🔴 已由真实 CI 证实（QA 实测，2026-11-04）

**本节的判断已被真实 CI 完全证实，不再是推测。** QA 用 `git archive HEAD` 导出**纯净检出**
（= GitHub Actions 看到的 checkout）独立复现，并下载了真实 CI run `41836588566` 的 2567 行日志逐字比对。

**真实 CI 输出**：

```
 Test Files  1 failed | 14 passed (15)
      Tests  185 passed | 5 skipped (190)
Error: ENOENT: no such file or directory, open '/home/runner/work/v2ex-clone/v2ex-clone/.env.test'
 FAIL  tests/floor-continuity.spec.ts
```

**预测 5/5 命中**：失败文件、failed 数、skipped 数、ENOENT 路径、E2E 被跳过 —— 全部吻合。

#### 2.4.2 🔴 影响面比预期更广：**v0.0.4 的 153 条 E2E 在 CI 上从未执行过**

实测 CI 的 job 依赖结构（`ci.yml` L153-156）：

```yaml
  e2e:
    name: E2E 测试
    needs: unit          # ← unit 失败 → e2e 直接 skipped
```

| Job | 真实 CI 结果 |
|---|---|
| 类型检查 / 单元测试 | 🔴 **failure**（`floor-continuity` ENOENT） |
| Docker 构建与启动验证 | ✅ success |
| **E2E 测试** | ⏭️ **skipped** —— 被 `needs: unit` **连带跳过** |

> **这意味着 v0.0.4 的 153 条 E2E 在 CI 上至今一条都没跑过。**
> `floor-continuity` 不修 → `unit` 永远红 → `e2e` 永远 skipped → **拿不到任何 CI 侧的 E2E 证据**。
> **这是 T05「CI 侧独立复验」的硬前置**，也是本缺陷必须优先修的原因。

#### 2.4.3 影响面**只有这 1 个文件**（QA 核查，缩小了排查范围）

QA 核查了全部 15 个 spec 对 `.env.test` 的引用，结论：

| 文件 | 是否真读 `.env.test` | 说明 |
|---|---|---|
| `tests/floor-continuity.spec.ts` | ❌ **真读** | `readFileSync(path.join(repoRoot, '.env.test'))` → CI 上 ENOENT |
| `tests/seed-idempotency.spec.ts` | ✅ **不读** | grep 命中的第 48 行**只是注释**（「清空 ENV_FILE：避免继承 .env.test 的配置」）；实际只用 `process.env.DATABASE_URL`（第 35 行）→ CI 安全 |
| 其余 13 个 | ✅ 不读 | — |

> **纯净检出全量结果**：`1 failed | 14 passed (15)` / `148 passed`。
> （唯一另一个失败 `docker-config.spec.ts` 是 QA 纯净检出**没有 `.git` 目录**导致的本地伪影 ——
> 它执行 `git ls-files` 校验「原站素材不入库」；**Actions 的 checkout 有完整 `.git`，不会失败**。）

#### 2.4.4 ⚠️ 复验时的一个坑：只看 `Tests` 行会误判

真实 CI 输出是 `Tests 185 passed | 5 skipped (190)` ——
**只看 `Tests` 行会以为「185 条通过」**，实际是 **`1 failed + 5 skipped`**。
**必须看 `Test Files` 行**（`1 failed | 14 passed (15)`）。

> 这正是 R-23（关注用例静默跳过）修的那类**静默跳过** —— 同一个坑的第二次出现。

#### 2.4.5 🔴 修复方案：**必须与 T01 绑定，不能单独打补丁**

QA 提出的修复（已在纯净检出上实跑验证通过）：

```ts
function baseDatabaseUrl(): string {
  const injected = process.env.DATABASE_URL;
  if (injected) return injected;                    // 优先用环境变量（CI 走这条）

  const testFilePath = path.join(repoRoot, '.env.test');
  if (existsSync(testFilePath)) {                   // 本地兜底前先判存在
    const fromTestFile = parseEnvFile(readFileSync(testFilePath, 'utf8')).DATABASE_URL;
    if (fromTestFile) return fromTestFile;
  }
  throw new Error('无法解析隔离测试实例的 DATABASE_URL（环境变量与 .env.test 均缺失）');
}
```

QA 的验证结果：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| **CI**（`DATABASE_URL` 不含 `:55433/`、无 `.env.test`） | 🔴 ENOENT → `1 failed + 5 skipped` | ✅ **`5 passed (5)`** |
| **本地**（`.env.test` 存在） | ✅ 5 passed | ✅ **`5 passed (5)`**（无回归） |
| **反证**：`DATABASE_URL` 换成含 `:55433/` 的值 | — | 立刻 `1 passed` → 证明根因就是那个 `:55433/` 硬门 |

> ✅ **QA 的修复本身是正确的**，且**反证**做得很好（证明根因唯一）。

> ⚠️ **【2026-11-04 限定更正】** 本节描述的是**旧实现**的行为。
> 统一加载器落地后，**shell / CI 注入的 `DATABASE_URL` 现在能赢过 `ENV_FILE`**（§2.4.9 实测验证）——
> 「命令行 `DATABASE_URL` 完全无效」这句话**只对改造前的 6 个入口成立**。
> 引用本节时**必须带上这个限定**。
>
> 🔴 **但架构师实测发现一个 QA 未覆盖的危险情形：这个补丁单独打会导致本地测试连上开发库！**
>
> QA 验证的「本地」场景用的是 **`ENV_FILE=.env.test`**（已设环境变量），走的是第一分支。
> 但**本地默认路径（不设 `ENV_FILE`）**下，`tests/setup.ts` 会加载 `.env.local` → `DATABASE_URL` = `127.0.0.1:5432/v2ex`，
> 于是 `injected` **非空** → QA 的修复**直接返回 5432 开发库**！
>
> 实测复刻（架构师）：
> ```
> 【本地默认路径（无 ENV_FILE）】
>   当前 setup.ts 解析出 DATABASE_URL = postgres://v2ex:***@127.0.0.1:5432/v2ex
>   修复前 currentImpl() -> postgres://v2ex:***@127.0.0.1:55433/v2ex_e2e   ✅ 隔离实例
>   修复后 qaFix()       -> postgres://v2ex:***@127.0.0.1:5432/v2ex         ❌ 开发库！
> ```
>
> 而 `floor-continuity.spec.ts` 的 `beforeAll` 会拿这个 URL 去 **`DROP DATABASE IF EXISTS` + `CREATE DATABASE`**（L107-108）——
> **在开发库实例上建库**。虽然库名 `v2ex_floorcont_v004` 受护栏保护，但**在开发库上建库本身就该被禁止**。
>
> **结论：QA 的修复与 T01 是强依赖关系，必须绑定落地。**
> 实测验证（情形 D：T01 先落地 + QA 的修复）：
> ```
>   setup.ts 解析出 DATABASE_URL = postgres://v2ex:***@127.0.0.1:55433/v2ex_e2e
>   qaFix() -> postgres://v2ex:***@127.0.0.1:55433/v2ex_e2e   ✅ 隔离实例
> ```
>
> **最终处置**：**不要**在 T03 里单独给 `floor-continuity.spec.ts` 打这个补丁。
> 它应该**统一使用 T01 的 `tests/helpers/test-env.ts`**（§3.4 的统一解析 + 指纹），
> 由统一模块保证「shell > ENV_FILE > .env.test > .env.local」的优先级链，
> 并由 §3.5 的护栏拦住「指向开发库端点」的情况 —— **单一真源，不给单个文件开特例**。

#### 2.4.6 ✅ T01 已落地并通过独立验证（QA + 架构师三方确认）

**T01 已由 `software-engineer-testenv` 实施完成**（工作区），架构师与 QA 分别独立验证：

| 验证项 | 验证者 | 实测结果 |
|---|---|---|
| **护栏在 QA 那个危险场景下会拦截** | 架构师 | 用 `ENV_FILE` 指向含 5432 的文件 → `Error: [db-setup] 检测到单元测试试图使用开发实例端点 127.0.0.1:5432` 🛑 **正确拦截** |
| **CI 模拟不再抛 ENOENT** | 架构师 | `.env.test` 移走 + `DATABASE_URL`=5432 → `Error: [db-setup] PG 未就绪（127.0.0.1:5432）：connect ECONNREFUSED` ✅ **从「像代码缺陷」变成「明确的���境问题」** |
| **`.env.test` 自动生成安全** | 架构师 | 内容与原文件**逐字节一致**（27 行）；`git check-ignore` 确认被 `.gitignore:16` 覆盖 → **不会入库** |
| **优先级链正确** | QA + 架构师 | `shell > ENV_FILE > .env.test > .env`；`.env.local` **永不加载**；`ENV_FILE` 只填空位 |
| **实现完备性** | QA | 优先级链 / 只填空位 / `assertNotDevInstance()` / CI 例外 / 「PG 未就绪」分流 —— **全部到位，且比 QA 的单文件方案更完备** |

> ✅ **§4.6.3 分流表的实际效果得到验证**：同一个测试，修复前报 `ENOENT`（**看起来像代码缺陷**），
> 修复后报 `PG 未就绪 ... ECONNREFUSED`（**明确是环境问题**，并附 3 步排查指引）。

#### 2.4.7 💡 QA 的一个深刻观察：为什么「去掉硬门」必须与「护栏」同时落地

QA（`software-qa-ci`）指出：

> 「现状的 `:55433/` 硬门虽然形式上丑，但它恰好起到了**拒绝 5432 开发端点**的护栏作用 ——
> 即使 `.env.local` 被加载，它也会因为端点不匹配而落到 `.env.test`。」

**这揭示了三种状态的区别**：

| 方案 | CI | 开发库安全 | 评价 |
|---|---|---|---|
| **现状**（`:55433/` 硬门） | 🔴 挂 | ✅ 安全 | 「安全但 CI 挂」 |
| **QA 的单文件补丁** | ✅ 过 | 🔴 **可能打开发库** | 「CI 过但危险」 |
| **T01 统一封装 + 护栏** | ✅ 过 | ✅ 安全 | ✅ **唯一正确的方向** |

> **结论：「去掉硬门」必须和「护栏」同时落地，不能只做前半截。**
> 这解释了为什么单文件特例方案在 CI 侧能跑通、在本地却会打开发库 ——
> **它移除了硬门，却没有补上等效的护栏**。

#### 2.4.8 ⚠️ 当前阻断项已从「未修复」变为「未提交」

QA 曾报告「`floor-continuity.spec.ts` 至今未被任何提交修改（`git log` 仍只到 `1b15f79`）」。
**这句话对提交历史成立，但对工作区不成立** —— 架构师实测：

```
$ git status --short tests/
 M tests/floor-continuity.spec.ts          ← 工作区已改（44 insertions / 55 deletions）
$ git diff --stat tests/floor-continuity.spec.ts
```

**即**：`tests/` 下 9 个文件已改 + 6 个新文件（含 `tests/env/` 模板）**全部未提交**。

> 🔴 **CI 只看提交** —— **不提交 = CI 继续红 = `e2e` job 继续被 `needs: unit` 连带跳过
> = v0.0.4 的 153 条 E2E 在 CI 上继续一条都跑不了。**
> **阻断项已从「代码未修复」变成「改动未提交」。**

#### 2.4.9 ✅✅ 架构升级：统一加载器已落地，**档 1 的问题被根治**（不再需要 Q10）

`software-engineer-dotenv` 落地了 **`src/lib/env-loader.mjs`**（20186 字节，全仓唯一的产品侧加载器）。
**这让本设计 §3.2.0 的四档分法成为历史** —— 判定被收敛到**一个地方**。

**当前状态（架构师实测）**：

| 入口 | 状态 |
|---|---|
| `drizzle.config.ts` | ✅ 引用 `loadProductEnv` |
| `src/db/index.ts` | ✅ 引用 `loadProductEnv` |
| `scripts/seed.ts` | ✅ 引用 `loadProductEnv` |
| `scripts/admin-cli.ts` | ✅ 引用 `loadProductEnv` |
| `scripts/db-admin.mjs` | ✅ 引用 `loadProductEnv` |
| `tests/setup.ts` | ✅ 引用 `getResolvedTestEnv`（测试侧解析器） |

**关键判定函数**：`canOverrideByEnvFile(key, context)` —— **分层判定**，四条规则：

| 规则 | 条件 | 结果 | 实测 |
|---|---|---|---|
| ① | 测试运行时 | **绝不覆盖** | ✅ 验证 |
| ② | 非 Next 运行时（process.env 全来自 shell/CI） | **绝不覆盖** | ✅ 验证 |
| ③ | Next 运行时 + 拿得到 shell 快照 | 该键**不在**快照里 → 可覆盖（在 → 不可覆盖） | ✅ 验证 |
| ④ | Next 运行时 + 拿不到快照 | 退化为「占位值比对」 | ✅ 验证 |

**判定的可靠依据**：`@next/env` 在加载任何 env 文件**之前**会拍下 `initialEnv = { ...process.env }` ——
那是 **shell / CI 注入的原样快照**，因此能**精确区分**「shell 注入」与「文件占位」。

> 🧪 **实测验证（架构师独立复核，两个方向都成立）**：
> ```
> 场景1（Next 运行时 + shell 注入 DATABASE_URL）
>   shellSnapshot 有 DATABASE_URL? true
>   最终 DATABASE_URL = postgres://x/from_SHELL
>   shell 注入是否赢? ✅ 是
>
> 场景2（Next 运行时 + 只有 .env.local 占位 + ENV_FILE）
>   [Next 占位值] = postgres://v2ex:***@127.0.0.1:5432/v2ex
>   [loader 结果]  = postgres://x/from_ENVFILE
>   ENV_FILE 是否赢? ✅ 是（档1 需求达成）
> ```
> **两个方向同时成立** —— 这正是我原先认为「互相冲突、只能二选一」的那一对。
> **统一加载器用 `initialEnv` 快照把二选一变成了二者兼得。**

> ⚠️ **一个必须注意的实现细节**（deploy 已实测并写进代码注释）：
> 必须用 `createRequire()` **运行时** require `@next/env` ——
> 静态 `import '@next/env'` 会被 webpack 打包成**另一个模块实例**，其 `initialEnv` 恒为 `undefined`。
> **架构师实测确认**：`require('@next/env')` 两次得到同一实例（`a === b` 为 true），
> 而 `await import('@next/env')` 拿到的是**不同的 ESM 命名空间**（`c !== a`，但 `c.default === a`），
> 且 `c.initialEnv === undefined`。**这正是规则③会退化成规则④的原因** —— 代码里用 `createRequire(path.join(process.cwd(), ...))`
> 从 cwd 解析，确保拿到的是 Next 自己加载时用的**同一个模块实例**。

#### 2.4.10 🔴 对 §2.4.5 与 Q10 的**限定更正**（deploy 提示，架构师核实后采纳）

§2.4.5 里写的「`override: true` 让命令行 `DATABASE_URL` 失效」——
**这个结论现在只对「旧实现」成立，必须加限定**：

| 范围 | 现状 |
|---|---|
| 旧实现（改造前）的 6 个入口 | `ENV_FILE` 无条件覆盖 shell → 命令行 `DATABASE_URL` 失效 |
| **现实现**（统一加载器） | **shell / CI 注入的 `DATABASE_URL` 现在能赢过 `ENV_FILE`** ✅ |

> 📌 **所以「命令行 `DATABASE_URL` 在所有地方都无效」这句话在当前代码里已不成立。**
> 引用 §2.4.5 时**必须带上这个限定**，否则会误导后来者。

**Q10（根治档 1）的结论也随之变化**：
- Q10 问的是「如何让 `src/db/index.ts` 也接受 shell 优先」——
- **统一加载器已经做到了**（用 `initialEnv` 快照区分 shell 注入 vs 文件占位）
- → **Q10 关闭**，**不需要**另设 P2 方案。

> 🎯 **这是本轮最重要的架构结论**：
> 我原先判断「档 1 与档 2 互相冲突、只能二选一」的结论**是错的**。
> 真正的解法不是二选一，而是**用更精细的判据**（区分「shell 注入」与「文件占位」）同时满足两者。
> **四档分法是「在没有统一加载器时的最优解」，统一加载器才是「真解」。**

### 2.5 问题 B 的基线数据（实测）

| 项 | 实测值 |
|---|---|
| `data-v003` 总大小 | **1.4 GB** |
| `template1`（`base/1`） | **298 文件 / 7.5MB** |
| `template0`（`base/4`） | 298 文件 / 7.5MB |
| 已迁移库 `v2ex_v003_admin`（`base/427681`） | **455 文件 / 9.4MB** |
| `data-v003` 全库文件总数 | **10832**（含 `v2ex_loadtest` 的 891MB） |
| `v2ex_loadtest`（`base/279166`） | **891 MB**（`pg_database_size` 实测 `890 MB`） |
| `pg_wal` 目录 | 81 MB |
| 库总数 | 24（含 `postgres` / `template0` / `template1`） |
| **稳态 `CREATE DATABASE`** | **2083 ms**（主理人实测，**第三次勘误的核心基线**） |
| **稳态 `DROP + CREATE`** | **2277 / 1978 / 2243 ms**（主理人实测 3 次） |
| **稳态 checkpoint** | `total=0.053 s` / `total=0.158 s`（主理人实测） |
| **crash recovery 逐目录 fsync** | **70.01 s**（`pg-v003.log` 实测，20:29:51 一行） |

### 2.5.1 QA 全量实测基线（`097c1b9`，供验收对标）

> 来源：**QA（software-qa-ci）**，`ENV_FILE=.env.test`，**未改任何超时阈值**（120s 是既有值）。
> **基线归属已被 QA 严格证明**（见下方「基线归属证明」）。

| 项 | 实测值 |
|---|---|
| 用例总数 / 通过 / 失败 / 跳过 | **190 / 190 / 0 / 0** |
| 套件 | **53 / 53 passed** |
| 总耗时 | **3m35s = 215_000 ms** |
| 耗时集中度 | **97%** 的时间在 5 个「建库 + 迁移」文件上；其余 10 个文件合计 **~2100 ms** |

**逐文件耗时（ms）**：`content-lifecycle` 22230 / `admin-cli` 20838 / `seed-idempotency` 16302 /
`feed-search` 9981 / `db-lazy-init` 7417 / 其余 10 文件合计 ~2100。

#### 基线归属证明（QA 实测，回应架构师的 commit 基线疑问）

架构师曾担心「工作区有并发队友的未提交改动，190 对应的代码状态可能不是 `097c1b9` 的 HEAD」。
**QA 用三条独立证据证明 190/15 严格对应 `097c1b9`**：

| 证据 | 内容 |
|---|---|
| **A. mtime 时序** | 运行窗口 **20:36:39 – 20:40:14**；所有测试输入文件的 mtime **全部早于**该窗口（`tests/*.spec.ts` 最晚 18:18:34、`vitest.config.ts` 18:42:12、`drizzle.config.ts` 11-03 13:06:58）。唯一落在窗口内的是 `deploy/.env.example`（20:36:43） |
| **B. `deploy/` 不在测试输入路径** | `grep -rn "deploy/" tests/` → **只有一条注释**。`docker-config.spec.ts`（42 条用例）读的是 `docker-compose.yml` / `Dockerfile` / `scripts/*` / `.github/workflows/ci.yml` / `package.json` —— **全在仓库根** |
| **C. 工作区对测试输入零改动** | `git status --short -- tests/ src/ drizzle/ scripts/seed.ts scripts/verify.sh docker-compose.yml Dockerfile package.json .github/workflows/ci.yml` → **（空）** |
| **D. 三方交叉校验** | 日志 `Test Files 15 passed (15)` / `Tests 190 passed (190)`；JSON `numTotalTests:190, numPendingTests:0`；逐文件求和 = 190 —— **三方一致**（本轮有 3 条并行 vitest 后台任务，QA 专门做了此校验以排除「数字来自被覆盖的那次运行」） |

> ✅ **结论：190/15 可安全引用为 v0.0.4 基线。**

> ⚠️ **口径警示（QA 实测）**：**静态 grep `it(` 得出 180 是错的** —— 本项目用嵌套 for 循环生成用例，
> **运行时才是 190**。任何「用例数」口径都必须以**运行时**为准。
>
> ⚠️ **CLI 陷阱（QA 实测）**：`npx vitest run --reporter=basic` 在 **Vitest 5.0.5 下直接失败**
> （`basic` reporter 已移除）。可用等价命令：
> ```bash
> ENV_FILE=.env.test npx vitest run --reporter=default --reporter=json --outputFile=/tmp/vitest-results.json
> ```

### 2.5.2 🔴 CI 侧的实测基线（**红的**）—— 修复前的真实状态

QA 下载真实 CI run `41836588566` 的 2567 行日志解析所得：

| Job | 修复前真实 CI 结果 | 修复后预期 |
|---|---|---|
| 类型检查 / 单元测试 | 🔴 **failure** | ✅ success |
| Docker 构建与启动验证 | ✅ success | ✅ success |
| **E2E 测试** | ⏭️ **skipped**（被 `needs: unit` 连带） | ✅ **success** |

**修复前的 CI 输出（逐字）**：
```
 Test Files  1 failed | 14 passed (15)
      Tests  185 passed | 5 skipped (190)
Error: ENOENT: no such file or directory, open '/home/runner/work/v2ex-clone/v2ex-clone/.env.test'
 FAIL  tests/floor-continuity.spec.ts
```

> 🔴 **三个必须记住的结论**：
> ① `floor-continuity` 的 CI 崩溃**已被真实 CI 证实**，不再是推测；
> ② **153 条 E2E 在 CI 上从未执行过**（`e2e: needs: unit` 连带跳过）；
> ③ **只看 `Tests` 行会误判**（`185 passed | 5 skipped` 实际是 `1 failed + 5 skipped`）—— 必须看 `Test Files` 行。

### 2.6 问题 C 的基线（实测）

```
$ pg_isready -h 127.0.0.1 -p 55433
127.0.0.1:55433 - accepting connections      # 本次核查期间实例仍在运行

$ cat data-v003/postmaster.pid
11992
C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/data-v003
1793795512
55433
localhost
ready
```

`netstat` 实测 `127.0.0.1:55433 LISTENING (PID 11992)`。**候选测试端口 55434 / 55440 / 55444 / 55450 均空闲**。

---

## 3. 问题 A 的修复设计

### 3.1 设计原则

1. **单一真源**：环境解析只在一处实现，其余全部引用。不允许第二份 dotenv 加载序列。
2. **文件不覆盖 shell**：`process.env`（shell / CI 注入）**永远最高优先级**。当前 `ENV_FILE` 的 `override: true` 反转了这一顺序，是问题 A 的技术根。
   ⚠️ **但落地必须按文件分档**（§3.2.0）—— 6 个加载点的运行时处境不同，一刀切会在 `scripts/seed.ts` 上引入回归。
3. **子进程继承已规范化的 URL**：父进程算出**唯一** `DATABASE_URL`，子进程只允许继承，不再各自解析。
4. **默认即安全**：不设任何环境变量时，单元测试必须**连到隔离测试实例**或**明确报错**，绝不能落到开发库。

### 3.2 加载优先级规则（最终裁决）

| 优先级 | 来源 | 说明 |
|---|---|---|
| **1（最高）** | `process.env`（shell / CI / vitest `env`） | 已存在的变量**永不被文件覆盖** |
| **2** | `ENV_FILE` 指定的文件 | 仅填充**未设置**的变量 |
| **3** | `.env.test` | 仅单元/E2E 流程加载 |
| **4** | `.env.local` | **单元测试流程中永不加载** |
| **5（最低）** | `.env` | 容器 / 生产 |

**目标语义**：`ENV_FILE` 只提供「缺省值」，不覆盖已存在的环境变量 ——
这样「shell 显式设置的 `DATABASE_URL`」永远赢，符合 `scripts/env-dump.mjs` 注释里已经写明的设计意图
（那段注释描述的正是期望语义，只是实现没有对齐）。

#### 3.2.0 ⚠️ 落地细则：`override: true` 必须**按文件分档**，不能一刀切

> ✅ **【2026-11-04 状态更新】本节已被统一加载器取代，保留作为「演进留痕」。**
> `software-engineer-dotenv` 落地 `src/lib/env-loader.mjs` 后，
> **6 个入口的判定已收敛到一处**，四档分法**不再需要人工执行**。
> 下文的分档分析**仍然有效**（它记录了「为什么不能一刀切」的真实原因），
> 但**执行方式**变了 —— 由 `canOverrideByEnvFile()` 自动判定，见 §2.4.9。
>
> 📌 **一句话总结演进**：
> **四档分法 = 「没有统一加载器时的最优解」；统一加载器 = 「真解」。**
> 两者都正确，但后者让档 1 与档 2 **同时成立** —— 而四档分法只能二选一。

> **本节是经 `software-engineer-deploy` 同步后新增的关键修正。**
> 初稿写的是「统一去掉 `override: true`」—— 这个表述**不够精确**，
> 因为 6 个加载点的**运行时处境不同**，一刀切会在 `scripts/seed.ts` 上引入回归。

**背景：`override: true` 是历史遗留，不是设计意图。**
它由 `ae15715`（2026-11-03）引入，提交信息写明理由：

> 「Next.js 在应用代码之前已自动加载 .env / .env.production / .env.local，
> DATABASE_URL 等变量已被占位；dotenv 默认不覆盖已有值，**不加 override 的话 ENV_FILE 永远不生效**。」

**这个理由只对 Next.js 运行时成立。** 实测验证如下。

**实测 1：drizzle-kit 加载配置时 `process.env` 是干净的**

用一个抛错的假 config 让 drizzle-kit 打印它看到的 env：

```
ENV_FILE=.env.test npx drizzle-kit generate --config <probe>
  → PROBE_ENV={"DATABASE_URL":null,"ENV_FILE":".env.test"}
不设 ENV_FILE
  → PROBE_ENV={"DATABASE_URL":null,"ENV_FILE":null}
```

`DATABASE_URL` 是 `null` → **drizzle-kit 不预加载 `.env.local`**。

**实测 2：Next.js 确实预加载**（在 `node_modules/next/dist/compiled/next-server/server.runtime.prod.js` 中找到实际加载逻辑）：

```js
for (let e of [`.env.${f}.local`, "test"!==f && ".env.local", `.env.${f}`, ".env"].filter(Boolean)) {
  let t = i.join(a, e);   // 读取并写入 process.env
  ...
}
```

**实测 3：dotenv 两种语义对照（决定性）**

| 场景 | `override: true` | 无 `override` |
|---|---|---|
| **shell 已有** `DATABASE_URL` | ENV_FILE **赢**（shell 被压制）← 静默误跑的根源 | **shell 赢** ✅ |
| **shell 没有** `DATABASE_URL` | ENV_FILE 赢 | ENV_FILE **也赢**（ENV_FILE 先加载） |

> **关键推论**：在「shell 没有 `DATABASE_URL`」的情形下，
> **去掉 `override: true` 的行为完全不变**（都归 ENV_FILE）。
> 唯一改变的是「shell 已有」的情形 —— 而那**正是要修的静默误跑**。

**实测 4：`scripts/seed.ts` 的档 3 处置 —— ⚠️ 初稿结论已被推翻并修正**（见下方「档 3 修正」）

**因此三档处置表（落地依据）**：

| 档 | 文件 | 处置 | 依据 |
|---|---|---|---|
| **档 1：必须保留 `override`** | `src/db/index.ts` | **保留 `override: true`** | Next.js 运行时确实预加载 `.env.local`（实测 2）。去掉会让 ENV_FILE **真的**失效 |
| **档 2：安全去除** | `drizzle.config.ts`<br>`tests/setup.ts` | **去掉 `override: true`** | 实测 1（无预加载）+ 实测 3（shell 未设时行为不变，shell 已设时修正为 shell 赢） |
| **档 3：只需删除自身 override 调用**（**已修正**） | `scripts/seed.ts` | **删掉自己那行 `config({ path: ENV_FILE, override: true })`**（或改为不带 override）；<br>❌ **不要**动 `import 'dotenv/config'` | 见下方「档 3 修正」 |
| **档 4：不在本次范围** | `scripts/admin-cli.ts`<br>`scripts/db-admin.mjs` | **保持现状**（它们只在 `ENV_FILE` 被显式指定时使用，且由脚本自己控制） | 实测 1 同类（无 `dotenv/config` 预加载） |

#### 档 3 修正（`software-engineer-deploy` 质疑后独立复核，实测确认他是对的）

**初稿的档 3 结论是错的**，我写的是「去掉 `import 'dotenv/config'`，或把 ENV_FILE 的加载提到它之前」。
**deploy 指出这两个处置在 ESM 下都不成立**，我独立复核后**确认他是对的**：

**问题**：`scripts/seed.ts` 第 16-17 行会 import `../src/db/index`（= 档 1，**保留** `override: true`）：

```ts
import 'dotenv/config';
import { config } from 'dotenv';
import { sql as pgSql } from '../src/db/index';   // ← 档 1
import { db, schema } from '../src/db';
```

ESM 的 import **先全部求值、再执行本模块体**。因此 `src/db/index.ts` 的模块体
（其中那句 `config({ path: ENV_FILE, override: true })`）**在 `seed.ts` 的模块体之前就执行完了**，
`DATABASE_URL` **早已**被写成 ENV_FILE 的值。

**实测证据（忠实复刻 `seed.ts` 的 import 图，并真实「使用」`pgSql`/`db`/`schema`）**：

```
--- 场景A：shell 已设 DATABASE_URL=from_SHELL ---
  [进入 seed.ts 模块体] DATABASE_URL = postgres://x/from_ENVFILE   ← 档 1 抢先了
  [seed.ts 自己 config(override) 后] = postgres://x/from_ENVFILE
--- 场景B：shell 未设（.env 里有值）---
  [进入 seed.ts 模块体] DATABASE_URL = postgres://x/from_ENVFILE
  [seed.ts 自己 config(override) 后] = postgres://x/from_ENVFILE
```

**两个直接后果**：

1. ❌ **「把 ENV_FILE 的加载提到 `import 'dotenv/config'` 之前」做不到** ——
   ESM 的 import 声明会被**提升**到模块顶部，`import 'dotenv/config'` **必然**先于任何语句执行，
   调换语句顺序无法改变。
2. ✅ **`seed.ts` 自己那行 `override: true` 是冗余的** ——
   档 1 已经用 `override: true` 抢先写了**同一个值**，再去 override 一次毫无增益。

**「删掉自身 override」的零回归实测**：

```
--- 场景A：shell 已设 from_SHELL ---
  [模块体进入时] = postgres://x/from_ENVFILE
  [去掉自身 override 后] = postgres://x/from_ENVFILE
  [行为是否改变] = 未改变 ✅
  [ENV_FILE 是否仍赢] = 是
--- 场景B：shell 未设（.env 有值）---
  [模块体进入时] = postgres://x/from_ENVFILE
  [去掉自身 override 后] = postgres://x/from_ENVFILE
  [行为是否改变] = 未改变 ✅
  [ENV_FILE 是否仍赢] = 是
```

**两种场景下行为都完全不变** → 档 3 的处置是**零回归**的。

> ⚠️ **必须承认的语义落差**（deploy 指出，架构师认同）：
> 这样处理后，`seed.ts` 的行为**仍然是「ENV_FILE 赢过 shell」** ——
> 而这正是 QA 要修的「静默误跑」。
> **根因是档 1**：`src/db/index.ts` 的 `override: true` 是 Next.js 预加载逼出来的，
> 它会**连带**让所有 import 它的文件（`seed.ts` / `admin-cli.ts` / 全部测试的服务层）都变成「ENV_FILE 赢」。
>
> **因此本设计的取舍是**：
> - **真正要修的静默误跑是档 2 的两处**（`drizzle.config.ts` 是 QA **实际踩坑**的那个 —— 迁移写进了 `v2ex_e2e`）
> - **档 1 + 档 3 维持「ENV_FILE 赢」现状** —— 改动面最小、收益最大、零回归
> - **「彻底修掉档 1 的静默误跑」需要让档 1 也接受 shell 优先**，但那与 Next.js 预加载的事实直接冲突
>   → **列为 P2 议题**（需另设方案，例如在 Next.js 启动链路上显式清除 `process.env.DATABASE_URL` 再由 `ENV_FILE` 注入）
>
> 🧪 **复现时的一个坑（我踩了两次，值得记录）**：
> 写探针时若只是 `import { sql as pgSql } from './src/db/index'` 而**不实际使用** `pgSql`，
> **esbuild 会把该 import 当作未使用而消除掉** → `src/db/index.ts` 的模块体**根本不执行** →
> 探针会得出「档 1 没有抢先」的**错误结论**（我第一次就是这么错的）。
> **必须真实引用** `pgSql` / `db` / `schema`（真实 `seed.ts` 确实用了它们，见 L254/L260/L269 等），
> 探针结论才成立。**这是 deploy 的复核比我的初稿更可靠的原因。**

**为什么「档 2 的两处必须一起改」**：若只改 `tests/setup.ts` 而不改 `drizzle.config.ts`，
会出现「单测连的库」与「迁移连的库」不一致 —— **比现在更糟**。

**没有任何测试依赖「ENV_FILE 必须赢过命令行」**：实测 10 个建库 spec **全部显式清空 `ENV_FILE`**
（`ENV_FILE: ''`，共 13 处），模式恰恰相反 —— 清空 ENV_FILE 后用自己的 `DATABASE_URL`。
**所以档 2 的改动不会破坏任何现有测试**，且这批做法正是「父进程规范化 → 子进程继承」的雏形。

> **连带提示（不在本设计范围）**：`scripts/verify.sh` L72~L83 的注释声称
> 「必须清空 ENV_FILE，否则 .env.test 的 DATABASE_URL 会覆盖 shell 中显式设置的验证库连接串」。
> 档 2/档 3 落地后，这个 workaround 变成**多余但无害**，但**注释会变成误导**，需同步更新。

#### 3.2.1 QA 独立实测印证了这条裁决（重要外部佐证）

QA（`software-qa-ci`）在做迁移幂等验证时**独立踩到了** `override: true` 造成的静默陷阱：

```bash
$ ENV_FILE=.env.test DATABASE_URL=postgres://.../v2ex_qa_migidem_v004 npx drizzle-kit migrate
# 预期：迁移打到 v2ex_qa_migidem_v004
# 实际：迁移打到了 .env.test 里的 v2ex_e2e
```

证据（QA 实测）：

```
$ psql -d v2ex_qa_migidem_v004 -c "... pg_tables where schemaname='public'"
（空 —— 一张表都没有）
$ psql -d v2ex_e2e -c "... pg_tables where schemaname='drizzle'"
drizzle.__drizzle_migrations    ← 迁移跑到 v2ex_e2e 去了
```

**根因**：`drizzle.config.ts:4-9` 与 `tests/setup.ts:9-11` 是**同一个模式**：

```ts
if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true, override: true });   // ← 无条件覆盖
}
```

`override: true` 让 `ENV_FILE` 指向的文件**无条件覆盖**已存在的环境变量
→ **命令行传的 `DATABASE_URL` 在 `ENV_FILE` 存在时完全失效**。

**这条独立实测同时证明了两件事**：

1. ✅ **印证了本节裁决的正确性** —— 「shell > ENV_FILE」正是修掉这个陷阱所需的语义；
2. ✅ **印证了「只要 `ENV_FILE` 显式指向一个正确的文件，`.env.local` 的 5432 污染就会被彻底挡住」** ——
   这解释了 QA 为什么能拿到 **190/190 全绿**。

> **因此本设计补充一条明确要求**：
> `tests/setup.ts` 与 `drizzle.config.ts` 的加载语义**必须一起改**，
> 否则两处会打架（一处改成「shell 优先」、另一处仍是「文件优先」）。
> **这两处正是 T01 的独占文件**，不存在并行修改冲突。

> **QA 遇到的「以为在测试库跑、其实跑到别的库」是一类高危静默错误** ——
> 本设计的 **§3.4 指纹机制 + §3.5 两道护栏** 正是为了把它变成「显式失败」。
> QA 之所以能安全脱险，是因为本机 **5432 无监听**（连接会立刻 ECONNREFUSED 而不是静默走错）；
> **一旦 5432 上有实例，这个陷阱就会变成真正的数据损坏**。

> **边界说明（不变）**：本设计**不改** `src/db/index.ts` 与 `drizzle.config.ts` 的加载顺序**语义**（它们服务于 Next.js 生产构建，
> 生产构建时 `dotenv` 的行为由 Next.js 框架接管）。本设计新增一个**统一解析模块**
> `tests/helpers/test-env.ts`，
> **仅**被 `tests/setup.ts`、`drizzle.config.ts`、测试 helper 与新建的测试期脚本使用。
> `src/db/index.ts` 保持不变 —— 因为它读的是**进程环境变量**，只要父进程把 `DATABASE_URL` 规范化后写进
> `process.env`，它就会拿到正确的值。这正是「父进程规范化 → 子进程继承」的价值所在。
>
> ⚠️ **但 `drizzle.config.ts` 与 `tests/setup.ts` 必须一起改**（见 §3.2.1）——
> 这两处是 T01 的独占文件，不存在并行修改冲突。

### 3.3 `.env.test` 未入仓的解决方式（推荐方案）

**推荐：入仓一份无密模板 `tests/env/.env.test.example`，同时由 `tests/setup.ts` 在缺失时自动生成本地 `.env.test`。**

| 方案 | 评价 |
|---|---|
| **A. 入仓无密模板 + 本地自动生成**（**推荐**） | ✅ 模板**不含任何口令**（用 `${...}` 占位），入库不泄密；✅ 新克隆仓库**开箱可跑**（自动生成默认测试口令）；✅ 模板本身就是「哪些变量是测试专用」的文档；⚠️ 需要保证生成的 `.env.test` 落在 `.gitignore` 覆盖范围内 |
| B. 全部改为 CI 环境变量注入 | ❌ 本机开发无法复现 CI 的变量集；❌ 十几个变量（限流阈值、seed 口令、调试令牌）全靠 CI YAML 维护，**本地与 CI 漂移**风险高；❌ 与现有 `playwright.config.ts` / `e2e/global-setup.ts` 的 `.env.test` 读取路径冲突 |
| C. 入仓带真实口令的 `.env.test` | ❌ **违反仓库既有安全基线**（`.env.example` 明确写「本模板不提供任何可用的默认口令」） |
| D. 维持现状（不解决） | ❌ 正是 `floor-continuity.spec.ts` CI 崩溃的根因 |

**方案 A 的具体形态**：

```
tests/env/.env.test.example     ← 入仓，无密，只有变量名 + 占位符 + 注释
.env.test                        ← 本地生成，.gitignore 已覆盖（.gitignore:16）
```

生成规则：
- `.env.test` 已存在 → **不覆盖**（尊重本地已有配置）；
- 不存在 → 从模板复制，并**用本机测试口令**替换占位符（口令从 `TEST_DB_PASSWORD` 环境变量取，
  未设置时用**固定的、仅限本机的测试口令**，并在文件头写明「本文件仅用于本机测试，禁止用于生产」）；
- 生成时打印一行告警，指明口令来源。

> **为什么固定口令可接受**：该口令只存在于**本机隔离测试实例**上，绑定 `127.0.0.1`，
> 且该实例**不暴露任何真实数据**（`data-v003` 保持只读不参与）。它与生产/开发凭据**无交集**，
> 不构成「默认弱口令」风险 —— 与 `.env.example` 禁止的是**生产凭据**默认值。

### 3.4 父子进程目标一致性的可验证实现

核心机制：**父进程解析一次 → 规范化 → 写入 `process.env` → 子进程只继承，不解析**。

```ts
// tests/helpers/test-env.ts（新增）
export interface ResolvedTestEnv {
  /** 规范化后的测试库连接串（库名为占位库，由各 spec 替换） */
  databaseUrl: string;
  /** 目标 host:port */
  endpoint: string;
  /** 目标库名 */
  database: string;
  /** 连接指纹（不含口令），用于父子进程一致性校验 */
  fingerprint: string;
  /** 环境来源描述，用于日志 */
  source: string;
}

/** 生成不含口令的连接指纹：host:port/db + 用户名 */
export function fingerprintOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}@${u.username}`;
}
```

**校验机制（父 → 子）**：

```ts
// 父进程（tests/setup.ts）解析后：
process.env.DATABASE_URL = resolved.databaseUrl;
process.env.V2EX_DB_FINGERPRINT = resolved.fingerprint;   // 例如 127.0.0.1:55440/postgres@v2ex
```

```ts
// 子进程（drizzle-kit / tsx）启动前，断言继承到的指纹与父进程一致：
const childFp = fingerprintOf(process.env.DATABASE_URL!);
if (childFp !== process.env.V2EX_DB_FINGERPRINT) {
  throw new Error(
    `数据库目标不一致：父=${process.env.V2EX_DB_FINGERPRINT} 子=${childFp}`,
  );
}
```

由于子进程 env 里**显式带** `DATABASE_URL`（现有 `runDrizzleKit` / `runTsx` 已经这么做），
且 `ENV_FILE` 不再 `override`，**父子必然一致**。断言是**兜底**，不是主要保障。

**验证方法（可复核）**：

```
$ npm run test:unit -- --reporter=verbose 2>&1 | grep -E "DB_TARGET|指纹"
```

每个 spec 在 `beforeAll` 开头打印一行：

```
[db-target] file=tests/seed-idempotency.spec.ts host:port=127.0.0.1:55440 db=v2ex_seedtest fp=127.0.0.1:55440/v2ex_seedtest@v2ex
```

> **关键**：`host:port` 与 `db` 都必须打印，且**子进程**（`drizzle-kit migrate` / `tsx scripts/seed.ts`）
> 也要打印同一行（由 §4.5 的阶段日志实现）。人工比对即可确认一致。

### 3.5 防误连护栏（两道）

#### 护栏 1：连接前的白名单断言（硬失败）

新增 `tests/helpers/test-db-guard.ts`：

```ts
/** 允许的测试实例端点白名单 —— 值来自环境变量，默认仅本机隔离实例 */
const ALLOWED_ENDPOINTS = new Set(
  (process.env.TEST_DB_ALLOWED_ENDPOINTS ?? '127.0.0.1:55440,127.0.0.1:5432')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * 允许被 DROP / CREATE 的库名 —— **精确枚举**（不使用前缀通配）
 *
 * ⚠️ 为什么不用前缀通配：本设计初稿曾用
 *   `^v2ex_(test|v003|v004|floorcont|seedtest|rateclear|admintest|floortest)`
 * 这类前缀正则做清理筛选。**实测证明它会误伤证据库**：
 *   `v2ex_v004_audit` 命中 `v2ex_v004` 分支 → 会被删除，
 *   但它是 `docs/UPGRADE_RECOVERY_v0.0.4.md` §1.1 列出的**升级审计证据库**。
 * 因此改为**精确枚举 + 显式拒绝名单**双层判定（见下方 isDeletableTestDatabase）。
 */
const ALLOWED_DB_NAMES = new Set([
  'v2ex_admintest',
  'v2ex_v003_admin',
  'v2ex_v003_content',
  'v2ex_v003_credits',
  'v2ex_v003_feed',
  'v2ex_v003_reset',
  'v2ex_floorcont_v004',
  'v2ex_floortest',
  'v2ex_rateclear',
  'v2ex_seedtest',
  'v2ex_readiness_probe',   // §4.7.1 判据 B 的就绪探针库
]);

/** 新增测试库的保留前缀（比枚举更灵活，但必须带 `v2ex_test_` 前缀） */
const ALLOWED_DB_PREFIXES = ['v2ex_test_'];

/**
 * 证据库拒绝名单 —— **即使被前缀规则命中也一律拒绝删除**。
 *
 * 这些库是 v0.0.4 的一手证据：负载测试数据、升级基线、发布验证、
 * 视觉对照基线、E2E 用库、升级/恢复演练现场、QA 幂等验证现场。
 * **任何情况下不得由测试清理脚本删除。**
 */
const PROTECTED_DB_NAMES = new Set([
  'v2ex_loadtest',        // 890MB —— 负载测试数据（主理人明确「不可动」）
  'v2ex_v002_baseline',   // v0.0.2 → v0.0.4 升级验证基线
  'v2ex_release_v001',    // 发布验证证据
  'v2ex_visual',          // 视觉对照基线
  'v2ex_e2e',             // E2E 用库（主理人明确「不可动」）
  'v2ex_e2e_v004',        // E2E 用库（主理人明确「不可动」）
  'v2ex_upg_v004_fresh',  // 全新安装演练现场
  'v2ex_upg_v004_old',    // 旧版本升级源
  'v2ex_upg_v004_restore',// 备份恢复目标
  'v2ex_upgrade_src',     // 升级源库
  'v2ex_mig_idem',        // 迁移幂等验证现场
  'v2ex_mig_v004',        // 迁移验证现场
  'v2ex_v004_audit',      // 升级审计证据库
  'v2ex_qa_migidem_v004', // QA 迁移幂等验证现场
]);

/** 判定一个库名是否允许被测试清理脚本删除（唯一权威判定） */
export function isDeletableTestDatabase(dbName: string): boolean {
  // 第 1 层：拒绝名单优先 —— 证据库无条件豁免
  if (PROTECTED_DB_NAMES.has(dbName)) return false;
  // 第 2 层：精确枚举
  if (ALLOWED_DB_NAMES.has(dbName)) return true;
  // 第 3 层：保留前缀
  return ALLOWED_DB_PREFIXES.some((p) => dbName.startsWith(p));
}

export function assertSafeTestTarget(databaseUrl: string, dbName: string): void {
  const u = new URL(databaseUrl);
  const endpoint = `${u.hostname}:${u.port || '5432'}`;
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    throw new Error(
      `拒绝连接：端点 ${endpoint} 不在白名单 ${[...ALLOWED_ENDPOINTS].join(',')} 内。` +
      `单元测试绝不允许连接开发库或生产库。`,
    );
  }
  if (!isDeletableTestDatabase(dbName)) {
    throw new Error(
      `拒绝操作数据库 ${dbName}：不在允许的测试库清单内` +
      `（或属于受保护证据库，永不删除）。`,
    );
  }
}
```

**注意白名单里 `127.0.0.1:5432` 的取舍**：
- CI 的 unit job 用 `5432`（service container），**必须放行**，否则 CI 全红；
- 但放行 `5432` 意味着本机若在 5432 跑着开发库，护栏 1 **不会**拦截 —— 这由**护栏 2**兜底。

#### 护栏 2：库名强制（硬失败，跨端点生效）

护栏 2 **不依赖端点**，只看**库名**。主理人要求的形态是：

```
库名必须匹配 ^v2ex_(test|v003|v004|floorcont|seedtest|rateclear|admintest|floortest)
之一（或更严格的完整枚举），否则直接抛错中止。
```

**本设计采用比要求更严格的形态：精确枚举 + 证据库拒绝名单（双层）。**

> ⚠️ **实测证明：主理人给出的那个前缀正则本身有误伤风险。**
>
> 实测 `v2ex_v004_audit` 会命中其中的 `v2ex_v004` 分支 ——
> 而它是 `docs/UPGRADE_RECOVERY_v0.0.4.md` §1.1 列出的**升级审计证据库**。
> 前缀通配把「版本号前缀」误当成了「测试库命名空间」，
> 而 `v2ex_v004_` / `v2ex_upg_v004_` / `v2ex_mig_v004` / `v2ex_e2e_v004` 这些**证据库恰好都带版本号**。
>
> **因此最终实现是**（见上面的 `isDeletableTestDatabase()`）：
> - 第 1 层：`PROTECTED_DB_NAMES`（14 个证据库）→ **无条件豁免**
> - 第 2 层：`ALLOWED_DB_NAMES`（精确枚举 11 个测试库）+ `v2ex_test_` 保留前缀
>
> 这样既满足主理人「不匹配就抛错中止」的要求，
> 又比前缀正则**更安全**（前缀正则会误删证据库）。

> **同时覆盖 DROP**：所有 `DROP DATABASE` 调用点必须先过 `assertSafeTestTarget`。
> 这把「误删 `v2ex_v002_baseline` / `v2ex_v004_audit`」从「靠人记住」变成「代码级不可能」。

#### 护栏 3（附加）：CI 环境的实例归属校验

CI 的 `DATABASE_URL` 指向 `v2ex_ci`。护栏 2 的精确枚举**不含** `v2ex_ci` —— 会误伤 CI。
因此枚举必须**包含 CI 的库名**，或改成「显式允许名单 + 环境变量扩展」：

```
TEST_DB_ALLOWED_DATABASES=v2ex_ci,v2ex_release_unit,v2ex_release_e2e   # CI 注入
```

CI 的 `ci.yml` / `release.yml` 增加一行 env 即可。**不修改任何现有 CI 步骤**，只加 env。

> **注意**：CI 的库名走的是「**允许**名单扩展」，**不是**加入 `PROTECTED_DB_NAMES` ——
> 后者是给证据库用的，与 CI 的临时库语义相反。

### 3.6 `.env.local` 不被修改的保证方式

| 保证 | 实现 |
|---|---|
| 代码层 | 单元测试流程**不加载** `.env.local`（§3.2 优先级表第 4 级在测试流程中被跳过） |
| 配置层 | 新增的隔离 env 是**独立文件**（`tests/env/.env.test.example` → `.env.test`），与 `.env.local` 无共享行 |
| 实例层 | 隔离实例监听 **55440**，与 5432 的开发实例**端口不同、进程不同、数据目录不同** |
| 进程层 | `.env.local` 的 5432 实例**不在**隔离脚本的启动/清理清单里 |
| 审计层 | `tests/helpers/test-db-guard.ts` 的端点白名单让 5432 之外的一切连接失败；`.env.local` 里的 5432 只在 CI 通过白名单放行 |
| 流程层 | 任务分解中**不包含**任何写 `.env.local` 的步骤（§5 T01~T05 无一涉及该文件） |

> **额外保险**：`tests/setup.ts` 加载完成后打印 `process.env.DATABASE_URL` 的**脱敏指纹**；
> 若指纹的端点等于 `.env.local` 里 `DATABASE_URL` 的端点，**直接抛错中止**并提示
> 「检测到单元测试试图使用开发实例端点」。这条不依赖白名单配置，任何配置失误都能兜住。

### 3.7 受影响文件清单（问题 A）

| 文件 | 动作 | 说明 |
|---|---|---|
| `tests/setup.ts` | **改** | 改为调用统一解析模块；不再加载 `.env.local`；写入 `V2EX_DB_FINGERPRINT`；打印脱敏指纹；**去掉 `override: true`**（档 2，§3.2.0） |
| `tests/helpers/test-env.ts` | **新增** | 统一解析 + 规范化 + 指纹计算 |
| `tests/helpers/test-db-guard.ts` | **新增** | 白名单断言（端点 + 库名精确枚举 + 证据库拒绝名单） |
| `tests/helpers/local-bin.ts` | **改** | `runDrizzleKit` / `runTsx` 增加指纹一致性断言；统一注入子进程 env |
| `drizzle.config.ts` | **改** | **去掉 `override: true`**（档 2）；改为「先读 `process.env.DATABASE_URL`，为空才读文件」 |
| `scripts/seed.ts` | **改（档 3）** | **只删掉自己那行 `config({ path: ENV_FILE, override: true })`**（或改不带 override）。❌ **不要**动 `import 'dotenv/config'`，也不要试图「提前加载 ENV_FILE」—— ESM import 提升使 `../src/db/index`（档 1）**先**执行并已用 override 抢先写入 ENV_FILE 的值，自身 override 属**冗余**（§3.2.0「档 3 修正」）。**必须与档 2 一起验证** |
| `src/db/index.ts` | **不改（档 1）** | Next.js 运行时确实预加载 `.env.local`，这里的 `override: true` **有真实作用，必须保留**。可只补一条注释说明它与其它五处的差异 |
| `scripts/admin-cli.ts` / `scripts/db-admin.mjs` | **不改（档 4）** | 保持现状；只在 `ENV_FILE` 被显式指定时使用，由脚本自己控制 |
| `tests/env/.env.test.example` | **新增** | 无密模板（入仓） |
| `.gitignore` | **可能改** | 确认 `tests/env/` 下生成物被忽略（默认 `.env.test` 规则已覆盖根目录，需确认子目录） |
| 10 个建库 spec | **改** | 统一改用 `testDatabaseUrl()` helper + 护栏 + 阶段日志 |

> **档位与所有权**：档 2 的 `drizzle.config.ts` + `tests/setup.ts` 属 T01（架构师设计 + 工程师实现）；
> 档 3 的 `scripts/seed.ts` **建议与 T01 合并成一次改动**（同一批 env 语义文件，分两次改容易打架），
> 但需确认该文件**不在其它 teammate 的所有权范围内** —— 若已被占用，则拆为独立任务并明确先后顺序。
>
> 📌 **档 3 的处置在 `software-engineer-deploy` 复核后已修正**（§3.2.0「档 3 修正」）：
> `scripts/seed.ts` **只需删掉自己那行 `config({ path: ENV_FILE, override: true })`**，
> **不要**动 `import 'dotenv/config'` —— 因为它 import 的 `../src/db/index`（档 1）会**先**执行，
> 已用 override 抢先写入了 ENV_FILE 的值，自身 override 属**冗余**。
| `tests/floor-continuity.spec.ts` | **改（必须）** | 删除硬编码 `:55433/` 正则与 `.env.test` 读取（CI 崩溃根因） |

---

## 4. 问题 B 的修复设计

### 4.1 方案选型

> ⚠️ **前提修正（第三次勘误的直接影响）**：主理人实测证明 **稳态 `CREATE DATABASE` ≈ 2.0~2.3s**，
> 因此**本节不存在「性能修复」方案** —— 需要的不是把 38.6s 压下去，
> 而是**保证 PG 处于稳态**并**把「未就绪」与「真超时」区分开**。
> 下表中 S1 的价值被重新定义为 **隔离性 + 可复现性**，S5 降级为**可选优化**而非「根治点」。

| 方案 | 真实价值 | 代价 | 结论 |
|---|---|---|---|
| **S1. 独立全新实例（独立数据目录 + 独立端口）** | **隔离性**：不与 24 库实例（含 890MB 压测库、E2E 库）争抢连接与 I/O，`DROP DATABASE` 不在 24 库实例上做<br>**可复现性**：数据目录 < 200MB、库集合固定、永远是干净新实例<br>**稳态性**：不受大实例恢复期积压影响 | 需 `initdb` 一次（约 30~60s，一次性） | ✅ **采纳（基线方案）**<br>⚠️ **定位是隔离，不是性能** |
| **S2. 复用现有实例 + `template1` 预置迁移** | 省掉 migrate 的 ~5.4s | 需改 10 个 spec 的建库流程；<br>⚠️ **在隔离实例上 migrate 本来就不是瓶颈** | 🔻 **降级为 P2 可选**（净收益需实测，见 §4.8） |
| **S3. `fsync=off`** | 消除 fsync 成本 | 掩盖 durability 行为；若实例被误用会静默丢数据 | ❌ **不采纳**（稳态 2s 根本不需要） |
| **S4. 提高全局超时** | 只是让测试「不超时」 | 掩盖真实问题；CI 与本机行为分叉 | ❌ **不采纳**（§4.6 —— 120s 是**保险**不是**修复**） |
| **S5. 把实例放到更快的盘** | fsync 5ms → 亚毫秒 | 需要第二块盘 | 🔻 **降级为 P2 可选**（本机仅一块 C 盘，`Get-Volume` 实测） |
| **S6. PG 就绪态检测 + 稳态判据**（**新增**） | **把「PG 恢复中 / 未就绪」与「真超时」区分开**，防止环境问题被误判为产品缺陷 | 需在启动流程里加探活与空库往返 | ✅ **采纳（P0 必做）** —— 见 §4.7.1 |

### 4.1.1 QA 全量实测对方案选型的修正（重要）

QA（`software-qa-ci`）在 `097c1b9` 上用 `ENV_FILE=.env.test` 实跑完整单测：
**190/190 全绿，0 skipped，总耗时 3m35s**（**未改任何超时阈值**，120s 是既有值）。

**耗时分布（QA 实测）**：

| 文件 | 耗时(ms) | 用例数 |
|---|---:|---:|
| `content-lifecycle.spec.ts` | 22230 | 13 |
| `admin-cli.spec.ts` | 20838 | 11 |
| `seed-idempotency.spec.ts` | 16302 | 8 |
| `feed-search.spec.ts` | 9981 | 12 |
| `db-lazy-init.spec.ts` | 7417 | 5 |
| **其余 10 个文件合计** | **~2100** | 100 |

**97% 的时间花在 5 个「建库 + 跑迁移」的文件上**；其余 100 条用例合计仅 2.1s。

**这组数据的三重影响**：

1. ✅ **「超时」问题在稳态下不复现** —— 与主理人的 2.0~2.3s 稳态实测**互相印证**：
   建库 2s + migrate 5s ≈ 7s，远低于 30s 阈值。**38.6s 那一轮确实是恢复期异常态。**
2. ⚠️ **但代价依然存在**：3m35s 的总耗时里，**5 个文件反复做「建库 + migrate」是主要开销**。
   这不是「超时」问题，而是**重复劳动**问题 —— 值得优化，但**优化方向不是「独立实例」**。
3. 💡 **优化方向（可选，P2）**：把这 5 个文件的建库 + 迁移提到**共享 `globalSetup`** 里做一次，
   各 spec 只做数据准备。预期总耗时可从 3m35s 降到 **~1m 以内**。

> **对 T01~T05 优先级的影响**：S6（就绪态检测）与阶段耗时日志从「可选」升为 **P0 必做**；
> S2（模板预置迁移）从「采纳」降为 **P2**；**新增 T06（P2）**：共享 `globalSetup` 优化建库开销。
> **注意**：QA 明确表示该优化属 `tests/**` 改动，**未自行实施**，等本设计的 T03 一并处理。

### 4.2 独立测试实例的初始化（复用现有 PG 17.5 二进制）

**二进制路径（复用，不重新下载）**：
```
C:/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pgsql/bin/
```
实测 `postgres.exe --version` → `postgres (PostgreSQL) 17.5`。

**数据目录命名规范**：

| 用途 | 路径 | 处置 |
|---|---|---|
| 现有（压测 / 基线证据） | `_tools/pgsql/data-v003` | **只读保留，永不 initdb 覆盖、永不清空** |
| 旧实例（历史） | `_tools/pgsql/data` | 只读保留 |
| **新隔离测试实例** | `_tools/pgsql/data-test-v004` | **本设计新建，唯一可写实例** |
| E2E 实例（若需要独立） | `_tools/pgsql/data-e2e-v004` | 可选，默认仍用测试实例 |

**端口规范**：

| 用途 | 端口 | 状态 |
|---|---|---|
| 开发库（`.env.local`） | **5432** | **不得触碰** |
| 现有压测 / 基线实例 | 55433 | 只读保留（E2E 与历史验证可能还要用） |
| **新隔离单元测试实例** | **55440** | 实测空闲（`netstat` 确认 55434/55440/55444/55450 均 FREE） |
| 备用 | 55444 / 55450 | 备用 |

> **为什么选 55440 而不是 55434**：与 55433 成组，便于 `netstat` 上一眼分辨「测试实例族」
> 与「历史实例族」；同时避开 55434~55439（留给未来的 e2e / 压测实例）。

**完整初始化命令（Windows / Git Bash）**：

```bash
#!/usr/bin/env bash
# 初始化 v0.0.4 隔离单元测试实例 —— 一次性脚本，幂等
set -euo pipefail

BASE="C:/Users/TYMO001/WorkBuddy/ai"
PGBIN="$BASE/_tools/pgsql/pgsql/bin"
PGDATA="$BASE/_tools/pgsql/data-test-v004"
PORT=55440
LOG="$BASE/_tools/pgsql/pg-test-v004.log"
PGUSER="v2ex"

# ── 幂等守卫：已初始化则直接退出 ──────────────────────────────────────
if [ -f "$PGDATA/PG_VERSION" ]; then
  echo "[init] 已存在实例 $PGDATA（PG_VERSION=$(cat "$PGDATA/PG_VERSION")），跳过 initdb"
else
  # ── 安全守卫：绝不允许指向 data-v003 / data ─────────────────────────
  case "$PGDATA" in
    *data-v003*|*/data"|*data-v003/*)
      echo "拒绝：PGDATA 指向受保护目录：$PGDATA" >&2; exit 1;;
  esac

  # ── 口令来源：占位符，实际值来自环境变量或本机固定测试口令 ──────────
  # 说明：口令不写入本文件，也不写入版本控制；仅供本机隔离实例使用。
  PW="${TEST_DB_PASSWORD:-v2ex_test_password_local_only}"
  PWF="$(mktemp -t pgpw.XXXXXX)"
  printf '%s' "$PW" > "$PWF"
  chmod 600 "$PWF"

  "$PGBIN/initdb.exe" \
    -D "$PGDATA" \
    -U "$PGUSER" \
    --pwfile="$PWF" \
    -E UTF8 \
    --locale="Chinese (Simplified)_China.936" \
    --data-checksums \
    -c "listen_addresses=127.0.0.1" \
    -c "port=$PORT" \
    -c "unix_socket_directories=" \
    -c "fsync=on" \
    -c "shared_buffers=32MB" \
    -c "max_wal_size=256MB" \
    -c "checkpoint_timeout=5min" \
    -c "log_checkpoints=on" \
    -c "log_min_duration_statement=2000"

  rm -f "$PWF"
  echo "[init] initdb 完成：$PGDATA"
fi

# ── 启动 ──────────────────────────────────────────────────────────────
"$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "$LOG" -o "-p $PORT" -w start
"$PGBIN/pg_isready.exe" -h 127.0.0.1 -p $PORT -U "$PGUSER"
echo "[init] 隔离测试实例就绪：127.0.0.1:$PORT"
```

#### Windows 注意事项（逐条）

| 项 | 说明 |
|---|---|
| **`-U` 必须显式给** | Windows 上 `initdb` 默认超级用户名取自 **Windows 登录账号**（本机为 `TYMO001`）。不显式指定会导致后续 `psql -U v2ex` 连不上。上面固定 `-U v2ex`。 |
| **`--pwfile` 而非 `-W`** | `-W`（`--pwprompt`）会**交互式提示**，在非交互 Bash 里必然挂死。必须用 `--pwfile=<file>`。 |
| **口令文件的删除** | `--pwfile` 读完后**不会自动删除**，脚本必须显式 `rm -f`（上脚本已做）。 |
| **`--locale` 的实测坑** | 实测：`--locale="Chinese_Simplified_China.936"` → `initdb: error: invalid locale name`；`--locale="Chinese (Simplified)_China.936"` → **通过**，但会打印 `Encoding "GBK" implied by locale is not allowed as a server-side encoding. The default database encoding will be set to "UTF8" instead.` —— 这与现有实例**完全一致**（实测现有实例全部库为 `UTF8` + `Chinese (Simplified)_China.936`），因此 **`-E UTF8` + 该 locale 能得到与现有实例同构的新实例**。 |
| **不要用 `--locale=C`** | 实测 `--locale=C` 会把默认编码设成 **`SQL_ASCII`**（`The default database encoding has accordingly been set to "SQL_ASCII"`），与现有实例的 `UTF8` **不一致**，会导致中文排序规则差异。 |
| **不要用 `--no-locale` / `--builtin-locale`** | 会丢失中文排序规则，与现有实例不一致。 |
| **`unix_socket_directories=`** | Windows 无 Unix socket，显式置空可消除启动告警。 |
| **`--data-checksums`** | 可选但推荐：新实例开数据校验，便于在 fsync 异常时暴露静默损坏。**代价**：约 5%~10% 性能开销，对测试实例可接受。 |
| **路径必须用正斜杠或双反斜杠** | Git Bash 下 `C:/Users/...` 形式最稳；`initdb.exe` 与 `pg_ctl.exe` 都接受。 |
| **`pg_ctl start -w`** | `-w` = 等待启动完成，脚本必须加，否则后续 `pg_isready` 可能抢跑。 |
| **不要对 `data-v003` 执行 `initdb`** | `initdb` 拒绝非空目录（实测：`directory "..." exists and is not empty`），但**加显式 `case` 守卫**更安全 —— 防止未来有人改路径时误伤证据。 |

#### 角色与口令策略

| 项 | 决策 |
|---|---|
| 超级用户名 | `v2ex`（与现有实例一致，避免脚本里出现两套用户名） |
| 口令 | **占位符**：脚本用 `${TEST_DB_PASSWORD:-v2ex_test_password_local_only}`。**本文档不写任何真实口令**；实际口令来源是①调用方环境变量 `TEST_DB_PASSWORD`，②否则用**固定的本机测试口令**（该实例只监听 `127.0.0.1`、只承载一次性测试库、**不与任何真实数据同目录**）。 |
| 口令落盘 | **不落盘**。`initdb` 用 `--pwfile` 读入后立即删除临时文件。 |
| `.env.test` 中的口令 | 由 §3.3 的模板生成机制写入本地 `.env.test`（该文件被 `.gitignore` 覆盖）。 |
| 权限收敛（可选，P2） | 测试实例可把 `v2ex` 降级为 **非超级用户 + `CREATEDB`**：`REVOKE SUPERUSER FROM v2ex;` —— 但 **`pg_trgm` 扩展需要超级用户或 trusted 标记**（实测 `pg_trgm` 在 `template1` 中 `available`、`installed_version` 为空；已迁移库中为 `pg_trgm 1.6`），降级前**必须**先 `ALTER EXTENSION pg_trgm UPDATE` 或确认 trusted。**因此 P0 阶段保持超级用户不变**，P2 再评估。 |

### 4.3 旧实例 `data-v003` 的处置（明确）

| 项 | 决策 |
|---|---|
| `initdb` 覆盖 | **绝对禁止**。脚本用 `case` 守卫硬拦截。 |
| 清空 / 删除 | **绝对禁止**。 |
| `DROP DATABASE` | 仅当库名命中 §3.5 的精确枚举时才允许。`v2ex_loadtest` / `v2ex_v002_baseline` / `v2ex_release_v001` / `v2ex_visual` / `v2ex_e2e*` **均不在枚举内** → 一律拒绝。 |
| 用途 | 保留为 v0.0.4 的**压测数据 + v0.0.2 升级基线**一手证据。 |
| 与新实例的关系 | **完全独立**：不同数据目录、不同端口、不同进程。 |

### 4.4 fsync 成本：真实存在，但不是 38.6s 的成因（P2 可选优化）

实测 `pg_test_fsync`（在与 PG 数据目录**同一卷**上）：

```
open_datasync      9230.885 ops/sec     108 usecs/op
fdatasync           200.068 ops/sec    4998 usecs/op      ← Windows 走这条
fsync               201.173 ops/sec    4971 usecs/op
```

对比 Linux NVMe 典型值 **50~200 usecs/op**，本机 **慢约 25~100 倍**。
同时实测顺序写吞吐 **392.6 MB/s**（8MB × 8 轮 + fsync）—— **带宽没问题，是「每文件 fsync 的往返延迟」有问题**。

**必须说清的边界**：这个 5ms 的 fsync 成本**确实存在**，
但它**不是** 38.6s 的成因 —— 因为**稳态下建库只需 2.0~2.3s**（主理人实测），
而 copydir+fsync 全流程探针实测也只要 **1633ms**。两者一致。

**那 21s~147s 的慢 checkpoint 从哪来？** 它们**全部落在 crash recovery / I/O 积压窗口内**
（19:16~19:31 与 20:28~20:31 两段），而非稳态（稳态 checkpoint 实测 `total=0.053s / 0.158s`）。
**在高积压态下，5ms 的 fsync 延迟会被排队放大数十倍** —— 这正是 38.6s 的形成机制。

> **一句话**：fsync 5ms 是**本机存储的特性**，不是 bug；它只在**积压态**下才被放大成灾难。
> **对策不是换盘（治标），而是保证 PG 处于稳态（治本）** —— 见 §4.7.1。

**因此，下表全部降级为 P2 可选优化**（**不作为本设计的必做项**）：

| 级别 | 方案 | 预期 | 成本 | 现状 |
|---|---|---|---|---|
| **P2-a** | 测试实例数据目录放到 **另一块物理盘 / SSD 挂载点**（本机仅一块 C 盘 NVMe，`Get-Volume` 实测只有 `C`） | fsync 5ms → 亚毫秒 | 需要第二块盘 | 🔻 可选 |
| **P2-b** | 用 **WSL2 内的 PostgreSQL** 或 Docker Desktop 的 Linux 容器卷 | 同上 | 本机 Docker **NOT FOUND**（`docs/UPGRADE_RECOVERY_v0.0.4.md` 已记录），需先装 | 🔻 可选 |
| **P2-c** | 测试实例走 **CI**（Linux + postgres:17-alpine，CREATE DATABASE 毫秒级） | 同上 | **零本机成本** —— 已在用 | ✅ **建议采纳为全量口径**（见 §4.6.2） |
| **P2-d** | 本机实例用 `synchronous_commit=off` | 减少每次提交等待 | ⚠️ 降低 durability | ❌ 不采纳 |

> **P0 阶段的明确结论**：用 §4.2 的独立实例 + §4.5 的阶段日志 + §4.7.1 的就绪态判据，
> **不需要**任何换盘动作。**先拿到本机真实基线数字**，再决定是否值得做 P2。

### 4.5 阶段耗时日志（可实现的具体形态）

在 `tests/helpers/test-db-guard.ts`（或新建 `tests/helpers/test-db-lifecycle.ts`）中提供统一的生命周期封装：

```ts
export interface DbPhaseTiming {
  file: string;
  db: string;
  endpoint: string;
  dropMs: number;
  createMs: number;
  migrateMs: number;
  seedMs?: number;
  totalMs: number;
}

/** 执行 DROP → CREATE → migrate（→ seed），逐阶段计时并输出结构化日志 */
export async function provisionTestDatabase(opts: {
  file: string;
  db: string;
  adminUrl: string;
  migrate: () => void;      // 跑 drizzle-kit migrate
  seed?: () => void;        // 可选，跑 seed
}): Promise<DbPhaseTiming> { /* ... */ }
```

**日志格式（单行 JSON，便于 grep 与归档）**：

```
[db-phase] {"file":"tests/seed-idempotency.spec.ts","db":"v2ex_seedtest","endpoint":"127.0.0.1:55440","dropMs":1204,"createMs":2130,"migrateMs":5380,"seedMs":4120,"totalMs":12834}
```

**每个建库 spec 的 `beforeAll` 改为**：

```ts
beforeAll(async () => {
  await provisionTestDatabase({
    file: 'tests/seed-idempotency.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlFor(TEST_DB),
    migrate: () => runDrizzleKit(['migrate'], childEnvFor(TEST_DB)),
  });
}, 120_000);
```

**配套的子进程日志**（`runDrizzleKit` / `runTsx` 内）：

```
[db-child] {"tool":"drizzle-kit","args":["migrate"],"endpoint":"127.0.0.1:55440","db":"v2ex_seedtest","fp":"127.0.0.1:55440/v2ex_seedtest@v2ex"}
```

> 这两行合起来就是 §3.4 要求的「父子进程目标一致性」的**人工可核验证据**：
> 两行的 `endpoint` / `db` / `fp` 必须完全一致。

### 4.6 超时策略（分层，**不靠提高全局阈值**）

#### 4.6.1 各层设置

| 层级 | 设置 | 依据 |
|---|---|---|
| **全局 `testTimeout`** | **保持 30_000 不变** | 单元用例本身的合理上限；不变则**不掩盖**慢建库问题 |
| **全局 `hookTimeout`** | **保持 120_000 不变**（**修正**：不再回落 60s） | 120s 是**宽松保险**，不是修复。<br>**修正理由**：主理人实测稳态建库 **2.0~2.3s**、QA 实测全量 **190/190 全绿 3m35s** —— 说明 120s 有**充足余量**。<br>⚠️ **但**：120s 这个值的**原始理由（掩盖 38.6s）已不成立**，必须**改写注释**，否则下一个人会以为它是「已验证的必要值」而不敢调整 |
| **单文件 `beforeAll` 超时** | **显式 `beforeAll(fn, 120_000)`** | 只给**确实需要建库**的 10 个文件；超时信息会明确指出是哪个阶段（配合 §4.5 阶段日志） |
| **`afterAll` 超时** | 显式 `afterAll(fn, 60_000)` | DROP + 关闭连接 |

> **关于「回落 60s」的撤回说明**：架构师初稿曾建议把 `hookTimeout` 从 120s 收紧到 60s，
> 理由是「120s 是为掩盖 38.6s 而提的」。**该建议现予撤回** ——
> 因为实测证明稳态根本用不到 30s，而 QA 已经证明 120s 下 190/190 全绿；
> 此时再动阈值属于**无收益的风险动作**，且会让 CI 少一分保险。
> **真正要做的是改写 `vitest.config.ts` 里那段已过时的归因注释**（T04 的必做项）。

#### 4.6.2 验收口径（用实测基线，不用拍脑袋）

| 指标 | 实测基线 | 验收阈值 |
|---|---|---|
| 单次 `CREATE DATABASE`（稳态） | **2083 ms**（主理人实测） | **< 10_000 ms** |
| `DROP + CREATE`（稳态） | **1978 / 2243 / 2277 ms**（主理人实测 3 次） | **< 15_000 ms** |
| `drizzle-kit migrate` | ~5.4s | **< 15_000 ms** |
| 单文件建库总计（`dropMs+createMs+migrateMs`） | — | **< 15_000 ms**（约 3 倍余量） |
| 单文件全流程（+seed） | — | **< 30_000 ms** |
| 全量 190 条 | **3m35s = 215_000 ms**（QA 实测） | **< 300_000 ms** |

> **判定规则**：任何一项超标，**禁止**继续调大超时 —— 必须走 §4.7 的排查流程。
> **若超标的首要怀疑对象是「PG 未进入稳态」**（见 §4.7.1），**不是**产品代码变慢。

#### 4.6.3 「PG 未就绪」与「真超时」的区分（**防误判的关键**）

这是主理人明确要求的：**把环境问题误判成产品缺陷，是最贵的错误**。

| 现象 | 判定 | 处置 |
|---|---|---|
| `ECONNREFUSED`（连不上） | **PG 未启动 / 端口错** | 查端口、查 `pg_isready`、查生命周期脚本 |
| 连接成功但 `CREATE DATABASE` 卡住 > 10s | **PG 处于 recovery / I/O 积压态** | 查日志的 `syncing data directory (fsync)` 与 `redo` 段；**等稳态后重测** |
| 日志出现 `数据库系统未正确关闭，正在自动恢复状态` | **crash recovery 中** | **必须等待恢复完成**（1.4GB 实例实测需 70s+），期间测得的任何耗时数字**均不可采信** |
| `beforeAll` 超时，且阶段日志显示 `createMs` 正常 | **真问题**（migrate/seed 慢） | 按产品缺陷处理 |
| `beforeAll` 超时，且阶段日志显示 `createMs` 异常大 | **环境问题** | 按 §4.7.1 处置，**不记为产品缺陷** |

### 4.7 若在干净实例上 `CREATE DATABASE` 仍超阈值

按顺序执行，每步都有明确的判定输出：

| 步骤 | 命令 / 动作 | 判定 |
|---|---|---|
| **0. 先查是否 recovery 中**（**新增，最优先**） | `grep -a "syncing data directory\|redo 开始\|正在自动恢复" <日志>` | **若处于 recovery → 停止排查，等待稳态后重测**。38.6s 那一轮正是此情形 |
| **1. 确认落点正确** | `pg_isready -h 127.0.0.1 -p 55440`；`psql -c "show data_directory"` | data_directory 必须是 `data-test-v004`，**不是** `data-v003` |
| **2. 确认实例是空的** | `psql -c "select count(*) from pg_database"` | 应为 `3`（postgres / template0 / template1）。**> 3 说明落错了实例** |
| **3. 空库建删往返（稳态判据）** | 建一个临时库 → 立刻 DROP → 计时 | **应 < 10s**（稳态实测 2.0~2.3s）。这是「PG 已进入稳态」最直接的判据 |
| **4. 量化 fsync 成本** | 在数据目录所在卷跑 `pg_test_fsync.exe -s 3` | `fdatasync` ≈5000 usecs/op 是**本机常态**（非异常）。仅当它**显著偏离 5ms** 时才说明存储状态异常 |
| **5. 量化 checkpoint 干扰** | `psql -c "select * from pg_stat_bgwriter"` + `grep checkpoint <日志>` | 稳态 checkpoint 应在 **< 1s**（实测 `total=0.053s / 0.158s`）。若看到 20s+ → 又处于积压态 |
| **6. 排除 WAL 回收** | `du -sh data-test-v004/pg_wal`；`select * from pg_stat_wal` | WAL 目录异常大 → 调 `max_wal_size` / `min_wal_size` |
| **7. 隔离单变量** | 只跑 `CREATE DATABASE` 一条语句，计时 | 若仍 > 10s 而步骤 3~5 都正常 → 检查 `full_page_writes` / 杀毒软件 / 磁盘队列 |
| **8. 检查排除软件** | `Get-MpComputerStatus`（本轮实测：`RealTimeProtectionEnabled=False`、`AMRunningMode=Not running` → **无 Defender 干扰**） | 若在其他机器上有杀软实时防护，需把数据目录加白名单 |
| **9. 决定降级路径** | 若 1~8 全部正常但仍慢 → **把全量单测复验放到 CI**（P2-c），本机只跑快速子集 | 不再纠缠本机磁盘 |

> **诚实声明**：第 4 步的 `pg_test_fsync` 实测是**在当前卷**上跑的，
> 而 `data-test-v004` 规划在**同一卷** —— 所以**预期 fsync 成本相同**。
> 但**这不再是问题**：稳态建库只需 2s，**不需要**靠换盘来提速。

### 4.7.1 「PG 已进入稳态」的判据（P0 必做）

**这是本轮新增的硬性要求**，目的是让「PG 未就绪」在**测试开始前**就被识别出来，
而不是表现为「测试超时」，更不能表现为「产品缺陷」。

#### 判据 A：日志静态检查（启动后立即执行）

```bash
# 在 pg_ctl start 之后、vitest 之前执行
LOG="/c/Users/TYMO001/WorkBuddy/ai/_tools/pgsql/pg-test-v004.log"
if grep -aq "正在自动恢复状态\|syncing data directory" "$LOG" 2>/dev/null; then
  echo "[readiness] ⚠️ 检测到 recovery / fsync 积压痕迹，等待稳态…"
  for i in $(seq 1 60); do
    grep -aq "数据库系统已就绪" "$LOG" && break
    sleep 5
  done
fi
```

> **注意**：新建的隔离实例**不会**有 recovery（它是全新 `initdb` 的），
> 这条检查主要是**复用现有实例**（55433）时的保险。

#### 判据 B：空库建删往返（**最有价值的探针**）

```bash
# 建一个一次性探针库再立刻删掉 —— 这是「PG 已进入稳态」最直接的判据
probe_ms=$(psql -h 127.0.0.1 -p $PORT -U v2ex -d postgres -t -A -c "select 1" >/dev/null && \
  { start=$(date +%s%3N)
    psql -h 127.0.0.1 -p $PORT -U v2ex -d postgres -c "CREATE DATABASE v2ex_readiness_probe" >/dev/null
    psql -h 127.0.0.1 -p $PORT -U v2ex -d postgres -c "DROP DATABASE v2ex_readiness_probe" >/dev/null
    end=$(date +%s%3N); echo $((end - start)); })
echo "[readiness] 空库建删往返 = ${probe_ms} ms"
# 判定：> 10000 ms → PG 未就绪，拒绝开始测试
```

| 判定 | 含义 | 处置 |
|---|---|---|
| **< 10_000 ms** | ✅ PG 稳态 | 继续跑测试 |
| **≥ 10_000 ms** | ⚠️ PG 未就绪 / 积压中 | **拒绝开始测试**，等待并重试；**不记为测试失败** |

> **探针库名 `v2ex_readiness_probe` 必须命中 §3.5 的库名白名单** ——
> 建议把它**显式加入**精确枚举，否则会被护栏拦下（这是刻意的：护栏宁可误伤也不放过真库）。

#### 判据 C：`tests/setup.ts` 内的轻量探活

```ts
// tests/setup.ts —— 每个测试文件开始时执行一次
const probe = postgres(resolved.adminUrl, { prepare: false, connect_timeout: 3, max: 1 });
await probe.unsafe('select 1');
await probe.end();
// 若抛错 → 明确报「PG 未就绪」，而不是让后续用例报一堆连接错误
```

#### 判据 D：阶段日志的自证能力

§4.5 的 `[db-phase]` JSON 日志里，`dropMs` / `createMs` **本身就是稳态判据**：
连续多个文件的 `createMs` 都是 2s 量级 → 稳态；
某一个文件突然 30s+ → **该时刻 PG 进入了积压态**，此时该文件的其它耗时数字**均不可采信**。

### 4.8 `template1` 预置迁移（S2，与 S1 叠加）

**目的**：`CREATE DATABASE` 出来的库**已经带表结构**，`drizzle-kit migrate` 变成秒级幂等操作。

**步骤**：

```bash
# 在隔离实例上一次性执行（可重复，幂等）
psql -h 127.0.0.1 -p 55440 -U v2ex -d template1 -c "DROP DATABASE IF EXISTS v2ex_test_template"   # 若存在
# 把 template1 复制成带结构的模板
createdb -h 127.0.0.1 -p 55440 -U v2ex -T template1 v2ex_test_template
DATABASE_URL="postgres://v2ex:***@127.0.0.1:55440/v2ex_test_template" npx drizzle-kit migrate
```

之后各 spec 用 `CREATE DATABASE <name> TEMPLATE v2ex_test_template` 取代 `TEMPLATE template1`。

**收益量化（基于实测）**：

| 项 | 无模板 | 有模板 |
|---|---|---|
| `CREATE DATABASE` | copydir 298 文件 + fsync 298 文件 ≈ **1.6s**（实测）；稳态实测 **2.0~2.3s** | copydir 455 文件 + fsync 455 文件 ≈ **≈2.4s**（按 2.71ms/文件推算，**待实测**） |
| `drizzle-kit migrate` | **5.4s**（实测） | **≈0.5s**（幂等空跑，**待实测**） |
| 单文件建库总计 | **≈7.0s**（实测推算） | **≈2.9s**（**待实测**） |

> **注意**：带模板的库文件数**更多**（455 vs 298），所以 `CREATE DATABASE` 本身**略慢**；
> 净收益来自省掉 migrate。**这个权衡要靠 §4.5 的阶段日志用真实数字确认，不要凭估算下结论。**

> **`pg_trgm` 注意**：实测 `pg_trgm 1.6` 在 `template1` 中 **available**，
> 迁移在模板库上执行后 `CREATE EXTENSION` 会随模板一起复制到新库。
> 但**扩展必须先在模板库里装好** —— `CREATE DATABASE ... TEMPLATE x` 复制的是 `x` 的内容。

> **🔻 本节已降级为 P2（可选）**：稳态建库只要 2.0~2.3s，migrate 5.4s 也不是瓶颈，
> 省掉 migrate 的收益有限（单文件 ~4s × 10 个文件 ≈ 40s）。
> **相比之下，§4.1.1 提到的「共享 globalSetup 做一次建库+迁移」收益更大**
> （可把 5 个文件重复的建库从 5 次降到 1 次），且**不改变任何 spec 的断言逻辑**。
> 两者都列为 P2，**由 T03 顺带评估**。

### 4.9 受影响文件清单（问题 B）

| 文件 | 动作 | 说明 |
|---|---|---|
| `vitest.config.ts` | **改（仅注释）** | ⚠️ **不改阈值**：`hookTimeout` **保持 120_000**、`testTimeout` **保持 30_000**。<br>**必做**：改写 L12~L26 那段**已过时的归因注释**（「CREATE DATABASE 38.6s」）—— 改为「稳态建库 ~2s；120s 是宽松保险；38.6s 那次是 crash recovery 异常态」，否则下一个人会被误导 |
| `tests/helpers/test-db-lifecycle.ts` | **新增** | `provisionTestDatabase()` + 阶段计时 + 结构化日志 |
| `tests/helpers/test-db-guard.ts` | **新增** | 白名单断言（与 §3.5 同一文件）；**须含 `v2ex_readiness_probe`**（§4.7.1 判据 B） |
| `tests/helpers/local-bin.ts` | **改** | 子进程 env 注入 + 指纹断言 |
| 10 个建库 spec | **改** | 统一用 `provisionTestDatabase`；显式 `beforeAll(fn, 120_000)` |
| `tests/helpers/start-test-pg.sh` | **新增** | §4.2 的初始化脚本 + §5.2 的生命周期 + §4.7.1 的稳态判据（**仓库内**，可版本控制、可 diff 验收） |
| `tests/env/.env.test.example` | **新增** | 指向 55440 的模板 |

---

## 5. 问题 C 的修复设计

### 5.1 根因的准确表述

主理人的判定「Bash 调用结束回收整棵进程树」**方向正确**，但需要更精确的表述：

> WorkBuddy 的 Bash 工具在单次调用结束时回收**该次调用派生的进程树**。
> `pg_ctl start` 拉起的 `postgres.exe` 是**被调用 shell 的子进程**；
> 若该 shell 是那次 Bash 调用的直接子进程，则 postgres 随调用结束而被终止。

**实测补充**：本次核查期间，55433 实例**仍在运行**（`pg_isready` → `accepting connections`，
`postmaster.pid` 存在且 PID 11992 存活）。说明：
- 该实例是被 `_scratch/pg-keepalive-v004.sh`（后台常驻任务）拉起的，**不随单次 Bash 调用结束而终止**；
- **后台常驻脚本 + 独立端口** 是当前唯一可靠的存活手段。

### 5.2 设计：生命周期托管脚本（单次 Bash 调用内完成全部操作）

**核心原则**：**不要**试图让 PG 跨越多次 Bash 调用存活。
**把「启动 → 测试 → 清理」压缩进**同一次** Bash 调用。

```
┌──────────────────── 一次 Bash 调用 ────────────────────────────────┐
│                                                                      │
│  1. ensure_instance()   ← 幂等：已就绪则复用；端口被占则先清理         │
│  2. run_vitest()        ← vitest run（子进程继承已规范化的 env）      │
│  3. cleanup_test_dbs()  ← 只删命中白名单正则的库                      │
│  4. stop_instance()     ← 可选：--keep-alive 时跳过                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**脚本骨架**（`tests/helpers/start-test-pg.sh`，**仓库内**）：

```bash
#!/usr/bin/env bash
# v0.0.4 单元测试全生命周期托管 —— 一次 Bash 调用内完成启动→测试→清理
set -uo pipefail

BASE="C:/Users/TYMO001/WorkBuddy/ai"
REPO="$BASE/v2ex-clone"
PGBIN="$BASE/_tools/pgsql/pgsql/bin"
PGDATA="$BASE/_tools/pgsql/data-test-v004"
PORT="${TEST_DB_PORT:-55440}"
LOG="$BASE/_tools/pgsql/pg-test-v004.log"

# ── 清理策略：精确枚举 + 证据库拒绝名单（**双层**，见 §3.5）────────────
# ⚠️ 不要用前缀正则（如 ^v2ex_(test|v003|v004|...)）：
#    实测会误伤证据库 v2ex_v004_audit（升级审计证据）。
#    唯一权威判定在 tests/helpers/test-db-guard.ts 的 isDeletableTestDatabase()。
#    下面的列表必须与该实现保持同步 —— 两者不一致时以 TS 实现为准。
DELETE_ALLOWLIST="v2ex_admintest v2ex_v003_admin v2ex_v003_content v2ex_v003_credits \
v2ex_v003_feed v2ex_v003_reset v2ex_floorcont_v004 v2ex_floortest v2ex_rateclear \
v2ex_seedtest v2ex_readiness_probe"

# 证据库 —— 双重保险：即使上面的白名单将来被误改，这些也一律不删
PROTECTED_DBS="v2ex_loadtest v2ex_v002_baseline v2ex_release_v001 v2ex_visual \
v2ex_e2e v2ex_e2e_v004 v2ex_upg_v004_fresh v2ex_upg_v004_old v2ex_upg_v004_restore \
v2ex_upgrade_src v2ex_mig_idem v2ex_mig_v004 v2ex_v004_audit v2ex_qa_migidem_v004"

export PGPASSWORD="${TEST_DB_PASSWORD:-v2ex_test_password_local_only}"
export DATABASE_URL="postgres://v2ex:${PGPASSWORD}@127.0.0.1:${PORT}/postgres"
export ENV_FILE=""                       # ← 清空：子进程不再自行解析 env 文件
export V2EX_DB_FINGERPRINT="127.0.0.1:${PORT}/postgres@v2ex"
export APP_RUNTIME_ENV=test
export TEST_ENV_ISOLATED=1

PSQL="$PGBIN/psql.exe"

# ── 1. 端口占用检查（确保没有旧进程占用测试端口）────────────────────
#    查找监听该端口的 PID，若其 cmdline 指向 PGDATA → 是我们自己的残留，
#    正常停掉；否则说明是别的程序占用 → 直接报错，绝不 kill 陌生进程。
port_pids() { netstat -ano | grep -E "LISTENING" | grep ":${PORT} " | awk '{print $NF}' | sort -u; }
for pid in $(port_pids); do
  cmdline="$(wmic process where "ProcessId=$pid" get CommandLine 2>/dev/null | tr -d '\r')"
  case "$cmdline" in
    *"$PGDATA"*) echo "[lifecycle] 清理残留实例 PID=$pid"; "$PGBIN/pg_ctl.exe" -D "$PGDATA" -m fast stop ;;
    *) echo "[lifecycle] 端口 $PORT 被非测试进程占用 (PID=$pid)"; exit 1 ;;
  esac
done

# ── 2. 启动（幂等）─────────────────────────────────────────────────
if ! "$PGBIN/pg_isready.exe" -h 127.0.0.1 -p "$PORT" -q; then
  [ -f "$PGDATA/PG_VERSION" ] || { echo "[lifecycle] 实例未初始化，先跑 init-test-instance.sh"; exit 1; }
  "$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "$LOG" -o "-p $PORT" -w start || exit 1
fi
"$PGBIN/pg_isready.exe" -h 127.0.0.1 -p "$PORT" -U v2ex || exit 1

# ── 3. 运行测试 ────────────────────────────────────────────────────
cd "$REPO"
set +e
npx vitest run "$@"
VITEST_EXIT=$?
set -e

# ── 4. 幂等清理：只删命中白名单正则的库 ─────────────────────────────
#    绝不碰 v2ex_loadtest / v2ex_v002_baseline / v2ex_release_v001 等
"$PSQL" -h 127.0.0.1 -p "$PORT" -U v2ex -d postgres -t -A -c \
  "select datname from pg_database" \
| while read -r db; do
    [ -z "$db" ] && continue
    # 第 1 层：证据库拒绝名单 —— 无条件豁免
    case " $PROTECTED_DBS " in *" $db "*) echo "[lifecycle] 跳过证据库 $db"; continue ;; esac
    # 第 2 层：精确白名单
    case " $DELETE_ALLOWLIST " in
      *" $db "*) ;;
      *) continue ;;   # 不在白名单内 → 不删
    esac
    echo "[lifecycle] 清理测试库 $db"
    "$PSQL" -h 127.0.0.1 -p "$PORT" -U v2ex -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null
  done

# ── 5. 停止实例（--keep-alive 时保留）────────────────────────────────
if [ "${1:-}" != "--keep-alive" ]; then
  "$PGBIN/pg_ctl.exe" -D "$PGDATA" -m fast stop >/dev/null 2>&1
fi

exit $VITEST_EXIT
```

### 5.3 确认 PG 在测试期间持续存活

| 手段 | 实现 | 频率 |
|---|---|---|
| **启动后健康检查** | `pg_isready -h 127.0.0.1 -p $PORT -U v2ex` | 启动后立即 |
| **测试期间心跳** | 脚本在 vitest 运行**之前**记录 PG 的 PID，vitest **之后**再查一次 `pg_ctl status`；不一致则打印告警 | 前后各一次 |
| **vitest 内部探活** | `tests/setup.ts` 在加载完成后执行一次 `select 1`（超时 3s），失败即抛错 | 每个测试文件一次 |
| **日志时间戳** | `pg-test-v004.log` 的时间戳与测试日志时间戳对照 | 事后核对 |

> **关键设计**：`tests/setup.ts` 里的 `select 1` 探活是**最有效**的一道 ——
> 它在**每个测试文件开始时**确认 PG 还活着。若中途被回收，
> 后续文件会在 setup 阶段立刻失败并给出明确原因（而不是表现为随机的连接超时）。

### 5.4 确保无旧进程占用测试端口

§5.2 脚本的「端口占用检查」逻辑：

1. `netstat -ano` 找出监听 `$PORT` 的 PID；
2. 用 `wmic process where "ProcessId=$pid" get CommandLine` 取命令行；
3. **命令行含 `PGDATA`** → 是本方案的残留实例 → 正常 `pg_ctl -m fast stop`；
4. **命令行不含 `PGDATA`** → **陌生进程占用** → **直接 `exit 1`，绝不 kill**。

> 这个「只杀自己」的规则很重要：端口冲突时**宁可失败也不误杀**
> —— 上一轮教训是进程管理要收敛，不能用 `taskkill /F /IM postgres.exe` 这类宽泛命令。

### 5.5 幂等清理逻辑（**双层判定**）

清理脚本**只**删除**同时**满足以下两个条件的库：

| 层 | 条件 | 实现 |
|---|---|---|
| **第 1 层：拒绝名单** | **不在** `$PROTECTED_DBS` 中 | 证据库无条件豁免 |
| **第 2 层：允许名单** | **在** `$DELETE_ALLOWLIST` 中，或以 `v2ex_test_` 开头 | 精确枚举 + 保留前缀 |

> ⚠️ **本设计初稿曾用前缀正则做清理筛选，实测证明会误伤证据库 —— 已修正。**
>
> 初稿正则：`^v2ex_(test|v003_(...)|v004|floorcont|seedtest|rateclear|admintest|floortest)`
> **问题**：`v2ex_v004_audit` 命中 `v2ex_v004` 分支 → **会被删除**，
> 但它是 `docs/UPGRADE_RECOVERY_v0.0.4.md` §1.1 列出的**升级审计证据库**。
> **根因**：前缀通配把「版本号前缀」误当成了「测试库命名空间」。
> **修正**：改为**精确枚举 + 显式拒绝名单**，唯一权威判定是
> `tests/helpers/test-db-guard.ts` 的 `isDeletableTestDatabase()`。
> **脚本里的 bash 列表只是镜像**，两者不一致时**以 TS 实现为准**。

**允许清理的库（精确枚举，11 个）**：

```
v2ex_admintest  v2ex_v003_admin  v2ex_v003_content  v2ex_v003_credits
v2ex_v003_feed  v2ex_v003_reset  v2ex_floorcont_v004  v2ex_floortest
v2ex_rateclear  v2ex_seedtest    v2ex_readiness_probe
```
外加保留前缀 `v2ex_test_*`（未来新增测试库统一用此前缀）。

**明确不在清理范围内的库**（实测存在于 55433，且**必须保留**）：

| 库 | 为什么保留 |
|---|---|
| `v2ex_loadtest`（890MB） | 负载测试数据 —— v0.0.4 压测证据 |
| `v2ex_v002_baseline` | v0.0.2 → v0.0.4 升级验证基线 |
| `v2ex_release_v001` | 发布验证证据 |
| `v2ex_visual` | 视觉对照基线 |
| `v2ex_e2e` / `v2ex_e2e_v004` | E2E 用库（主理人明确「不可动」） |
| `v2ex_upg_v004_*` / `v2ex_mig_*` / `v2ex_upgrade_src` | 升级/恢复演练证据 |
| **`v2ex_v004_audit`** | **升级审计证据库**（初稿正则会误删，**已修正**） |
| `v2ex_qa_migidem_v004` | QA 幂等验证证据 |

> **三重保险**：
> ① **实例隔离** —— 清理脚本连的是 **55440（新隔离实例）**，与 55433 **物理上不同**；
> ② **拒绝名单** —— 证据库无条件豁免；
> ③ **允许名单** —— 不在精确枚举内的库一律不删。
> 即使白名单将来被误改，证据库仍被拒绝名单挡住。

**`DROP DATABASE ... WITH (FORCE)`**：
PostgreSQL 13+ 支持，可强制断开残留连接。实测 `pg_database_size` 等函数可用，版本 17.5 支持该语法。
用它可以避免「连接未释放导致 DROP 失败」。

### 5.6 受影响文件清单（问题 C）

| 文件 | 位置 | 动作 | 说明 |
|---|---|---|---|
| `run-unit-tests-v004.sh` | `_tools/pgsql/` | **新增** | 生命周期托管脚本（仓库外，不入库） |
| `init-test-instance.sh` | `_tools/pgsql/` | **新增** | §4.2 初始化脚本（仓库外，不入库） |
| `tests/setup.ts` | 仓库 | **改** | 加 `select 1` 探活 + 指纹打印 |
| `.gitignore` | 仓库 | **可能改** | 确认 `tests/env/` 生成物被忽略 |

> **为什么脚本放仓库外**：`_tools/` 不在 Git 仓库内（它是 `ai/` 的**兄弟目录**），
> 与既有的 `pg-keepalive.sh` / `pg-check.sh` / `e2e-v004-setup.sh` **同一惯例** ——
> 这些是本机运维脚本，不属于交付物，不应进版本库。

---

## 6. 数据结构与接口（classDiagram）

```mermaid
classDiagram
    direction LR

    class ResolvedTestEnv {
        +string databaseUrl
        +string endpoint
        +string database
        +string fingerprint
        +string source
    }

    class TestEnvResolver {
        +static resolve(options) ResolvedTestEnv
        +static fingerprintOf(url) string
        +static ensureLocalEnvFile() void
        +static loadFile(path) Record~string,string~
    }

    class TestDbGuard {
        +static assertSafeTestTarget(databaseUrl, dbName) void
        +static assertEndpointAllowed(endpoint) void
        +static assertDatabaseAllowed(dbName) void
        +static isDeletableTestDatabase(dbName) boolean
        +static isProtectedEvidenceDatabase(dbName) boolean
    }

    class DbPhaseTiming {
        +string file
        +string db
        +string endpoint
        +number dropMs
        +number createMs
        +number migrateMs
        +number seedMs
        +number totalMs
    }

    class TestDbLifecycle {
        +provisionTestDatabase(options) Promise~DbPhaseTiming~
        +dropTestDatabase(adminUrl, dbName) Promise~void~
        +createTestDatabase(adminUrl, dbName, template) Promise~void~
        +runMigrate(childEnv) void
        +runSeed(childEnv) void
    }

    class LocalBinRunner {
        +runDrizzleKit(args, env) string
        +runTsx(scriptPath, env) string
        +buildChildEnv(dbName) NodeJS.ProcessEnv
        +static resolvePackageBin(pkgName) object
    }

    class PgInstanceManager {
        +string pgDataDir
        +number port
        +string baseUrl
        +initInstance() void
        +ensureRunning() boolean
        +isAlive() boolean
        +stopInstance(mode) void
        +listOccupiedPids() number[]
        +cleanupTestDatabases(pattern) string[]
    }

    class TestSpecBase {
        +string TEST_DB
        +adminUrlFor(dbName) string
        +testDatabaseUrl(dbName) string
    }
    <<interface>> TestSpecBase

    ResolvedTestEnv <-- TestEnvResolver : creates
    TestEnvResolver ..> TestDbGuard : uses endpoint/db allowlist
    TestDbLifecycle ..> TestDbGuard : asserts before DROP/CREATE
    TestDbLifecycle ..> LocalBinRunner : spawns migrate/seed
    TestDbLifecycle ..> DbPhaseTiming : produces
    LocalBinRunner ..> TestEnvResolver : reuses fingerprintOf
    PgInstanceManager ..> TestDbGuard : shares db-name policy
    TestSpecBase ..> TestDbLifecycle : calls provisionTestDatabase
    TestSpecBase ..> TestEnvResolver : resolves connection base
```

**接口契约（关键签名）**

| 接口 | 签名 | 失败行为 |
|---|---|---|
| `TestEnvResolver.resolve` | `(options: { cwd: string; required: boolean }) => ResolvedTestEnv` | `required=true` 且解析不出 → `throw`（**绝不回落**到 `.env.local`） |
| `TestDbGuard.assertSafeTestTarget` | `(databaseUrl: string, dbName: string) => void` | 端点或库名不匹配 → `throw`，**在任何 SQL 发出之前** |
| `TestDbGuard.isDeletableTestDatabase` | `(dbName: string) => boolean` | — （返回 false 即拒绝删除；**证据库无条件豁免**） |
| `TestDbLifecycle.provisionTestDatabase` | `(options: { file; db; adminUrl; migrate; seed? }) => Promise<DbPhaseTiming>` | 任一阶段失败 → `throw` 并携带该阶段名与已耗时 |
| `LocalBinRunner.buildChildEnv` | `(dbName: string) => NodeJS.ProcessEnv` | 指纹与父进程不一致 → `throw` |

---

## 7. 程序调用流程（sequenceDiagram）

### 7.1 单元测试启动 → 建库 → 迁移（父/子进程目标一致性）

```mermaid
sequenceDiagram
    autonumber
    participant Bash as Bash 调用<br/>(run-unit-tests-v004.sh)
    participant PM as PgInstanceManager
    participant Guard as TestDbGuard
    participant Setup as tests/setup.ts
    participant Res as TestEnvResolver
    participant Spec as tests/*.spec.ts
    participant Life as TestDbLifecycle
    participant LocalBin as LocalBinRunner
    participant Admin as postgres<br/>(admin 连接)
    participant Kit as drizzle-kit<br/>(子进程)
    participant Seed as scripts/seed.ts<br/>(子进程)

    Bash->>PM: ensureRunning(55440)
    PM->>PM: netstat 查端口占用
    alt 端口被陌生进程占用
        PM-->>Bash: throw（不 kill 陌生进程）
    else 残留自有实例
        PM->>PM: pg_ctl -m fast stop
    end
    PM->>PM: pg_ctl start -w + pg_isready
    PM->>PM: 检查日志是否有 recovery 痕迹
    PM->>Admin: 空库建删往返（稳态判据）
    Admin-->>PM: t_probe（稳态 ≈2s）
    alt t_probe > 10s（PG 未就绪/积压）
        PM-->>Bash: throw「PG 未进入稳态，拒绝开始测试」
        Note over PM,Bash: 环境问题 ≠ 产品缺陷，不记为测试失败
    end
    PM-->>Bash: alive=true, ready=true

    Bash->>Setup: vitest run（子进程继承 env）
    Setup->>Res: resolve({required:true})
    Res->>Res: 读 process.env（最高优先级）
    Res->>Res: 读 .env.test（缺失则从模板生成）
    Res-->>Setup: ResolvedTestEnv{url,endpoint,fingerprint}
    Note over Res: 绝不读 .env.local
    Setup->>Setup: process.env.DATABASE_URL = url<br/>V2EX_DB_FINGERPRINT = fingerprint
    Setup->>Admin: select 1（探活，3s 超时）
    Admin-->>Setup: ok（实例存活）
    Setup-->>Spec: 环境就绪

    Spec->>Guard: assertSafeTestTarget(adminUrl, TEST_DB)
    Guard->>Guard: 端点在白名单？库名在精确枚举？
    alt 不匹配
        Guard-->>Spec: throw（中止，不发出任何 SQL）
    end

    Spec->>Life: provisionTestDatabase({db, migrate, seed?})
    Life->>Guard: assertSafeTestTarget（再确认）
    Life->>Admin: DROP DATABASE IF EXISTS <db>
    Admin-->>Life: t_drop
    Life->>Admin: CREATE DATABASE <db>
    Admin-->>Life: t_create
    Life->>LocalBin: runDrizzleKit(['migrate'], childEnv)
    LocalBin->>LocalBin: 校验子进程指纹 == 父进程指纹
    alt 指纹不一致
        LocalBin-->>Life: throw
    end
    LocalBin->>Kit: execFileSync(node, drizzle-kit, migrate, env)
    Kit-->>LocalBin: exit 0
    LocalBin-->>Life: t_migrate
    opt 需要 seed
        Life->>LocalBin: runTsx('scripts/seed.ts', childEnv)
        LocalBin->>Seed: execFileSync(node, tsx, seed.ts, env)
        Seed-->>LocalBin: exit 0
        LocalBin-->>Life: t_seed
    end
    Life-->>Spec: DbPhaseTiming
    Life-->>Bash: [db-phase] {dropMs,createMs,migrateMs,totalMs}

    Spec->>Admin: 关闭连接 + DROP DATABASE <db>
    Bash->>PM: cleanupTestDatabases(^v2ex_(test|v003_|v004|...))
    PM->>Admin: 仅删除命中正则的库
    Note over PM: v2ex_loadtest / v2ex_v002_baseline 不在正则内
    Bash->>PM: stopInstance(fast)
```

### 7.2 单次 Bash 调用内的完整生命周期（问题 C）

```mermaid
sequenceDiagram
    autonumber
    participant WB as WorkBuddy Bash 工具
    participant Script as run-unit-tests-v004.sh
    participant PM as PgInstanceManager
    participant PG as postgres.exe<br/>(55440)
    participant Vitest as vitest
    participant Clean as cleanupTestDatabases

    WB->>Script: 一次调用（全部操作在此完成）
    Script->>PM: 检查端口占用
    PM-->>Script: 空闲 / 残留（自有）/ 占用（陌生→exit 1）
    Script->>PM: pg_ctl start -w
    PM->>PG: 启动（数据目录 data-test-v004）
    PG-->>PM: ready
    Script->>Vitest: npx vitest run（env 已规范化）
    Vitest->>PG: 建库 / 迁移 / 断言
    PG-->>Vitest: 结果
    Vitest-->>Script: 退出码
    Script->>Clean: DROP 命中正则的测试库
    Clean->>PG: DROP DATABASE ... WITH (FORCE)
    Script->>PM: pg_ctl stop -m fast
    Script-->>WB: 退出码（= vitest 退出码）
    Note over WB,PG: Bash 调用结束 → 进程树回收<br/>但此时 PG 已主动停止，无残留
```

---

## 8. 任务分解（有序、含依赖）

> 标注约定：**责任人** = 建议归属；**互斥** = 不能并行修改的文件。
> 全部任务**不涉及** `.env.local`、`data-v003`、任何 `git reset/clean`。
>
> **优先级说明（因第三次归因勘误而调整）**：
> - **新增 T06（PG 稳态判据）= P0 必做** —— 原 §4.7.1 的内容从「排查步骤」升为「独立任务」，
>   因为它防的是「环境问题被误判成产品缺陷」，代价最高。
> - **T04 的 `vitest.config.ts` 改动从「调阈值」缩为「仅改注释」** —— 阈值**不动**（§4.6.1）。
> - **S2（模板预置迁移）与 S5（换盘）从 P0 降为 P2**，并入 T07 评估。

### T01 — 隔离配置基座（配置 + 解析 + 护栏 + 模板）✅ **已实施并通过独立验证**

| 项 | 内容 |
|---|---|
| **依赖** | 无 |
| **优先级** | **P0** |
| **责任人** | 架构师（设计已出）+ 工程师（实现） |
| **修改文件** | `tests/setup.ts`（改，**档 2**）<br>`tests/helpers/test-env.ts`（新增）<br>`tests/helpers/test-db-guard.ts`（新增）<br>`tests/env/.env.test.example`（新增）<br>`drizzle.config.ts`（改，**档 2**）<br>`scripts/seed.ts`（改，**档 3** —— 需先确认所有权）<br>`tests/helpers/local-bin.ts`（改）<br>`.gitignore`（可能改） |
| **互斥** | `tests/setup.ts`、`drizzle.config.ts`、`tests/helpers/local-bin.ts` **本任务独占** —— 后续任务不得并行改这三个文件 |
| **职责** | ① 实现统一的 env 解析（§3.2 优先级：shell > ENV_FILE > .env.test > .env.local > .env）<br>② **按 §3.2.0 的四档处置 `override: true`**：<br>　　- **档 2**：`tests/setup.ts` + `drizzle.config.ts` → **去掉** `override: true`<br>　　- **档 3**：`scripts/seed.ts` → **只删掉自己那行 `config({ path: ENV_FILE, override: true })`**（或改不带 override）；❌ **不要**动 `import 'dotenv/config'`（§3.2.0「档 3 修正」：ESM import 提升使档 1 已抢先，自身 override 是冗余）<br>　　- **档 1**：`src/db/index.ts` → **保留** `override: true`（Next.js 预加载使它有真实作用），只补注释<br>　　- **档 4**：`scripts/admin-cli.ts` / `scripts/db-admin.mjs` → **不改**<br>③ 实现指纹计算与 `V2EX_DB_FINGERPRINT` 写入<br>④ 实现白名单护栏（端点 + 库名精确枚举 + **证据库拒绝名单** + CI 库名扩展）<br>⑤ 实现 `.env.test` 缺失时的自动生成（从模板 + 占位符替换）<br>⑥ `local-bin.ts` 注入子进程 env + 指纹一致性断言 |
| **验收标准** | ① `npm run test:unit` 输出的每行 `[db-target]` 指纹**全部指向 55440**（或 CI 的 5432），**无一条指向 `.env.local` 的开发库**<br>② `tests/setup.ts` 中**不再出现** `config({ path: '.env.local' })`<br>③ 断开 `.env.local` 后单测仍能解析出测试连接串<br>④ 护栏测试：把 `DATABASE_URL` 指向 `127.0.0.1:9999` → 单测**立即抛错**并打印白名单<br>⑤ 护栏测试：把库名改为 `v2ex_v002_baseline` → **立即抛错**<br>⑥ 子进程 `[db-child]` 行的 `endpoint/db/fp` 与父进程 `[db-target]` 行**逐字相同**<br>⑦ **回归 QA 的陷阱**：同时设 `ENV_FILE=.env.test` 与 `DATABASE_URL=<另一个库>` → 迁移必须打到**命令行指定的那个库**（§3.2.1 的直接验收点）<br>⑧ **证据库豁免测试**：`isDeletableTestDatabase('v2ex_v004_audit')` 必须返回 **`false`**（§3.5 的误伤修正点）<br>⑨ **逐库遍历断言**：对 `PROTECTED_DB_NAMES` 里的 **14 个库名**逐个断言 `isDeletableTestDatabase()` 均为 `false`<br>⑩ **档位回归**：`ENV_FILE=.env.test` 且**不设** `DATABASE_URL` 时，迁移仍打到 `.env.test` 的库（§3.2.0 实测 3 的「shell 未设」情形，行为必须不变）<br>⑪ **档 3 回归**：`scripts/seed.ts` 在 `ENV_FILE` 存在时**仍然**使用 ENV_FILE 的值（§3.2.0「档 3 修正」实测：两种场景下行为均**未改变** —— 档 1 已抢先，自身 override 冗余）<br>⑫ **档 1 不回归**：`src/db/index.ts` 的 `override: true` **仍在**（`git diff` 中该文件若无改动即为通过） |
| **不做** | 不改任何 spec；不改 `vitest.config.ts`；**不改 `src/db/index.ts` 的 `override`** |

### T02 — 独立测试实例（初始化 + 生命周期托管）✅ **已实施**

> **实施说明**：`software-engineer-testenv` 把生命周期脚本放在了 **`tests/helpers/start-test-pg.sh`（仓库内）**，
> 而非我原设计的 `_tools/pgsql/`（仓库外）。**这个选择更合理** ——
> 仓库内可被版本控制，验收能靠 `git diff`，且新克隆仓库自带。
> **设计已据此调整**（§5.2 的路径与 §8.2 互斥矩阵）。
> ⚠️ **副作用已核查（架构师实测）**：
> - **最终运行时镜像不含 `tests/`** —— `Dockerfile` 的 runner 阶段只 COPY 了指定目录（`public/` / `.next` / `package.json` / `drizzle` / `scripts` / `src/db` 等），**不含 `tests/`**；
> - **发行包不含 `tests/`** —— `deploy/` 的打包逻辑未包含 `tests`，`git ls-files tests/helpers/` 目前只有 `local-bin.ts`；
> - **builder 层镜像含 `tests/`** —— `COPY . .` 会带入，但 builder 层**不产出交付物**。
>
> 🔴 **但有一处需要修**（架构师实测发现）：
> `tests/helpers/start-test-pg.sh` L47 有**硬编码的本机绝对路径作为 fallback**：
> ```bash
> BASE="${V2EX_PG_BASE:-C:/Users/TYMO001/WorkBuddy/ai}"
> ```
> 换机器后若未设 `V2EX_PG_BASE`，会指向**不存在的路径**且报错信息难以理解。
> **建议**：fallback 改为**从脚本自身位置推导**（`$(dirname "$0")/../../..`），
> 或在检测到路径不存在时给出明确提示「请设置 `V2EX_PG_BASE` 指向本机 PostgreSQL 目录」。
> → 已列为 **T02 验收 ⑫**。

| 项 | 内容 |
|---|---|
| **依赖** | T01 |
| **优先级** | **P0** |
| **责任人** | 工程师（实现）/ 部署工程师（验证） |
| **修改文件** | `tests/helpers/start-test-pg.sh`（新增，**仓库内** —— 含初始化 + 生命周期 + 稳态判据）<br>`tests/helpers/test-db-lifecycle.ts`（新增） |
| **互斥** | `tests/helpers/test-db-lifecycle.ts` 与 `tests/helpers/start-test-pg.sh` 本任务独占（T06 后续接手后者） |
| **职责** | ① 实现 §4.2 的 `initdb` 全流程（`--pwfile`、`-E UTF8`、中文 locale、`--data-checksums`、防误伤 `data-v003` 的 `case` 守卫）<br>② 实现 §5.2 的生命周期托管脚本（端口占用检查 → 幂等启动 → vitest → 白名单清理 → 停止）<br>③ 实现 `provisionTestDatabase()`（DROP → CREATE → migrate，**逐阶段计时** + JSON 日志）<br>④ 在 55440 上跑一次 `initdb`，验证实例可启动、可建库<br>⑤ **落地 §4.7.1 判据 B（空库建删往返）** —— 探针库名 `v2ex_readiness_probe` 需同时加入护栏白名单 |
| **验收标准** | ① `data-test-v004` 创建成功，`PG_VERSION=17`<br>② `psql -p 55440 -c "show data_directory"` 指向 `data-test-v004`，**不是** `data-v003`<br>③ `psql -p 55440 -c "select count(*) from pg_database"` = **3**（空实例）<br>④ 新库 `server_encoding=UTF8` + `lc_collate=Chinese (Simplified)_China.936`（与现有实例**同构**）<br>⑤ `pg_trgm` 在新实例中可安装<br>⑥ 脚本**拒绝**把 `PGDATA` 指向 `data-v003`（用假路径试跑，退出码非 0）<br>⑦ 端口被陌生进程占用时脚本 **exit 1 且不 kill 任何进程**<br>⑧ 清理脚本执行后，55440 上**只剩** `postgres`/`template0`/`template1`；**55433 上 24 个库一个不少**（清理前后 `pg_database` 列表比对）<br>⑨ **空库建删往返实测 < 10_000 ms**（稳态基线 2.0~2.3s，主理人实测）<br>⑩ **定位口径校验**：脚本输出中**不得**出现「性能修复」类表述 —— 独立实例的价值是**隔离性 + 可复现性**<br>⑪ **清理误伤回归**：脚本跑完后，**55433 上的 `v2ex_v004_audit` 必须仍然存在**（§3.5 误伤修正点的端到端验证）<br>⑫ 🔴 **无本机绝对路径**：`tests/helpers/start-test-pg.sh` 的 `BASE` fallback 不得硬编码 `C:/Users/<用户名>/...` —— 改为从脚本自身位置推导，或在路径不存在时明确提示「请设置 `V2EX_PG_BASE` 指向本机 PostgreSQL 目录」
| **不做** | 不碰 `data-v003`；不删除 `v2ex_loadtest`；**不声称解决了 38.6s** |

### T03 — 规格迁移到统一生命周期（10 个建库文件）

| 项 | 内容 |
|---|---|
| **依赖** | T01、T02 |
| **优先级** | **P0** |
| **责任人** | 工程师 |
| **修改文件** | `tests/admin-cli.spec.ts`<br>`tests/admin-permissions.spec.ts`<br>`tests/content-lifecycle.spec.ts`<br>`tests/credits-concurrency.spec.ts`<br>`tests/feed-search.spec.ts`<br>`tests/floor-continuity.spec.ts`<br>`tests/floor-counter.spec.ts`<br>`tests/password-reset.spec.ts`<br>`tests/rate-limit-clear.spec.ts`<br>`tests/seed-idempotency.spec.ts` |
| **互斥** | 这 10 个文件**本任务独占**，其它任务不得并行改 |
| **职责** | ① 每个文件统一改用 `provisionTestDatabase()` + `assertSafeTestTarget()`<br>② `beforeAll(fn, 120_000)` 显式超时；`afterAll(fn, 60_000)`<br>③ 统一从 helper 取连接串，**删除各文件内重复的 `testDatabaseUrl()` 实现**<br>④ **`tests/floor-continuity.spec.ts` 必须删除硬编码的 `/55433/` 正则与 `.env.test` 直接读取**（§2.4 的 CI 崩溃根因）<br>　　⚠️ **但不要给这个文件单独打 QA 的 `existsSync` 补丁** —— §2.4.5 实测证明：单独打会让**本地默认路径**（不设 `ENV_FILE`）下 `DATABASE_URL` 变成 `.env.local` 的 **5432 开发库**，而该文件的 `beforeAll` 会 `DROP/CREATE DATABASE`（L107-108）→ **在开发库上建库**。**必须统一走 T01 的 `tests/helpers/test-env.ts`**<br>⑤ 5 个直接改 `process.env.DATABASE_URL` 的文件（admin-permissions / content-lifecycle / credits-concurrency / feed-search / password-reset）改为**统一入口**，避免跨文件污染 |
| **验收标准** | ① 10 个文件全部输出 `[db-phase]` JSON 行，字段齐全（`file/db/endpoint/dropMs/createMs/migrateMs/totalMs`）<br>② 在 **55440** 上跑通，`dropMs+createMs+migrateMs` **每个文件均 < 15_000 ms**<br>③ **`tests/floor-continuity.spec.ts` 在 CI 环境下不再抛 ENOENT**（用「删掉 `.env.test` + `DATABASE_URL` 指向 5432」的场景复现验证）<br>④ **单测全绿且 0 skipped；用例数 = 190**（QA 在 `097c1b9` 实测的权威基线：`numTotalTests: 190`）<br>⚠️ **口径提醒**：QA 实测**静态 grep `it(` 得出 180 是错的** —— 本项目用嵌套 for 循环生成用例，**运行时才是 190**<br>⑤ 10 个文件**没有一处**残留 `DROP DATABASE` 的裸 SQL（全部经护栏）<br>⑥ 全量总耗时 **< 300_000 ms**（QA 基线 215_000 ms）<br>⑦ 🔴 **防「开发库建库」回归**：**不设 `ENV_FILE`** 时跑全量 → `[db-target]` 指纹**必须全部指向隔离实例**（55440/55433），**无一条指向 5432**。这是 §2.4.5 实测出的最危险回归点<br>⑧ 🔴 **CI 侧复验**：真实 CI 必须变成 `Test Files 15 passed (15)` / `Tests 190 passed (190)`，且 **`e2e` job 从 skipped 恢复为 success**（§2.4.2 —— 这是 153 条 E2E 首次在 CI 上执行） |

### T04 — 配置注释修正 + CI env 补充（**阈值不动**）

| 项 | 内容 |
|---|---|
| **依赖** | T03 |
| **优先级** | **P1** |
| **责任人** | 工程师 |
| **修改文件** | `vitest.config.ts`（改：**仅注释**）<br>`.github/workflows/ci.yml`（改：仅加 env）<br>`.github/workflows/release.yml`（改：仅加 env）<br>`docs/TEST_ENV_ISOLATION_v0.0.4.md`（改：回填实测数字） |
| **互斥** | `vitest.config.ts` **本任务独占**（T01/T02/T03 不得改它）；CI YAML 本任务独占 |
| **职责** | ① ⚠️ **阈值一律不动**：`hookTimeout` **保持 120_000**、`testTimeout` **保持 30_000**（§4.6.1 已说明为何撤回「回落 60s」的建议）<br>② **必做**：改写 `vitest.config.ts` L12~L26 那段**已过时的归因注释** —— 现文写「CREATE DATABASE 38.6s」，应改为「**稳态建库 ~2.0~2.3s**（主理人实测）；120s 是宽松保险；38.6s 那一次是 **crash recovery / I/O 积压态**的异常观测值，**不是**数据目录大小导致」。**不改这段注释 = 留下第四轮误判的种子**<br>③ CI 加 `TEST_DB_ALLOWED_ENDPOINTS=localhost:5432` 与 `TEST_DB_ALLOWED_DATABASES=v2ex_ci,...`<br>④ **只加 env，不改任何现有 step**<br>⑤ 把本轮实测数字回填进本文档 |
| **验收标准** | ① `git diff vitest.config.ts` 显示**只有注释变化，零阈值变化**<br>② 注释中**不再出现**「38.6s」作为「需要 120s 的理由」的表述<br>③ CI `unit` job **绿灯**<br>④ `git diff .github/workflows/` 显示**只有 env 增行**，无 step 改动<br>⑤ 文档中「待实测」项全部回填为真实数字或明确标注「仍未实测」 |

### T05 — 全量复验与口径同步

| 项 | 内容 |
|---|---|
| **依赖** | T04、T06 |
| **优先级** | **P1** |
| **责任人** | QA + 工程师 |
| **修改文件** | `TEST_REPORT.md`（改）<br>`docs/evidence/`（新增单测证据）<br>`docs/TEST_ENV_ISOLATION_v0.0.4.md`（改） |
| **互斥** | `TEST_REPORT.md` 与 `docs/evidence/` 本任务独占 |
| **职责** | ① 在 **55440 隔离实例**上跑全量 `vitest run`，记录**逐文件阶段耗时**<br>② 与 QA 在 `097c1b9` 的实测基线（**190 条 / 0 skipped / 3m35s**）比对，确认**无用例被跳过**<br>③ **核对 CI 侧**：`unit` job 绿灯 + **`e2e` job 从 skipped 恢复为 success**（§2.4.2 —— 这是 153 条 E2E 在 CI 上的首次执行，必须拿到证据）<br>④ 更新 `TEST_REPORT.md` 的单测口径<br>⑤ 把实测数字回填本设计文档 §4.5 / §4.6 / §4.7 |
| **验收标准** | ① 本机：`vitest run` 退出码 0，**0 skipped**，**用例数 = 190**<br>② CI：`unit` job 绿灯，且**用例数与本机一致**<br>②' 🔴 **CI 必须看 `Test Files` 行**（不是 `Tests` 行）：`Test Files 15 passed (15)` / `Tests 190 passed (190)`。<br>⚠️ §2.4.4 实测的坑：修复前的真实 CI 是 `Tests 185 passed \| 5 skipped (190)` —— **只看 Tests 行会误判为「185 条通过」**，实际是 `1 failed + 5 skipped`<br>③ 10 个建库文件的 `dropMs+createMs+migrateMs` 全部 **< 15s**，最大值与中位数记录在案<br>④ 全量总耗时 **< 300_000 ms**（QA 基线 215_000 ms）<br>⑤ 🔴 **`e2e` job 必须从 skipped 变成 success**，且 E2E 实测数 = **153**（`--list` 实测基线）。这是 v0.0.4 的 153 条 E2E **首次在 CI 上执行** —— 此前一直被 `needs: unit` 连带跳过<br>⑥ `TEST_REPORT.md` 的数字与实际输出**逐条对应**<br>⑦ 文档中**无「待实测」残留**（或明确标注为「仍未实测」并说明原因） |

### T06 — PG 稳态判据与「未就绪 ≠ 超时」分流（P0，**防误判产品缺陷**）

| 项 | 内容 |
|---|---|
| **依赖** | T02 |
| **优先级** | **P0**（因第三次勘误而新增并提升） |
| **责任人** | 工程师（实现）/ 架构师（口径） |
| **修改文件** | `tests/helpers/start-test-pg.sh`（改 —— 与 T02 同文件，**T02 完成后由本任务接手**）<br>`tests/setup.ts`（改 —— 与 T01 同文件，**T01 完成后由本任务接手**）<br>`tests/helpers/test-db-guard.ts`（改 —— 白名单加 `v2ex_readiness_probe`） |
| **互斥** | ⚠️ **依赖 T01/T02 已完成**；本任务接手上述三个文件的**二次修改**权 |
| **职责** | ① 落地 §4.7.1 **判据 A**（日志静态检查：recovery / `syncing data directory` 痕迹）<br>② 落地 §4.7.1 **判据 B**（空库建删往返，阈值 10_000 ms）—— **脚本级**，在 vitest 之前执行<br>③ 落地 §4.7.1 **判据 C**（`tests/setup.ts` 内的 `select 1` 轻量探活，3s 超时）<br>④ 落地 §4.7.1 **判据 D**（阶段日志自证：`createMs` 连续 2s 量级 = 稳态；突然 30s+ = 进入积压态，**该文件其余耗时数字不可采信**）<br>⑤ 实现 §4.6.3 的**分流表**：把「PG 未就绪」与「真超时」区分开，**未就绪时脚本拒绝开始测试**，且**不记为测试失败** |
| **验收标准** | ① 探针库 `v2ex_readiness_probe` 能建能删，且**能被护栏放行**（加进精确枚举）<br>② 探针耗时 **< 10_000 ms**（稳态实测 2.0~2.3s）→ 正常放行<br>③ **模拟未就绪**：人为制造积压（如同时压测占满 I/O）→ 脚本**拒绝开始测试**并打印明确原因，**退出码 ≠ 0 但不产生「用例失败」记录**<br>④ `tests/setup.ts` 探活失败时，错误信息是「**PG 未就绪**」而不是一堆连接错误堆栈<br>⑤ 复用现有 55433 实例时，recovery 检测能正确识别并等待<br>⑥ **文案校验**：全部输出**不得**把未就绪描述为「测试超时」或「产品缺陷」 |

### T07 — 建库开销优化（P2，可选 —— QA 数据驱动的收益点）

| 项 | 内容 |
|---|---|
| **依赖** | T03、T05 |
| **优先级** | **P2** |
| **责任人** | 工程师（**需先评估再决定是否做**） |
| **修改文件** | `tests/**` 的 `globalSetup`（新增或改造）<br>10 个建库 spec（可能微调） |
| **互斥** | `tests/**` 全域 |
| **职责** | ① **评估** QA 数据指出的优化点：5 个文件（content-lifecycle / admin-cli / seed-idempotency / feed-search / db-lazy-init）**各自重复**「建库 + migrate」，合计占 97% 耗时<br>② 评估方案：**共享 `globalSetup`** 把建库 + 迁移做一次，各 spec 只做数据准备<br>③ 顺带评估 §4.8 的 **S2（`template1` 预置迁移）** —— 注意：若采用共享 globalSetup，S2 的必要性会下降<br>④ **先评估收益再实施**：若预估收益 < 30% 或引入断言风险，则**明确记录「不做」的理由**并结案 |
| **验收标准** | ① 实施后全量总耗时 **< 150_000 ms**（当前 215_000 ms）<br>② **用例数仍为 190**，0 skipped<br>③ **所有断言逻辑未变** —— 本任务**只改数据准备方式**，不得改动任何 `expect` 语义<br>④ 若评估后决定不做，产出一页「不做理由」记录到 `docs/evidence/` |

### 8.1 依赖图

```mermaid
graph TD
  T01["T01 隔离配置基座<br/>env 解析 / 指纹 / 护栏 / 模板"] --> T02["T02 独立测试实例<br/>initdb / 生命周期托管 / 阶段日志"]
  T01 --> T03["T03 规格迁移<br/>10 个建库文件统一生命周期"]
  T02 --> T03
  T02 --> T06["T06 稳态判据与分流<br/>P0 防误判产品缺陷"]
  T03 --> T04["T04 注释修正 + CI env<br/>阈值不动"]
  T04 --> T05["T05 全量复验与口径同步<br/>TEST_REPORT / 证据"]
  T06 --> T05
  T05 --> T07["T07 建库开销优化<br/>P2 可选"]
```

### 8.2 互斥文件矩阵

| 文件 | 独占任务 | 说明 |
|---|---|---|
| `tests/setup.ts` | **T01** → **T06** 接手 | 全仓唯一 env 入口；T06 追加探活 |
| `drizzle.config.ts` | **T01** | 影响 `drizzle-kit migrate` 的目标库；**必须与 setup.ts 一起改** |
| `tests/helpers/local-bin.ts` | **T01** | 全部子进程 spawn 的唯一出口 |
| `tests/helpers/test-db-lifecycle.ts` | **T02** | 阶段日志的唯一出口 |
| `tests/helpers/test-db-guard.ts` | **T01** → **T06** 接手 | T06 加 `v2ex_readiness_probe` |
| `tests/helpers/start-test-pg.sh` | **T02** → **T06** 接手 | **仓库内**脚本；T06 加稳态判据 |
| 10 个建库 spec | **T03** → **T07** 可能微调 | T01/T02/T04 不得并行改 |
| `vitest.config.ts` | **T04** | **仅注释**，零阈值变化 |
| `.github/workflows/*.yml` | **T04** | 只加 env |
| `TEST_REPORT.md` / `docs/evidence/` | **T05** | |
| `tests/**` 的 globalSetup | **T07** | |

**结论**：T01~T06 **必须串行**，不存在可并行的任务对。这是刻意的 ——
本轮问题的本质是「多份环境解析实现互相打架」，并行改同一批文件会引入新的不一致。
**T07 是 P2 可选**，可在 T05 之后独立进行，且允许「评估后决定不做」。

---

## 9. 方案对比与取舍记录

| 决策点 | 选择 | 被否决的方案 | 理由 |
|---|---|---|---|
| env 加载优先级 | shell > ENV_FILE > `.env.test` > `.env.local` > `.env` | 保留 `override: true` | 现有 `override` 反转了「shell 优先」语义，是问题 A 的技术根；`scripts/env-dump.mjs` 的注释已写明期望语义，实现未对齐。**QA 独立实测印证**（§3.2.1：命令行 `DATABASE_URL` 被静默忽略） |
| **`override: true` 的处置** | **按文件分四档**（§3.2.0）：<br>档 1 `src/db/index.ts` **保留**<br>档 2 `drizzle.config.ts` + `tests/setup.ts` **去掉**<br>档 3 `scripts/seed.ts` **只删自身 override 调用**（不动 `dotenv/config`）<br>档 4 `admin-cli.ts` / `db-admin.mjs` **不改** | ~~统一去掉 `override: true`~~（初稿口径，**过于粗糙**）<br>~~档 3 = 去掉 `dotenv/config` 或提前加载~~（第二稿口径，**被 deploy 复核推翻**） | ⚠️「统一去掉」在 `scripts/seed.ts` 上会**引入回归**。而 `src/db/index.ts` 的 override **必须保留** —— Next.js 运行时确实预加载 `.env.local`（实测找到加载代码）。<br>⚠️ 档 3 的第二稿结论也被推翻：`seed.ts` import 了 `../src/db/index`（档 1），**ESM import 提升使档 1 的模块体先执行** → 档 1 已用 override 抢先写入 ENV_FILE 的值 → `seed.ts` 自身的 override 是**冗余**的；「提前加载」在 ESM 下**做不到**（import 声明被提升）。**两稿分档都是 `software-engineer-deploy` 同步/质疑后补正的** |
| `.env.test` 处置 | **入仓无密模板 + 本地自动生成** | CI 全注入 / 带密入库 / 不解决 | 只有模板方案能让**新克隆仓库开箱可跑**，且模板本身就是变量清单文档 |
| 护栏形态 | **端点白名单 + 库名「精确枚举 + 证据库拒绝名单」双层**（两道） | 只做端点白名单；<br>~~库名前缀正则~~ | 端点白名单挡不住「5432 上的开发库」；库名判定**跨端点生效**。<br>⚠️ **前缀正则被实测否决**：主理人给出的 `^v2ex_(test|v003|v004|...)` 会命中 **`v2ex_v004_audit`**（升级审计证据库）—— 前缀通配把「版本号前缀」误当成「测试库命名空间」。改为精确枚举 + 14 个证据库的显式拒绝名单 |
| CI 是否放行 5432 | **放行**（端点白名单含 `localhost:5432`），但**库名仍受精确枚举约束** | CI 用不同端口 | CI 的 service container 端口固定 5432；真正的防线是库名枚举 |
| 测试实例 | **新实例 + 新端口 55440 + 新数据目录**<br>⚠️ **定位：隔离性 + 可复现性，不是性能修复** | 复用 55433；<br>~~把独立实例包装成「性能修复」~~ | 复用无法避免与 890MB 压测库共用 WAL/文件空间与 I/O；但**稳态建库本就 2s**，独立实例**不是**为了提速 —— 把它说成性能修复是**第三次误判的种子**，必须避免 |
| `fsync=off` | **不采纳** | 采纳 | 掩盖 durability 行为；若实例被误用会静默丢数据。且稳态 2s **根本不需要** |
| `hookTimeout` | **保持 120_000 不动**（**修正**：撤回「回落 60s」） | ~~回落 60s~~ / 继续上调 | 撤回理由：主理人实测稳态 2.0~2.3s、QA 实测 190/190 全绿 3m35s —— 120s 有充足余量，此时动阈值是**无收益的风险动作**。**真正要做的是改写那段过时的归因注释**（T04） |
| **PG 稳态判据** | **独立成 T06（P0 必做）** | 仅作为排查步骤 | 防的是「环境问题被误判成产品缺陷」—— 这是**代价最高**的错误类型，必须在测试**开始前**拦截，而不是事后排查 |
| `template1` 预置迁移 | **降级为 P2** | 采纳（初稿） | 稳态下 migrate 不是瓶颈；且若 T07 采用共享 globalSetup，其必要性进一步下降 |
| 换盘 / WSL / Docker | **降级为 P2 可选** | 采纳（初稿的「根治点」） | fsync 5ms 是本机存储**特性**不是 bug；且它只在**积压态**下才被放大 —— 治本是「保证稳态」而非「换盘」 |
| 生命周期托管 | **单次 Bash 调用内启动→测试→清理** | 跨调用保活 | 与 WorkBuddy 的进程回收机制对齐；跨调用保活已被实测证明不可靠 |
| 端口冲突处理 | **只杀 cmdline 含自己 PGDATA 的进程** | `taskkill /F /IM postgres.exe` | 宽泛 kill 有误杀风险 |
| `data-v003` | **只读保留** | 清理瘦身 | 含压测数据与升级基线，是 v0.0.4 证据 |

---

## 10. 待明确事项（需主人裁决）

| # | 问题 | 我的建议 | 影响 |
|---|---|---|---|
| **Q1** | ~~本机全量单测复验的定位~~ **【已被新数据基本回答】** | 主理人稳态实测 2.0~2.3s + QA 实测 **190/190 全绿 3m35s** → **本机全量跑得通**（3m35s，远低于任何阈值），**不需要**「本机快速子集 + 全量推 CI」的分工。<br>⚠️ 但 **CI 侧仍必须复验**，因为 `floor-continuity.spec.ts` 在 CI 上**必崩**（Q7） | ✅ **已消解**。T05 改为「本机 + CI 双侧全量」 |
| **Q2** | **`.env.test` 里的固定测试口令是否可接受**？我的方案是「本地隔离实例专用、不与真实凭据同源、仅监听 127.0.0.1」。 | **可接受**。若主人认为仍不妥，改为「口令必须由 `TEST_DB_PASSWORD` 环境变量提供，缺失即拒绝启动测试」——代价是首次使用门槛变高 | 决定 T01 中 `.env.test` 生成逻辑 |
| **Q3** | **是否允许在 `v2ex` 角色上保留超级用户权限**？实测 `rolsuper=t`；降级会影响 `pg_trgm` 扩展安装。 | **P0 阶段保持不变**（降级为 P2 议题）。测试实例是全新的、与生产无关，降级的收益有限 | 影响 T02 的初始化脚本是否包含 `ALTER ROLE` |
| **Q4** | **端口 55440 是否与主人的其它规划冲突**？实测 55434/55440/55444/55450 当前均空闲。 | **用 55440**，并预留 55444 给未来 E2E 独立实例 | 影响 T02 的 `PORT` 常量 |
| **Q5** | **CI 是否接受新增 `TEST_DB_ALLOWED_DATABASES` env**（护栏 2 需要显式放行 `v2ex_ci` / `v2ex_release_unit` / `v2ex_release_e2e`）？ | **接受**。这是「护栏在 CI 生效」的必要条件，且只是 env 增行 | 影响 T04 的 CI 改动范围 |
| **Q6** | **`tests/env/.env.test.example` 的目录位置**：放在 `tests/env/` 还是仓库根的 `.env.test.example`？ | **放 `tests/env/`** —— 仓库根已有 `.env.example`（生产模板），测试模板应分离，避免误用 | 影响 T01 的文件路径 |
| **Q7** | **是否需要把 `floor-continuity.spec.ts` 的 CI 崩溃作为独立缺陷登记**（进 `BUG_REGISTER.md`）？ | **建议登记**。这是本次新发现的、**已入库代码**中的确定性 CI 缺陷；且 QA 的 190/190 全绿是**本机**跑的，**不能**证明 CI 侧通过 | 影响 T05 是否同步 `BUG_REGISTER.md` / `RISK_REGISTER.md` |
| **Q8** | **【新增】是否接受「独立实例的定位是隔离性而非性能」这一改写？** | **强烈建议接受**。上一轮把独立实例（或超时上调）包装成「性能修复」，是**第三次误判的根源**。若继续用「性能修复」叙事，后续会话会再次尝试「换盘 / 调 fsync」等无效动作 | 影响 §4.1 / §4.4 / T02 验收标准 ⑩ 的**文案口径** |
| **Q9** | **【新增】T07（共享 globalSetup 优化建库开销）是否要做？** QA 数据：5 个文件重复「建库 + migrate」占 97% 耗时，全量 3m35s。 | **建议做，但排在 P2**。预估可降到 ~1m 以内；**先评估收益与断言风险，再决定实施或记录「不做理由」** | 影响 T07 是否启动 |
| **Q10** | ~~档 1（`src/db/index.ts`）的静默误跑要不要根治？~~ **✅ 已关闭（2026-11-04）** | **统一加载器 `src/lib/env-loader.mjs` 已根治** —— 用 `@next/env` 的 `initialEnv` 快照精确区分「shell 注入」与「文件占位」，使档 1 与档 2 **同时成立**（架构师实测双向验证，见 §2.4.9）。**不需要**另设 P2 方案 | **已无影响** |

---

## 11. 附录：本文档的实测数据来源

| 数据 | 获取方式 | 是否改动系统状态 |
|---|---|---|
| `data-v003` 大小 / 文件数 / 各 base 子目录大小 | `du -sh`、`find \| wc -l` | 否 |
| 各库体积 | `psql -c "select pg_size_pretty(pg_database_size(datname))"` | 否（只读查询） |
| `fsync` 延迟 | `pg_test_fsync.exe -s 3`（临时目录，跑完即删） | 临时文件，已清理 |
| 顺序写吞吐 | `_scratch/write-probe.mjs`（8MB×8，跑完即删） | 临时文件，已清理 |
| `CREATE DATABASE` 成本模型 | `_scratch/copydir-probe.mjs`（复制 `template1` + 逐文件 fsync，跑完即删） | 临时文件，已清理 |
| `initdb` locale 行为 | `initdb --locale=<x>`（**无效 locale 时 initdb 在建目录前即退出**；有一次成功创建了探测目录，已 `rm -rf` 清理） | 临时目录，已清理 |
| env 解析复刻 | `_scratch/simulate-setup.mjs` + 仓库内临时 `.mjs`（已删） | 否 |
| CI 崩溃复刻 | 仓库内临时 `.mjs` + 伪造 repo 路径（已删） | 否 |
| **dotenv `override` 语义四组合实测** | 临时 env 文件 + 仓库内临时 `.mjs`（已删，Temp 目录已清） | 临时文件，已清理 |
| **drizzle-kit 是否预加载 env** | 抛错的假 config 文件探针（已删） | 否（未连接数据库） |
| **Next.js env 预加载实现** | `node_modules/next/dist/compiled/next-server/server.runtime.prod.js` 源码核查 | 否 |
| **`scripts/seed.ts` 加载顺序实测** | 仓库内临时 `.mjs`（已删） | 否 |
| PG 日志 checkpoint 计时 | `grep -a "checkpoint complete" pg-v003.log` | 否 |
| **crash recovery 时间线** | `grep -a "syncing data directory\|redo\|自动恢复" pg-v003.log` | 否 |
| `pg_stat_checkpointer` / `pg_stat_bgwriter` | 只读系统视图查询 | 否 |
| 端口占用 | `netstat -ano` | 否 |
| 本机卷与磁盘 | `Get-Volume` / `Get-PhysicalDisk` | 否 |
| Defender 状态 | `Get-MpComputerStatus` | 否 |

### 11.1 引用的他人实测数据（**未由架构师复现**，标注来源）

| 数据 | 来源 | 用途 |
|---|---|---|
| 稳态 `CREATE DATABASE` = **2083 ms**；`DROP+CREATE` 三次 = **2277 / 1978 / 2243 ms** | **主理人**（2026-11-04 20:33-20:34，`data-v003` 实例，PG 稳态运行） | §0.1 第 3 轮勘误的**核心依据**；§4.6.2 验收基线 |
| 稳态 checkpoint `total=0.053s / 0.158s` | **主理人**（同上） | 同上 |
| 全量单测 **190/190 全绿，0 skipped，3m35s**，53/53 套件通过 | **QA（software-qa-ci）**（`097c1b9`，`ENV_FILE=.env.test`，未改任何超时阈值） | §4.1.1 耗时分布；§4.6.2 验收基线；T03 验收标准（190 条口径） |
| **190/15 基线归属证明**（mtime 时序 / `deploy/` 不在测试输入路径 / 工作区零改动 / 三方交叉校验） | **QA** | §2.5.1 —— 回应架构师的 commit 基线疑问 |
| **真实 CI run `41836588566`** 的 2567 行日志：`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)` / ENOENT 路径 / `e2e` job skipped | **QA**（下载真实 CI 日志解析） | §2.4.1~§2.4.4 —— **CI 崩溃已被真实 CI 证实**；T05 验收标准 ②' 的判读依据 |
| 纯净检出复现：`git archive HEAD` 导出 → `1 failed \| 14 passed (15)` / `148 passed` | **QA** | §2.4.1 —— 独立于真实 CI 的第二条证据 |
| 修复方案在纯净检出上的实跑验证（CI 5 passed / 本地 5 passed / 反证 `:55433/` 硬门） | **QA** | §2.4.5 —— 修复方案本身正确 |
| 逐文件耗时分布（content-lifecycle 22230ms / admin-cli 20838ms / seed-idempotency 16302ms / feed-search 9981ms / db-lazy-init 7417ms / 其余 10 文件合计 ~2100ms） | **QA** | §4.1.1；T07 优化点的依据 |
| `override: true` 使命令行 `DATABASE_URL` 失效（迁移跑到 `v2ex_e2e` 而非指定的 `v2ex_qa_migidem_v004`） | **QA**（独立踩坑并留证） | §3.2.1 —— 本节裁决的**独立外部佐证** |
| `npx vitest run --reporter=basic` 在 Vitest 5.0.5 **失败**（reporter 已移除）；可用 `--reporter=default --reporter=json --outputFile=...` | **QA** | T05 的复验命令口径 |
| **静态 grep `it(` 得出 180，运行时实为 190**（本项目用嵌套 for 循环生成用例） | **QA** | T03 验收标准的口径警示 |
| `ci.yml` 的 `e2e: needs: unit` 依赖结构 | **架构师核查**（`ci.yml` L153-156） | §2.4.2 —— 解释 153 条 E2E 为何在 CI 上从未执行 |

> **诚实声明**：架构师**未复现**上表中的 QA 与主理人数据（本轮为只读设计角色，未执行 vitest、未建库）。
> 引用它们是因为它们**直接决定本设计的取舍**，且**有明确的来源可追溯**。
> 凡架构师**自己**未实测的推算，一律在正文中标注「**待实测**」。

**未做的事**（明确声明）：
- 未执行 `CREATE DATABASE` / `DROP DATABASE` / `initdb`（针对真实数据目录）；
- 未启动或停止任何 PostgreSQL 实例；
- 未修改任何仓库文件（本文档与 4 个 `.mermaid` 除外）、未修改 `.env.local`、未改动 `data-v003`；
- 未执行 `git commit` / `git push` / `git reset` / `git clean`；
- 未运行 `vitest`（因此 §4.6.2 / §4.8 的阶段耗时均为**实测基础上的推算或待实测**，已逐项标注）。
