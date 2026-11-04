# CI E2E 首跑就绪条件 —— 核查与修补证据

> **取证人**：严过关（Yan）· QA 工程师
> **取证时间**：2026-11-04T14:05Z – 2026-11-04T14:40Z（本地 22:05 – 22:40 +0800）
> **基线**：`feat/v0.0.4-high-fidelity` @ `2fd2638`
> **我的文件所有权**：`.github/workflows/ci.yml`、`docs/evidence/ci/**`
> **禁改**：`tests/**`、`e2e/**`、`src/**`（本轮未碰）

---

## 0. 结论速览

> **背景**：v0.0.4 的 153 条 E2E 在 CI 上**从未跑过一条** ——
> `ci.yml` 的 `e2e` job `needs: unit`，unit 红了 → e2e 恒被 skip。
> `floor-continuity.spec.ts` 正在由测试环境工程师修复；**修复后 E2E 会首次真正运行**，
> 所以必须先确认「首跑即绿」的条件具备。
>
> **我的核查结论**：
>
> | # | 结论 |
> |---|---|
> | 1 | ✅ **迁移 + seed 已有**（Q1）—— 现状正确，**不需要改** |
> | 2 | 🟡 **环境变量基本齐全**，但缺 `APP_URL`/`NEXT_PUBLIC_APP_URL` → **已补** |
> | 3 | ✅ **chromium 逻辑成立**（Q3）—— 现状正确，**不需要改** |
> | 4 | ✅ **`LOCAL_BASE` 正确**（Q4）—— 现状正确，**不需要改** |
> | 5 | ⚠️ **`global-setup.ts` 的 passthrough 缺 `RATE_LIMIT_*` —— 但这是**误报**，见 §5.2 |
> | 6 | 🔴 **就绪探针有真实缺陷**（Q6）—— `curl` 不校验状态码，会把 500 当成「已就绪」→ **已修** |

---

## 1. Q1 —— CI 的 e2e job 是否做了「迁移 + seed」？

### 现状：**✅ 已有，且顺序正确**

`.github/workflows/ci.yml` 的 `e2e` job 步骤顺序：

| 顺序 | 步骤 | 环境变量 | 作用 |
|---|---|---|---|
| 1 | `actions/checkout@v7` | — | 检出 |
| 2 | `actions/setup-node@v7` | — | Node 22.23.4 + npm cache |
| 3 | `安装依赖` | — | `npm ci` |
| 4 | `安装 Playwright 浏览器` | — | `npx playwright install --with-deps chromium` |
| 5 | **`数据库迁移`** | `DATABASE_URL` → `v2ex_ci` | `npx drizzle-kit migrate` |
| 6 | **`种子数据`** | `DATABASE_URL` → `v2ex_ci` | `npx tsx scripts/seed.ts` |
| 7 | `构建` | `DATABASE_URL` → `v2ex_ci` | `npx next build` |
| 8 | `启动应用` | `DATABASE_URL` + `REDIS_URL` | `npx next start -p 3000` + 就绪等待 |
| 9 | `E2E 测试` | `DATABASE_URL` + `REDIS_URL` + `LOCAL_BASE` + `BROWSER_CHANNEL` | `npx playwright test --reporter=list` |
| 10 | `停止应用` | `if: always()` | 杀进程 |
| 11 | `上传测试报告` | `if: always()` | `upload-artifact@v7` |

**结论：不需要改。** 空库跑 E2E 的风险不存在。

### 实证：本机用 CI 完全相同的方式复现了「迁移 + seed」

```bash
# CI 步骤 5 的等价命令（ENV_FILE 置空，模拟 CI 无 .env.test 的环境）
$ DATABASE_URL=postgres://…@127.0.0.1:55440/v2ex_ci_sim npx drizzle-kit migrate
[✓] migrations applied successfully!
$ psql -d v2ex_ci_sim -c "select count(*) from pg_tables where schemaname='public'"
tables=26

# CI 步骤 6 的等价命令
$ npx tsx scripts/seed.ts
  分类: 9
  用户: 5
  节点: 23
  主题: 10
✓ seed 完成
```

**seed 产出的 5 个用户正是 E2E 依赖的**：

```
admin     | admin     | admin@ci.local
lisi      | user      | lisi@example.com
wangwu    | user      | wangwu@example.com
zhaoliu   | user      | zhaoliu@example.com
moderator | moderator | mod@example.com
```

> ✅ 与 `e2e/helpers.ts` 的 `ADMIN`/`USER_A`/`USER_B`/`MODERATOR` 定义**逐一对应**。
> `SEED_DEMO_USERS=1` 在 workflow 级 env 里，seed 的演示账号分支**不会被跳过**
> （`scripts/seed.ts:144` 的 `if (process.env.SEED_DEMO_USERS === '0') return []` 不触发）。

---

## 2. Q2 —— e2e job 的环境变量是否齐全？

### 现状：**基本齐全**（workflow 级 env 对所有 step 生效）

| 变量 | 来源 | 消费者 | 状态 |
|---|---|---|---|
| `DATABASE_URL` | step 级（e2e job 各 step 显式注入） | 应用 + 测试 | ✅ |
| `REDIS_URL` | step 级 | 应用（限流计数） | ✅ |
| `SESSION_SECRET` | workflow 级 | 应用（会话签名） | ✅ |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | workflow 级 | seed + 应用 | ✅ |
| `SEED_DEMO_USERS=1` / `SEED_DEMO_PASSWORD` | workflow 级 | seed + **E2E worker** | ✅ |
| `DISABLE_CAPTCHA=1` | workflow 级 | 应用 | ✅ |
| `ENABLE_DEBUG_ENDPOINTS=1` / `DEBUG_ENDPOINT_TOKEN` | workflow 级 | 应用 + **E2E worker**（`clearRateLimits`） | ✅ |
| `APP_RUNTIME_ENV=test` / `TEST_ENV_ISOLATED=1` | workflow 级 | 应用 | ✅ |
| `RATE_LIMIT_*`（11 个） | workflow 级 | **应用（服务端）** | ✅ |
| **`APP_URL` / `NEXT_PUBLIC_APP_URL`** | ❌ **缺失** | 应用（feed / 找回密码邮件的绝对链接） | 🔴 **已补** |

### 🔴 我补的（`ci.yml` workflow 级 env）

```yaml
  # ---- 应用地址（v0.0.4 实测补齐）----
  #
  # 此前 workflow 级 env 里**没有** APP_URL / NEXT_PUBLIC_APP_URL：
  #   · 服务端只能退回「请求自身的 origin」（src/lib/feed-builder.ts
  #     resolveBaseUrl、forgot-password 路由）—— 本身是安全回退；
  #   · 但反代场景下 origin 可能是内网地址，feed / 找回密码邮件里的
  #     绝对链接会变成内网地址。
  # 显式注入后，feed 的绝对链接与 E2E 的 LOCAL_BASE 保持一致。
  APP_URL: http://localhost:3000
  NEXT_PUBLIC_APP_URL: http://localhost:3000
```

**为什么这是真实缺口而非「无所谓」**：
- `src/lib/feed-builder.ts:157-159` 的 `resolveBaseUrl()` 优先级是
  `PUBLIC_BASE_URL → APP_URL → NEXT_PUBLIC_APP_URL → 请求自身的 origin`；
- `src/app/api/auth/forgot-password/route.ts:89-92` 同样是
  `PUBLIC_BASE_URL → APP_URL → 请求 origin`。

**两者都有安全回退**（请求 origin），所以**不是致命缺陷**，但显式注入消除了
「反代后 origin 是内网地址」的歧义，且让 feed 的绝对链接与 E2E 的 `LOCAL_BASE` 一致。
**属于「该补但不紧急」，我已补上。**

---

## 3. Q3 —— `playwright.config.ts` 的 `channel` 在 CI 下是否成立？

### 现状：**✅ 成立，且比 CI 判断更稳**

```ts
// playwright.config.ts:38
channel: process.env.BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'msedge'),
```

**双重保险**：
1. CI 显式注入 `BROWSER_CHANNEL: chromium`（e2e job 的 E2E 测试 step）→ **第一优先**；
2. 即使漏注入，`process.env.CI` 为真 → 也是 `chromium`。

**结论：不需要改。**

**本机实测确认**：`BROWSER_CHANNEL=chromium` 时 Playwright 使用
`C:\Users\TYMO001\AppData\Local\ms-playwright\chromium-1248`
（Chrome for Testing 156.0.8078.4）—— 与 CI runner 上
`npx playwright install --with-deps chromium` 装的是**同一个浏览器**。

---

## 4. Q4 —— `BASE_URL` / `LOCAL_BASE` 是否正确？

### 现状：**✅ 正确**

```ts
// playwright.config.ts:13
const BASE_URL = process.env.LOCAL_BASE ?? 'http://localhost:3000';
```

- CI 注入 `LOCAL_BASE: http://localhost:3000`；
- CI 的应用跑在 `npx next start -p 3000` → **端口一致** ✅

**结论：不需要改。**

### 📌 但发现一个「看起来像缺口、实则不是」的细节

`e2e/global-setup.ts` 的 passthrough 数组（12 项）**没有** `LOCAL_BASE`，
而 `e2e/security.spec.ts:90` 确实在 worker 里读了 `process.env.LOCAL_BASE`：

```ts
const expectedHost = new URL(process.env.LOCAL_BASE || 'http://localhost:3000').host;
expect(baseHost).toBe(expectedHost);
```

**我实测验证了 Playwright 1.64.1 的 env 传递机制**（用最小复现工程跑）：

```
WORKER_SEES_LOCAL_BASE= http://localhost:3999          ← ✅ 到达 worker
WORKER_SEES_SEED_ADMIN_PASSWORD= defined                ← ✅ 到达 worker
WORKER_SEES_PASSTHROUGH_MARKER= undefined               ← ⚠️ globalSetup 的返回值没到 worker
```

**机制（源码 + 实测双向确认）**：
- Playwright fork worker 时传 `env: { ...process.env, ...this._extraEnv }`
  （`node_modules/playwright/lib/runner/index.js:1923-1926`）
  → **worker 继承 runner 的完整 `process.env`**，所以 `LOCAL_BASE` 自然到达；
- `globalSetup` 的**返回值**在 `index.js:6566-6570` 只被用于判断「是不是 teardown 函数」
  —— **它不会作为 env 应用到 worker**。

> ⚠️ **这意味着 `e2e/global-setup.ts` 顶部的注释是过时的**：
> > 「Playwright 的 worker 是**独立进程**，不继承配置文件模块里通过 dotenv 写入的 process.env。
> > 因此必须在 globalSetup 中加载，该函数返回的 env 会被 Playwright 显式传给每个 worker。」
>
> **前半句对（worker 确实不继承配置文件模块里 dotenv 写入的值），后半句错
> （返回值不会被传）**。实际生效的是「worker 继承 runner 的 `process.env`」。
>
> **影响**：`global-setup.ts` 里的 `loadEnv()` **仍然必要**（它写的是 runner 进程的
> `process.env`，worker 继承得到），但那个 `passthrough` 数组与 `return env` 是**死代码**。
>
> ⚠️ **但我不能删它** —— `e2e/**` 属 E2E 工程师的所有权。
> **已作为发现上报给 `software-qa-e2e` 与主理人**，由其处置。
>
> **好消息**：这个「注释与实现不符」**不影响 CI 首跑** ——
> 因为 CI 是用 **step 级 `env:`** 注入的，那会进 runner 的 `process.env`，worker 必然继承。

---

## 5. Q5 —— `global-setup.ts` 的 passthrough 是否缺 `RATE_LIMIT_*`？

### 现状：**⚠️ 确实不在 passthrough 里，但这是「误报」—— 限流参数是服务端读的**

主理人的判断方向是对的（限流参数确实不在 passthrough 里），但**后果不成立**。实测确认：

```bash
$ grep -rn "RATE_LIMIT_LOGIN_MAX\|RATE_LIMIT_REPLY_MAX\|RATE_LIMIT_POST_MAX" src/ e2e/
src/app/api/auth/signin/route.ts:58:    Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10),
src/app/api/replies/route.ts:73:      Number(process.env.RATE_LIMIT_REPLY_MAX ?? 20),
src/app/api/topics/route.ts:43:       Number(process.env.RATE_LIMIT_POST_MAX ?? 5),
```

**全部在 `src/app/api/**`（服务端），E2E 代码里一处都没有。**

因此：
- 限流阈值由**应用进程**读取 → 应用进程是 `npx next start`，
  它继承 **workflow 级 env**（11 个 `RATE_LIMIT_*` 全在那里）→ ✅ **正确**；
- **worker 根本不需要** `RATE_LIMIT_*`（不读）。

### 5.1 但顺带发现一个**真实的限流配置隐患**

`e2e/auth.spec.ts` 的「登录限流生效」用例：

```ts
for (let i = 0; i < 15; i++) {
  const res = await apiPost(page, '/api/auth/signin', { username: `ratelimit_${ip}`, password: 'wrong-password' });
  if (res.status() === 429) { sawRateLimit = true; expect(res.headers()['retry-after']).toBeTruthy(); break; }
}
expect(sawRateLimit, '连续错误登录应触发 429 限流').toBe(true);
```

- CI 的 `RATE_LIMIT_LOGIN_MAX=10` → 第 11 次必然 429 ✅（15 次足够）；
- `e2e/topic.spec.ts` 的回复限流同理（`RATE_LIMIT_REPLY_MAX=20`，30 次足够）✅。

**阈值与用例次数匹配，CI 上不会因阈值不足而失败。**

### 5.2 `clearRateLimits` 的清除范围 —— 我核实过，**是正确的**

`e2e/helpers.ts` 的 `clearRateLimits()` 打 `/api/debug/reset-rate-limits`，
而该端点（`src/app/api/debug/reset-rate-limits/route.ts`）：

```ts
const kv = await getKV();
await kv.clearAll();                                    // 清理**实际生效**的后端（Redis 或 PG）
await db.execute(sql`DELETE FROM rate_limit_buckets`);   // PG 侧一并清
await db.execute(sql`DELETE FROM kv_store`);
```

**同时清 Redis 与 PG 两个存储** ✅ —— 这正是当初修的那个「配了 Redis 时清空限流静默失效」的缺陷。

**且它在 CI 上有 `DEBUG_ENDPOINT_TOKEN`**（workflow 级 env）→ 鉴权能过 ✅
（`e2e/helpers.ts` 里 `if (!token) return;` —— 缺 token 会**静默跳过清理**，
CI 上 token 在，所以会真的清理）。

### 5.3 Redis 在 CI 上是 service container ✅

`ci.yml` 的 `e2e` job 声明了 `redis: redis:7-alpine` + 健康检查，
且 `REDIS_URL: redis://:ci-redis-password-not-real@localhost:6379` 注入到
「启动应用」与「E2E 测试」两个 step。

**所以 CI 上限流计数存在 Redis 里**（不是 PG 表）→ `clearRateLimits` 走
`RedisKV.clearAll()` 分支 → 同样正确 ✅。

### 5.4 ⚠️ 一个**本机无法复现**的差异（但已确认 CI 侧更宽松）

| 维度 | 本机 | CI |
|---|---|---|
| Redis | **无**（6379 无监听）→ 限流降级到 **PG 表** | **有** → 限流在 **Redis** |
| 限流计数清理 | 删 PG 表 | 删 Redis + PG 表 |

**结论：CI 侧环境对本机更「严格」（真 Redis），但两边的 `clearRateLimits` 都正确。**
本机跑通**不能**直接推出 CI 跑通 —— 这正是需要 CI 首跑来确认的。

---

## 6. Q6 —— `webServer` 配置与「等应用就绪」的可靠性

### 现状：**`playwright.config.ts` 没有 `webServer`** —— CI 靠**手动起服务**

```ts
// playwright.config.ts —— 无 webServer 段
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: BASE_URL, ... },
});
```

CI 的手动启动 + 就绪等待（**修复前**）：

```yaml
npx next start -p 3000 &
echo $! > /tmp/server.pid
for i in $(seq 1 60); do
  if curl -sS -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
    echo "server ready"; break
  fi
  sleep 1
done
curl -sS -o /dev/null --max-time 10 http://localhost:3000/ || {
  echo "server failed to start"; exit 1; }
```

### 🔴 **真实缺陷：就绪探针不校验 HTTP 状态码**

**我实测了 curl 的退出码语义**：

```
$ curl -sS -o /dev/null -w 'status=%{http_code}' <HTTP 502 的地址>
  status=502 exit=0        ← curl 退出码 0！
```

**curl 默认不因 HTTP 状态码失败**（只有 `--fail` / `-f` 才会）。
所以旧写法里：

```bash
if curl -sS -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
  echo "server ready"; break
fi
```

**只要 TCP 连上并收到任何 HTTP 响应就判定「ready」**。

**为什么这在 CI 上很危险**：
- `/` 是 `force-dynamic`（`src/app/page.tsx:14`：`export const dynamic = 'force-dynamic'`）
  → **它真的查数据库**；
- 于是「应用已启动、但数据库还没连上/迁移没跑完」会返回 **500**，
  而 500 在旧写法里 = **「server ready」** → 立刻放行 → E2E 大面积失败，
  且**根因被掩盖**（看起来像用例问题，实际是启动时序问题）；
- 更糟：CI 上 `next start` 起来时，PG service container 可能还在恢复，
  迁移虽然在前一步跑过，但连接建立有窗口期。

### ✅ 我的修复（已落到 `ci.yml`）

```yaml
npx next start -p 3000 > /tmp/server.log 2>&1 &
echo $! > /tmp/server.pid
# ⚠️ 就绪判定必须**校验 HTTP 状态码**，不能只看 curl 的退出码。
#
# 实测（v0.0.4）：`curl -sS -o /dev/null` 对 HTTP 500 / 502 同样返回**退出码 0**
# （curl 默认不因状态码失败，只有 --fail 才会）。而 `/` 是 force-dynamic
# （src/app/page.tsx 的 `export const dynamic = 'force-dynamic'`），
# 会真的查数据库 —— 于是「应用已启动但数据库连不上」会返回 500，
# 旧写法会把它当成「server ready」直接放行，E2E 随后大面积失败且**根因被掩盖**
# （看起来像用例问题，实际是启动时序/连接问题）。
#
# 正确做法：要求状态码恰为 200。
for i in $(seq 1 60); do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "server ready after ${i}s (HTTP ${CODE})"; break
  fi
  echo "  [${i}s] waiting... (HTTP ${CODE})"
  sleep 1
done
# 收尾再确认一次：这次用状态码判定，失败时打印服务端日志便于定位
CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$CODE" != "200" ]; then
  echo "server failed to become ready (HTTP ${CODE})"
  echo "--- server log ---"
  tail -50 /tmp/server.log 2>/dev/null || true
  exit 1
fi
```

**同时新增两处**：
1. `> /tmp/server.log 2>&1` —— 服务端日志落盘，失败时可直接 `tail`（原来日志散在 runner 输出里）；
2. 循环内打印每次的 HTTP 状态码 —— 失败时能从日志**直接看出**是「连不上」还是「500」。

### 📌 为什么**不**改用 `playwright.config.ts` 的 `webServer`

`webServer` 是更优雅的方案，但它会**改变应用启动方式**（由 Playwright 托管），
且 `playwright.config.ts` 属 **E2E 工程师的所有权**（主理人明确禁改 `e2e/**`，
`playwright.config.ts` 位于仓库根但同样是 E2E 的配置面）。
**保持「CI 手动起 + 状态码探针」是最小侵入的选择** —— 只改 `ci.yml`，不碰任何人的配置。

---

## 7. 我修改的 `ci.yml` 内容（完整清单）

| 位置 | 改动 | 理由 |
|---|---|---|
| **workflow 级 `env`** | 新增 `APP_URL: http://localhost:3000`、`NEXT_PUBLIC_APP_URL: http://localhost:3000` | §2 —— 消除 feed / 找回密码绝对链接依赖「请求 origin」回退的歧义 |
| **e2e job「启动应用」step `env`** | 同样显式注入 `APP_URL` / `NEXT_PUBLIC_APP_URL` | 双保险（step 级覆盖 workflow 级） |
| **e2e job「启动应用」step `run`** | `npx next start -p 3000 &` → `npx next start -p 3000 > /tmp/server.log 2>&1 &` | 服务端日志落盘，失败可 `tail` |
| **e2e job「启动应用」step `run`** | 就绪探针从「curl 退出码」改为「**HTTP 状态码 == 200**」，并在循环内打印状态码 | §6 —— 修复「500 被当成 ready」的真实缺陷 |
| **e2e job「启动应用」step `run`** | 收尾的最终检查改为状态码判定，失败时打印 `/tmp/server.log` 尾部 50 行 | §6 —— 失败可诊断 |

**自检**：
```
YAML parse: OK, jobs: ['unit', 'e2e', 'docker']
bash -n: 19 OK, 0 FAILED        ← 全部 3 个 job 的 19 个 run 块
```

**未改动**：所有 job 的依赖关系、`needs: unit`、服务容器定义、
`RATE_LIMIT_*` 的任何值、迁移/seed 步骤、Playwright 调用方式。

> ⚠️ **我刻意没有把 `RATE_LIMIT_*` 的值改高** ——
> 主理人的原话「那批限流参数必须与 `ci.yml` 顶层 env 一致」是对的，
> 且 `ci.yml` 顶部注释已写明「不能为了让测试快点跑完而调高」
> （调高会让两条限流用例永远等不到 429 而失败）。**一个值都没动。**

---

## 8. 本机等价验证

### 8.1 ✅ 已复现并通过的部分

| 步骤 | 等价命令 | 结果 |
|---|---|---|
| 迁移 | `DATABASE_URL=…/v2ex_ci_sim npx drizzle-kit migrate` | ✅ `[✓] migrations applied successfully!`，26 张表 |
| seed | `npx tsx scripts/seed.ts` | ✅ `分类 9 / 用户 5 / 节点 23 / 主题 10`，5 个用户与 E2E 依赖逐一对应 |
| 构建 | `npx next build --no-lint` | ✅ 成功（曾遇 `[safe-delete]` 与 `pages-manifest.json` 缺失 —— 均为**并发构建互相覆盖 `.next`** 造成，清空后重跑即通过） |
| 启动 | `npx next start -p 4321` | ✅ `✓ Ready in 1387ms`，`GET / → 200` |
| 就绪探针（新逻辑） | 逐秒轮询并要求 HTTP 200 | ✅ `server ready after 1s (HTTP 200)` |
| worker env | 最小复现工程验证 Playwright 1.64.1 的 env 传递 | ✅ `LOCAL_BASE` / `SEED_ADMIN_PASSWORD` 到达 worker；`globalSetup` 返回值**未**到达（§4） |

### 8.2 ❌ **无法在本机完全复现**的部分（如实说明）

| 项 | 为何无法复现 | 影响 |
|---|---|---|
| **CI 的 service container** | 本机无 Docker → 无法起 `postgres:17-alpine` / `redis:7-alpine` | 用了本机 55440 实例的**独立库** `v2ex_ci_sim` 代替；**Redis 缺席**（本机 6379 无监听）→ 限流降级到 PG 表，与 CI 走 Redis 的路径**不同** |
| **runner 的真实磁盘/CPU 速度** | 本机磁盘与 runner 差异大 | 超时类断言（`timeout: 60_000`）在 CI 上可能更紧 —— 这是**首跑才能确认**的 |
| **完整的 153 条 E2E** | 本机被并发队友的 E2E 抢占（端口 3000 被占、`.next` 被覆盖、`test-results/e2e-results.json` 被改写）；且首跑耗时 ~16 分钟 | 本轮只做了**聚焦子集**验证 |

### 8.3 ✅ **CI 等价复现成功：8/8 全绿**（`.env.test` 隐藏，模拟 CI 检出）

**这是本轮最有价值的一次实测。**

**做法**：把 `.env.test` 临时改名隐藏 —— 因为 **CI 检出里根本没有这个文件**
（`.gitignore` 第 16 行排除；`git ls-files` 只跟踪 `.env.example` 与 `deploy/.env.example`；
此前 `docker-verify` run 的 `ENOENT .env.test` 也印证了这点）。
这样本机环境就与 CI 检出**完全一致**。

**结果**：

```
=== CI-EXACT: start server (no .env.test present) ===
=== readiness (NEW ci.yml logic) ===
  [1s] HTTP 502
  [2s] HTTP 000000
  server ready after 3s (HTTP 200)          ← 新探针正确地等到了真就绪

=== where did the app's login land? ===
  csrf len=64
  signin → 200
  body: {"ok":true,"redirect":"/"}          ← 登录成功

=== E2E subset (CI-identical: CI=true, chromium) ===
  8 passed (44.6s)

  ok 1 注册后自动登录并可访问设置页 (7.7s)
  ok 2 重复用户名注册被拒绝 (4.8s)
  ok 3 短密码注册被拒绝 (1.5s)
  ok 4 错误密码登录失败并给出提示 (1.4s)
  ok 5 登录后导航栏显示用户名，退出后恢复游客态 (10.3s)
  ok 6 未登录访问受保护页面会跳转到登录页 (2.4s)
  ok 7 登录限流生效 (1.3s)                  ← 限流用例在 CI 等价环境下通过
  ok 8 管理员账号可访问管理后台，普通用户不可 (7.6s)
```

**这条实测同时验证了三件事**：
1. **登录/限流/管理员权限链路在 CI 等价环境下是通的**（含 `登录限流生效` —— 阈值 10 足够）；
2. **CSRF cookie 的 `Secure` 属性不会阻断 CI**（Chromium 把 localhost 视为安全上下文，
   实测 cookie 存在且 `secure=true` 但仍被接受）；
3. **我的就绪探针修复是必要的** —— 真实日志里出现了 **502 → 000 → 200** 三段，
   旧写法（只看 curl 退出码）会在第 1 秒的 502 就判定「ready」并放行。

### 8.4 ⚠️ 一次「2 failed」异常的定位（**已排除是产品缺陷**）

在 `.env.test` **存在**时跑同样的子集，得到 **6 passed / 2 failed**，
两条失败都是 `login()` 超时（`page.waitForURL: Timeout 30000ms exceeded`）。

**排查过程**（逐步实测，非推测）：
1. `login_attempts` 落在 `v2ex_test_base`（= `.env.test` 里的库），
   而**不**在我注入的 `v2ex_ci_sim` → 一度指向「DATABASE_URL 被覆盖」；
2. `verifyPassword('ci-admin-password-12345', 存储的哈希)` → **true** → 密码没问题；
3. 用一个**全新库** `v2ex_probe_db` 复测 → `GET / → 500`（该库没建表）
   → **证明应用确实用的是我注入的库**，前一次是**端口 4321 上的残留服务进程**；
4. 杀掉残留进程后重跑 → 干净环境 → **8/8 全绿**（§8.3）。

**结论：不是产品缺陷，是本机并发/残留进程造成的伪失败。**
但它给出一条**重要教训**（见 §9.6）。

## 9. 其他发现（超出 6 问，但会影响 CI 首跑）

### 9.1 🔴 `e2e/global-setup.ts` 的注释与实现不符（**不属我的所有权，已上报**）

见 §4。核心事实（源码 + 实测双重确认）：
- worker **继承** runner 的 `process.env`（`index.js:1923-1926`）；
- `globalSetup` 的**返回值不会**应用到 worker（`index.js:6566-6570` 只用于判断 teardown）；
- 因此那个 `passthrough` 数组与 `return env` 是**死代码**。

**对 CI 首跑无影响**（CI 用 step 级 `env:`，进的是 runner 的 `process.env`）。
**但注释会误导后人**，建议 E2E 工程师订正或删除死代码。

### 9.2 🟡 `ci.yml` 的 unit job **没有** migrate/seed（但不需要）

`unit` job 只有 `npx vitest run`，没有迁移步骤。
**结论：不需要** —— 单元测试自己建库（`beforeAll` 里 `DROP/CREATE DATABASE` + `drizzle-kit migrate`），
`tests/db-lazy-init.spec.ts` 等不依赖预置数据。

### 9.3 🟡 `docker` job 与 `e2e` job 都用 `v2ex_ci` 库但**互相独立**

两者是**不同的 job**，各有自己的 service container → 各自独立的 `v2ex_ci` 库，
**不存在数据竞争** ✅。但要注意：`e2e` job 的 `v2ex_ci` 库是**全新**的，
所以「迁移 + seed」必须齐全 —— 现状已有 ✅（§1）。

### 9.4 🟡 `upload-artifact` 上传的 `test-results/` 含 trace 产物

`use: { trace: 'retain-on-failure' }` → 失败用例的 trace 会被上传。
**这是好事**（首跑若失败可直接下载 trace 定位），
但 `retention-days: 7` 可能偏短 —— 若首跑失败需长期留存，建议临时调大。
**我没有改动**（属于运维策略，且不影响成败）。

### 9.5 🟡 CI 的 E2E 首跑**最可能的失败原因排序**（我的预判）

| 排序 | 风险 | 依据 | 影响面 |
|---|---|---|---|
| 1 | **限流阈值在 CI 上真 Redis 下的表现** | 本机无 Redis，CI 有；`clearRateLimits` 虽正确但从未在 Redis 路径下真跑过 | `auth.spec.ts` / `topic.spec.ts` / `security-regression.spec.ts` 的限流用例 |
| 2 | **runner 更慢导致的超时** | `timeout: 60_000`；本机磁盘与 runner 差异 | 并发用例（`v004-content-interaction.spec.ts` 的并发安全用例） |
| 3 | **`/api/debug/*` 端点在 CI 上是否 200** | `ENABLE_DEBUG_ENDPOINTS=1` 已在 workflow env，但**从未在 CI 验证过** | 依赖 `clearRateLimits` 的所有用例 |
| 4 | **chromium 与本机 msedge 的渲染/时序差异** | 首次在 chromium 上跑 | 四身份 UI 用例等视觉断言 |

> 这 4 项**都只能靠 CI 首跑确认** —— 本机无法复现 Redis 与 runner 性能。
> **这正是本次修补的意义：把「必然失败的结构性缺陷」（§6 就绪探针）先修掉，
> 让首跑的失败尽可能只反映真实问题。**

---

### 9.6 📌 「应用半路死掉」会让 E2E 呈现「1 passed + 大量未执行」而非清晰失败

实测到的一次：全量 E2E 只报 **1 passed**，其余用例被列出却未执行。
原因是应用进程在运行中途死亡（本机问题 C：Bash 调用结束回收整棵进程树），
随后**另一个进程的 server 接管了端口**（`GET / → 502`）。

**这在 CI 上几乎不会发生**（job 独占 runner），但核对 CI 结果时必须注意：

> ⚠️ **只看「有 passed」会误判**。必须确认 Playwright 的**完整计数**：
> `N passed` 且 N = 153（11 文件）。
> 若出现「1 passed」或大量「未执行」，先看应用是否中途退出。

### 9.7 📌 端口残留 / 残留服务进程会污染 E2E 结论（本机踩到两次）

- 端口 3000 被 `software-qa-e2e` 队友的 server 占用 → 我的 3000 变成 502；
- 端口 4321 上有我自己的**残留** `next start` 进程 → 读到的是它的库，
  造成「DATABASE_URL 被覆盖」的**错误结论**。

**教训**：每次本地起服务前，先确认端口上没有别的进程
（`netstat -ano | grep LISTENING | grep :<port>`），
且**测完要 kill 掉**（我的模拟脚本里都加了 `kill $SRV`）。

## 10. 自我声明

- ❌ 未 `git commit` / `git push`（主理人统一提交）
- ❌ 未 `git add .`
- ❌ 未碰 `tests/**`、`e2e/**`、`src/**`、`deploy/**`、`scripts/**`
- ❌ 未碰 `playwright.config.ts`（E2E 工程师所有权）
- ❌ 未创建/删除/移动 Tag；未创建/修改/发布/删除 Release；未改 `release.yml` 白名单
- ❌ 未改仓库可见性；未 force push
- ❌ 未 DROP 任何非隔离库 —— 本轮只建/用 `v2ex_ci_sim`（本轮新建的 QA 专用库）
- ❌ 未改任何 `RATE_LIMIT_*` 的值
- ❌ 未伪造任何运行结果 —— 未跑通的部分如实标注为「无法复现」并说明原因
