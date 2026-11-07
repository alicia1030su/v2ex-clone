# V2EX Clone v0.0.9 正式公开发布前 · 最终安全与发行审计报告

> **审计人**：严过关（QA Engineer）
> **审计性质**：**只读静态审计**。全程未修改任何应用源码，未执行 git commit / push / 建 Tag / 建 Release / 触发任何 GitHub Actions；唯一写入文件即本报告。

---

## 0. 审计元信息

| 项 | 内容 |
|---|---|
| **审计基线 SHA** | `af616356004877005153ad39bc187c3aed06e082`（`master` = `origin/master`，提交信息 `fix(v0.0.9): 恢复显式 secrets 传递 —— secrets: inherit 不提供 GITHUB_TOKEN`，2026-11-07 22:36:07 +0800） |
| **未合并 PR #32** | `8d6df8af771614a02c887b5c9ce707602c90e9d6`，分支 `fix/v0.0.9-soak-design-and-release-notes` |
| **PR #32 差异范围** | 仅 3 个工作流文件：`.github/workflows/release.yml`、`soak-segment.yml`、`soak-test.yml`（`238 insertions(+), 86 deletions(-)`）。经 `git diff master -- src/ \| wc -l` = **0** 确认：**应用源码与基线逐字节一致**，本次所有应用侧结论对 master 与 PR #32 同时成立 |
| **PR #32 对安全门禁的影响** | `security-scan` job（`npm audit` high/critical 阻断、gitleaks、发布包内容检查）**未被改动**；仅 Release Notes 文本新增 3 行「✅ 通过」表述（见 §12 注意事项） |
| **审计时间** | 2026-11-08 00:33 +0800（本机 `date`） |
| **审计方法** | 源码逐文件审阅 + 全仓 Grep/Glob 枚举 + 等价 Node 脚本在内存中复现静态守卫 + Git 树/跟踪状态实测 + CI 工作流与部署清单静态比对 |
| **结论分级** | `通过` / `关注` / `P0 阻断`；关注项统一编号 A-01 ~ A-14（见 §4） |

### 0.1 审计限制（必须随结论一并阅读）

| # | 限制 | 对结论的影响 |
|---|---|---|
| L1 | **本机 Docker 守护进程不可用** —— 未执行 `docker build` / `docker pull` / `docker-verify.yml` 的镜像内检查 | 镜像层结论**只能**基于 `Dockerfile`、`.dockerignore`、`docker-compose.yml` 与既有 CI 报告静态推断；**不声称镜像已实扫** |
| L2 | **未执行真实动态扫描**：未跑 `npm audit`、gitleaks、trivy/grype/snyk、未启动应用、未发任何真实 HTTP 攻击请求 | §12 的漏洞数字**一律不伪造**；本报告的「通过」指**静态代码属性成立**，不等于「动态验证通过」 |
| L3 | 未执行 `vitest` / `playwright`（避免写入 `test-results/` 等产物） | 对 `tests/v005-security-audit.spec.ts` 的守卫采用**等价 Node 只读脚本**复现：`sql.raw(` 在 `src/` 零命中、SQL 插值 offenders = **0**、45 个写端点防护缺失 = **0** |
| L4 | R-01 历史素材问题**仅**确认「当前 master 树 / 新产物」范围 | 不扩大、不改写历史、不重做 `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` 的结论（见 §13） |
| L5 | 工作区含多个本机 `.env.*`（`.env.local` / `.env.v009` / `.env.e2e009` / `.env.prod-verify` / `.env.test` / `.env.audit.local` / `.env.v009upg`） | 实测 `git status --porcelain --untracked-files=all` 为**空**，且 `.gitignore:22-69` 明确忽略 `.env.*` ⇒ **均不入库、不进发布产物**；本报告不读取、不转述其内容 |

---

## 1. 结论速览

| # | 审计项 | 结论 | 核心证据 | 关联关注项 |
|---|---|---|---|---|
| 1 | Session Cookie | **通过** | `src/lib/auth.ts:10-11,22-35,80-89,96-133` | A-06 |
| 2 | CSRF 双提交 | **关注** | `src/lib/csrf.ts:19,22-24,49-78`；`src/middleware.ts:112-113,119-164` | A-02 |
| 3 | Host Header / X-Forwarded-Host | **通过** | `src/lib/public-base-url.ts:29-67`；`src/app/api/auth/forgot-password/route.ts:91-104` | A-10 |
| 4 | 303 / 开放重定向 | **通过** | `src/lib/redirect.ts:24-33,49-58`；`src/app/api/replies/route.ts:38,44,256` | — |
| 5 | 限流与 PgKV 降级 | **关注** | `src/lib/rate-limit.ts:29-66`；`src/lib/kv.ts:54-61,102-134,155-188`；`src/app/api/auth/signin/route.ts:55-60` | A-07 / A-08 |
| 6 | 文件上传 | **通过** | `src/lib/avatar.ts:67-112,125-141,194-269,316-333`；`src/app/api/users/avatar/route.ts:32-121`；`src/app/uploads/[...path]/route.ts:39-98` | — |
| 7 | 管理员权限 / 越权 | **通过** | `src/lib/admin-guard.ts:27-71`；`src/lib/permissions.ts:39-51,73-99,116-147` | — |
| 8 | SQL 注入 | **通过** | 全仓 `sql.raw(` 零命中；等价守卫 offenders = 0；`src/lib/content-service.ts:642-653` | A-12 |
| 9 | 敏感日志脱敏 | **关注** | `src/lib/observability.ts:250-265,288-314`；`src/lib/public-base-url.ts:61-64`；`src/lib/audit.ts:90` | A-09 |
| 10 | 测试端点生产隔离 | **关注** | `src/lib/runtime-flags.ts:45-49`；`src/lib/debug-auth.ts:17-46`；`docker-compose.yml:99-103`；`deploy/docker-compose.yml:113-116` | A-01 |
| 11 | **instrumentation.ts 专项** | **关注** | `src/instrumentation.ts:44-120`；`src/lib/observability.ts:124-247` | A-03 / A-04 / A-05 |
| 12 | npm / Docker 依赖漏洞 | **关注** | `package.json:41-74`；`Dockerfile:8,150-159`；`.github/workflows/release.yml:481-560,610-675` | A-11 |
| 13 | Secret scanning / R-01 | **通过** | `git ls-tree -r --name-only master` 实测；`.dockerignore:8-11`；3 个被跟踪 env 模板全为空值/占位符 | A-14 |
| 14 | **是否存在 P0 真实可利用漏洞阻断发布** | **NO** | 见 §5 | — |

**统计**：通过 **7** 项、关注 **6** 项、P0 阻断 **0** 项；关注项共 **14** 条（P1 = 3、P2 = 8、P3 = 3）。

---

## 2. 逐项审计明细

### 2.1 Session Cookie（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 名称 / TTL | `v2_session`，14 天，Cookie `maxAge` 与 DB `expires_at` 一致 | `src/lib/auth.ts:10-11,24,82-88` |
| 会话 ID 熵 | `randomBytes(32).toString('hex')` = 256 位 | `src/lib/auth.ts:23` |
| HttpOnly | `httpOnly: true` | `src/lib/auth.ts:83` |
| SameSite | `sameSite: 'lax'`，Path `/` | `src/lib/auth.ts:84,86` |
| Secure | `secure: isHttpsRequest()` —— **条件成立**，但判定源与注释不符（A-06） | `src/lib/auth.ts:62-78,85` |
| 服务端过期 | `getSessionUser()` 查 DB `expiresAt`，过期即 `destroySession()` 并返回 null；非 `active` 状态一律拒绝（封禁/停用即时失效） | `src/lib/auth.ts:101-123` |
| 角色实时性 | 每次请求 `innerJoin(users)` 现读 role/status/balance，不缓存 | `src/lib/auth.ts:101-115` |
| 登出 / 改密 | `signout` 走 `guardCsrf`（`src/app/api/auth/signout/route.ts:9-10`）；`reset-password` 在事务内 `delete(schema.sessions)` 销毁该用户全部会话 | `src/app/api/auth/reset-password/route.ts:68-80` |
| 会话轮换 | 登录成功后仅 `createSession` + `setSessionCookie`，未销毁旧会话 / 未轮换 ID（A-06） | `src/app/api/auth/signin/route.ts:97-98`；`signup/route.ts:158-159` |
| 口令存储 | scrypt + 随机盐 + `timingSafeEqual`（静态守卫已锁） | `tests/v005-security-audit.spec.ts:305-311` |

### 2.2 CSRF 双提交（结论：关注）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 覆盖面 | **45 个写端点全部有防护，缺失 = 0**（等价脚本复现）；admin 写端点经 `adminGuardWrite` 内含 `guardCsrf`；`debug/*` 以 `checkDebugAccess` 令牌替代（静态守卫 EXEMPT 白名单仅 2 项） | `src/lib/admin-guard.ts:47-71`；`tests/v005-security-audit.spec.ts:108-182`；本报告 §0.1 L3 |
| 下发方式 | Middleware 对缺 Cookie 的访客下发 `v2_csrf`，`httpOnly:false` / `sameSite:lax` / 14 天 | `src/middleware.ts:16-17,112-119,155-163` |
| 校验实现 | 从请求头 `x-csrf-token` / `x-xsrf-token` 或表单 `csrfToken` 取值，与请求 Cookie 值做**长度检查 + `timingSafeEqual`** | `src/lib/csrf.ts:49-78` |
| JSON 请求 | `content-type: application/json` 且无头 ⇒ `formToken = null` ⇒ 拒绝（不会因 body 未读而放行） | `src/lib/csrf.ts:59-72` |
| Body 复用 | `WeakMap<Request, Promise<FormData>>` 缓存，避免 CSRF 读体后业务再读抛 `Body is unusable` | `src/lib/csrf.ts:90-100` |
| 客户端注入 | `csrfFetch` 自动注入 `x-csrf-token`；原生表单用 `readCsrfToken` 隐藏字段 | `src/components/CsrfProvider.tsx:15-38` |
| **绕过路径（A-02）** | **token 为纯随机值、未签名、未与会话绑定**；`middleware.ts:113` 仅校验「已有 Cookie 长度 ≥ 32」即认为自己签发的。攻击者若能写入同名 Cookie（同父域子域 / Cookie Tossing / HTTP 中间人），可用自造值通过校验。`src/lib/auth.ts:144-149` 的 `csrfTokenFor(sessionId)`（sha256 绑定会话）**全仓仅定义、零调用**（死代码） | `src/lib/csrf.ts:22-24`；`src/middleware.ts:112-113`；`src/lib/auth.ts:144-149` |

> **可利用性界定**：需额外前提（能写目标站 Cookie），且 `SameSite=Lax` 已挡住常规跨站 POST。属 **P1 关注**，不构成开箱即用的 P0。

### 2.3 Host Header / X-Forwarded-Host（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| fail-closed 真生效 | `resolvePublicBaseUrl()` **只**读 `PUBLIC_BASE_URL` → `APP_URL` 两个运维配置；两者皆无/皆非法 ⇒ 返回 `null`，**不回退任何请求头** | `src/lib/public-base-url.ts:54-67` |
| 配置值校验 | 只允许 `http:`/`https:`、必须有 hostname、拒绝控制字符/空字节；归一化取 `origin + pathname`，剥离 userinfo | `src/lib/public-base-url.ts:29-44` |
| 密码重置链接 | `baseUrl = resolvePublicBaseUrl()`；为 null 时**拒绝发送邮件**并留可观测日志（邮箱已脱敏），响应仍保持统一以防邮箱枚举 | `src/app/api/auth/forgot-password/route.ts:86-104,135-139` |
| 重置链接构造 | `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`，令牌在 **query** 而非 Host 派生段 | `forgot-password/route.ts:104` |
| 邮件正文 | `buildPasswordResetEmail` 对用户名/URL 做 `escapeHtml` | `src/lib/mailer.ts:599-635` |
| 邮件发件人 | `SMTP_FROM` / `SMTP_HOST` 均来自运维 env，不从请求推导 | `src/lib/mailer.ts:98-120,361-390` |
| 303 Location | 站内相对引用，不经过 Host / x-forwarded-host（见 §2.4） | `src/lib/redirect.ts:17-20,49-58` |
| 全仓请求头枚举 | `x-forwarded-host` 在 `src/` **零命中**；`x-forwarded-proto` 仅 2 处：`middleware.ts:150`（仅用于 CSRF Cookie 的 Secure 标志）、`auth.ts:53`（注释）；`x-forwarded-for` 仅在显式 `TRUST_PROXY_HEADERS=1` 时采信 | `src/lib/client-ip.ts:67-69,99-115`；`src/middleware.ts:91-102` |
| **残留面（A-10）** | Feed 的 `resolveBaseUrl()` / `siteOrigin()` 在三个 env 都未配时**回退 `new URL(request.url).origin`** ⇒ 客户端可控 Host 可影响 Feed/JSON Feed/Atom 中的绝对链接（钓鱼 / 缓存投毒面，不含任何令牌） | `src/lib/feed-builder.ts:155-175,389-396`；`src/app/api/feed/route.ts:19`；`feed/json/route.ts:19`；`feed/atom/route.ts:19`；`nodes/[name]/feed/route.ts:40` |

### 2.4 303 / 相对重定向（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 构造 | `seeOther()` 返回 `status: 303` + **相对** `Location`，并强制 `Cache-Control: no-store` | `src/lib/redirect.ts:49-58` |
| 净化 | `sanitizeRedirect()`：非字符串→`/`；必须以 `/` 开头；拒绝 `//evil.com`、`/\evil.com`；拒绝 `\r \n \t` 注入 | `src/lib/redirect.ts:24-33` |
| 纵深防御 | `seeOther()` 内部**再次**调用 `sanitizeRedirect`，调用方漏净化也安全 | `src/lib/redirect.ts:38-39,53` |
| 调用点 | 回复创建：`redirect` 来自 JSON body 或表单，均先过 `sanitizeRedirect` 再 `seeOther`；登录 `next` 也先净化后仅作为 JSON 字段返回（不产生 Location 头） | `src/app/api/replies/route.ts:38,44,256`；`src/app/api/auth/signin/route.ts:104-105` |
| 反向断言 | 既有 `security-host-audit.yml` 工作流在真实应用上跑 Host / XFH / XFP / 多值转发头 / 畸形 Host / 开放重定向参数 / 重置链接投毒矩阵，且 `set -o pipefail` 防止假绿 | `.github/workflows/security-host-audit.yml:1-16,138-163` |

### 2.5 限流与 PgKV 降级（结论：关注）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 统一入口 | 所有限流经 `rateLimit()`，键 `ratelimit:${scope}:${identifier}`，异常限流埋点集中于此（新增路由自动被统计） | `src/lib/rate-limit.ts:29-49,36,43-47` |
| 键维度 | 登录 `${ip}\|${username.toLowerCase()}`；注册 `signup_account` + `signup_ip` 双维度；找回密码 IP + 邮箱双维度；头像按用户；社区动作按用户 | `signin/route.ts:55-60`；`signup/route.ts:95-127`；`forgot-password/route.ts:46-71`；`users/avatar/route.ts:41-46` |
| 降级行为 | `REDIS_URL` 缺失 ⇒ `PgKV`；存在但 `connect()`/`ping()` 失败 ⇒ `disconnect()` 后降级 `PgKV`（fail-safe，不放行） | `src/lib/kv.ts:155-188` |
| PgKV 正确性 | 全部 `sql` 标签参数化；`incrWindow` 用 `INSERT ... ON CONFLICT` + `window_start` 比较实现跨窗口重置 | `src/lib/kv.ts:78-150`（尤其 `116-131`） |
| 清理双后端 | `clearAll()` 同时清 Redis `FLUSHDB` 或 PG 两张表；debug 端点再兜底删两张表 | `src/lib/kv.ts:71-75,145-149`；`debug/reset-rate-limits/route.ts:32-39` |
| IP 信任边界 | 默认 `TRUST_PROXY_HEADERS=0` 完全忽略可伪造代理头，只用 middleware 注入且**先删后写**的内部头；默认退化为全局单桶 `127.0.0.1` | `src/lib/client-ip.ts:67-115`；`src/middleware.ts:104-110` |
| **缺口 A-07** | 登录**没有纯 IP 维度**限流（注册有 `signup_ip`），默认全局单桶又使 IP 无法区分来源 ⇒ 对**大量不同用户名**各试 10 次/60s 的密码喷洒无全局闸门 | `signin/route.ts:52-60`；`client-ip.ts:45-48` 自述取舍 |
| **缺口 A-08** | ① `kvInitPromise` 一旦 reject，后续 `getKV()` 永远返回同一个 rejected promise（无重置）；② Redis `incrWindow` 的 `incr` 与 `expire` 是两条命令，中间崩溃会留下无 TTL 的键 ⇒ 该 IP 被永久限流 | `src/lib/kv.ts:54-61,179-188` |
| 失败模式 | `getKV()`/DB 异常时 `rateLimit` 未 catch ⇒ 请求 500（**fail-closed，不是放行**），是可用性风险而非绕过 | `src/lib/rate-limit.ts:35-38` |

### 2.6 文件上传（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 类型 | 按 magic number 判定 PNG/JPEG/WebP/GIF，**不信任客户端 MIME**；sharp 解码失败一律拒绝 | `src/lib/avatar.ts:67-112,265-268`；`users/avatar/route.ts:80-100` |
| 大小 | 默认 2 MB 上限，落盘前按 `blob.size` 硬校验；超限 413 | `src/lib/avatar.ts:32`；`users/avatar/route.ts:67-78` |
| 图片炸弹 | `sharp(..., { limitInputPixels: 100_000_000 })` | `src/lib/avatar.ts:206` |
| 路径穿越 | 存储路径**完全服务端生成**：`avatars/<userId>/<16字节随机hex>.<固定扩展名>`；`resolveStoragePath` 用白名单正则 `^avatars/\d+/[a-f0-9]{8,64}\.(png\|jpg\|webp\|gif)$` + `startsWith(root + sep)` 越界检查 | `src/lib/avatar.ts:125-141,316-333` |
| 覆盖防护 | `writeFile(..., { flag: 'wx' })` 独占创建 | `src/lib/avatar.ts:330` |
| 用户文件名 | 仅截断后作 DB 元数据展示，**不参与任何路径拼接** | `users/avatar/route.ts:109` |
| 存储位置 | `public/uploads/avatars/`，由 `src/app/uploads/[...path]/route.ts` 流式读取（非 Next 静态快照）；固定 3 段路径 + `resolveStoragePath` 校验 | `src/app/uploads/[...path]/route.ts:43-54,83-97` |
| 响应加固 | `nosniff` + 白名单 MIME + `Cache-Control: immutable`；重新编码**剥离 EXIF/GPS** | `uploads/[...path]/route.ts:67-96`；`avatar.ts:226-253` |
| 鉴权 / CSRF / 限流 | POST 与 DELETE 均 `getSessionUser()` + `guardCsrf` + 用户维度限流 | `users/avatar/route.ts:32-52,160-170` |
| 镜像目录 | `Dockerfile:43` 预建 `/app/public/uploads` 并 `chown nextjs:nodejs`；容器以非 root `USER nextjs` 运行 | `Dockerfile:31,43,161` |

### 2.7 管理员权限 / 越权（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 服务端二次校验 | 全部 `/api/admin/*` 经 `adminGuard`（读）/`adminGuardWrite`（写，内含 `guardCsrf`）；未登录 401、角色不足 403，且**先判权限再判 CSRF**（不泄露端点存在性） | `src/lib/admin-guard.ts:27-71`；16 个 admin 路由逐一命中 |
| 权限矩阵单一事实来源 | `MATRIX` 显式列出 11 项权限与角色；`credits.adjust` / `users.role` / `users.ban_admin` 仅 admin | `src/lib/permissions.ts:26-51` |
| 防自锁 | `canBanUser` 禁止封禁自己 / moderator 封 admin；`canChangeRole` 禁止管理员降级自己 | `permissions.ts:116-147` |
| 内容所有权 | `canModifyOwnContent` / `withinEditWindow` 在 service 层判定；主题/回复编辑删除端点先 `getSessionUser()` + `guardCsrf` + `guardCommunityAction` | `permissions.ts:92-99,168-187`；`topics/[id]/route.ts:137-146,201-210`；`replies/[id]/route.ts:24-33` |
| role 写入点 | 静态守卫断言 `users.role` 只在 admin 路由写入；注册路由 `role: 'user'` 服务端写死 | `tests/v005-security-audit.spec.ts:185-203`；`signup/route.ts:139-148` |
| 回归护栏 | `tests/v005-security-audit.spec.ts:166-182,205-218` 断言 admin 写端点必带 `guardCommunityAction`、全部 admin 端点必带 `adminGuard` | 同上 |
| 运维总览 | `/api/admin/ops` 经 `adminGuard('config.view')`，只回计数/布尔；E2E 反向断言不含连接串与 `*_PASSWORD` / `SESSION_SECRET` | `admin/ops/route.ts:78-135`；`e2e/v009-four-roles-acceptance.spec.ts:404-412,416-421` |

### 2.8 SQL 注入（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 未参数化拼接 | `src/` 全仓 `sql.raw(` **零命中**（`grep -rn` 实测） | 本报告 §0.1 L3 |
| 等价守卫复现 | 按 `tests/v005-security-audit.spec.ts:235-262` 的正则在 63 个文件上复现：**offenders = 0** | 同上 |
| 动态条件片段 | `conditions.reduce((acc, c) => sql\`${acc} AND ${c}\`)` 组合的是 `sql` 对象片段而非字符串；`deletedFilter = canSeeDeleted ? sql\`\` : sql\`AND deleted_at IS NULL\`` | `src/lib/node-service.ts:56-67,97-99`；`src/lib/content-service.ts:642-653` |
| 值插值 | 所有 `${...}` 均为参数值（`topicId` / `limit` / `offset` / `windowStart.toISOString()` / `key` 等），由 drizzle/postgres.js 转成 `$n` 占位符 | `src/lib/kv.ts:80-131`；`src/server/floor.ts:48-67`；`src/lib/credit-service.ts:136,218` |
| 调试端点表名 | `table-count` 用 drizzle 查询构造器 + **编译期固定白名单** `ALLOWED_TABLES`，且刻意排除 `sessions` / `password_reset_tokens` / `login_attempts` | `src/app/api/debug/table-count/route.ts:29-62,66-84` |
| **护栏局限（A-12）** | 守卫是**朴素字符串匹配**：`src.includes('sql.raw(')` 命中注释也会判红；反之 `String.raw` 拼 SQL、模板字符串拼标识符、ORM 之外的原生 `postgres()` 调用等**均不在检测范围**。会话 Cookie 用例 `expect(auth).toMatch(/forwarded-proto\|x-forwarded-proto/)` 可由 `auth.ts:53` 的**注释**满足，无法证明实现真读了请求头（见 A-06） | `tests/v005-security-audit.spec.ts:221-263,288-303` |

### 2.9 敏感日志脱敏（结论：关注）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 已有机制 | `redact()` 递归按键名脱敏 16 类敏感键（password/token/cookie/authorization/db_url…），深度上限 5 层，长字符串截断 500；`maskEmailLocal()` 只留首字母 + 域名 | `src/lib/observability.ts:34-90` |
| 调用覆盖 | 结构化 `emit()` 对 `fields` 走 `redact()`；邮件路径日志收件人均 `maskEmail()`；`email_logs` 只存脱敏地址 | `observability.ts:250-265`；`src/lib/mailer.ts:82-95,407-453`；`forgot-password/route.ts:95-99,124-126` |
| instrumentation | **不读任何请求头/Cookie/Token**，只取 `res.req.url` 的 path 且 `split('?')[0]` 去掉 query | `src/instrumentation.ts:33-39,72-80`（详见 §3） |
| **缺口 A-09** | ① `emit()` 的 `message` 参数**不过 `redact()`**，`withTiming()` 把 `err.message` 原样写入 message；② `public-base-url.ts:61-64` 的 `console.error` 打印**环境变量原始值**（若 URL 含 userinfo 凭据会泄露）；③ 全仓约 20 处 `console.error(..., err)` 直接打印异常对象（DB 错误消息可能含失败语句/参数）；④ `app-now.ts:38` 打印 `APP_NOW` 原值。均无统一脱敏中间件 | `observability.ts:250-265,304-312`；`public-base-url.ts:61-64`；`src/lib/audit.ts:90,116`；`src/app/api/replies/route.ts:216` 等 |

> 未发现「直接 `console.log(request.headers)` / 打印 Cookie 头 / 打印明文口令」的路径；风险是**兜底不完备**而非已发生的泄露。

### 2.10 测试端点生产隔离（结论：关注）

#### 2.10.1 全部 debug 路由与启用条件（任务点名要求）

| 路由 | 方法 | 作用 | 启用条件 | 默认生产行为 |
|---|---|---|---|---|
| `/api/debug/table-count` | GET | 返回白名单表行数 | ① `ENABLE_DEBUG_ENDPOINTS=1` ② 非空 `DEBUG_ENDPOINT_TOKEN` ③ 请求带 `X-Debug-Token` 或 `Authorization: Bearer` 且 `timingSafeEqual` 通过 | **404** |
| `/api/debug/floors` | GET | 返回指定主题楼层号 | 同上 | **404** |
| `/api/debug/reset-rate-limits` | POST | 清空全站限流计数（Redis `FLUSHDB` 或 PG 两表） | 同上 | **404** |
| `/api/debug/rate-limit-probe` | POST | 1 秒窗口计数器语义探针（内含 `sleep(1100)`） | 同上 | **404** |

- 统一鉴权在 `src/lib/debug-auth.ts:17-46`：开关未开 ⇒ 404；开关已开但令牌未配 ⇒ 404（**防「开了开关就裸奔」**）；令牌不匹配 ⇒ 401；比较为恒定时间。
- **无 seed HTTP 端点**：`npm run db:seed` / `scripts/seed.ts` 是 CLI 脚本，`src/app/api/` 下无 `/api/seed`；`scripts/reset-test-credentials.ts` 也是 CLI，带 `isIsolatedTestEnv()` 安全门（头部注释与实现一致）。
- 另有 `/api/health`（liveness，仅回 `status` + 版本号）与 `/api/health/ready`（readiness），属公开运维探针，不返回连接串/内部状态：`src/app/api/health/route.ts:17-21`。

#### 2.10.2 「不可利用」成立，「不可启用」不成立

| 判定 | 结论 | 证据 |
|---|---|---|
| 默认生产**不可利用** | **通过**。两份 compose 均**硬编码** `ENABLE_DEBUG_ENDPOINTS: '0'`、`DEBUG_ENDPOINT_TOKEN: ''`、`DISABLE_CAPTCHA: '0'`、`TEST_ENV_ISOLATED: '0'`，`APP_RUNTIME_ENV` 默认 `production`；`checkDebugAccess` 三重校验构成第二道保险。即使误开开关，令牌为空仍 404 | `docker-compose.yml:78-103`；`deploy/docker-compose.yml:92-116`；`debug-auth.ts:17-38` |
| 生产**不可启用**（代码层） | **不成立（A-01）**。`isDebugEndpointEnabled()` **只**检查 `ENABLE_DEBUG_ENDPOINTS === '1'`，**完全不检查** `APP_RUNTIME_ENV` / `TEST_ENV_ISOLATED`；源码注释明确写「调试端点在任何环境都允许开启」。与同文件 `isCaptchaDisabled()` / `isRealSmtpAllowedInTest()`（两者都调用 `isIsolatedTestEnv()`）形成不一致 | `src/lib/runtime-flags.ts:27-31,39-49,80-83` |
| 令牌字面量 | CI 工作流把固定调试令牌（如 `ci-debug-token-not-for-production`）与 CI 口令/SESSION_SECRET 明文写进被跟踪文件；这些是**测试占位值**，但若生产误开开关且运维复用该公开值，可被直接利用 | `.github/workflows/security-host-audit.yml:34-44`；`e2e/global-setup.ts:64`；`e2e/helpers.ts:19,42` |
| 部署清单 | `deploy/INSTALL.md:289` 的检查表要求确认 `ENABLE_DEBUG_ENDPOINTS=0`；`.env.example:64-65` 默认 `0` 且 `DEBUG_ENDPOINT_TOKEN=` 空 | `deploy/INSTALL.md:289`；`.env.example:63-69` |

> **定性**：安全性目前依赖「**部署配置默认关闭 + 令牌**」，而非「**代码层机制禁止在生产启用**」。需要两个前提同时失误（运维显式开启 + 令牌可得/复用）才可被利用，故为 **P1 关注**，不是 P0。

### 2.11 instrumentation.ts 专项（结论：关注）—— 详见 §3

### 2.12 npm 依赖漏洞与 Docker 镜像漏洞（结论：关注）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 依赖清单 | 生产依赖 14 个、dev 依赖 10 个，版本固定/带 `^` 上界；`next 15.5.28`、`react 19.3.1`、`sharp 0.35.5`、`dotenv 18.0.9`；`engines.node >= 22.23.4` | `package.json:38-74` |
| 已知缓解 | `overrides` 固定 `postcss ^8.5.32` 与 `esbuild ^0.25.0`；Dockerfile 注释记录曾移除 5 个零引用依赖并消除 `GHSA-67mh-4wv8-2f99` 受影响版本随镜像分发 | `package.json:69-74`；`Dockerfile:80-99` |
| 生产镜像裁剪 | `npm ci --omit=dev --no-audit --no-fund` + 显式删除 `playwright-core` + 4 条 `test -f/-d` 防回归断言；非 root 用户；基础镜像 `node:22.23.4-alpine`（固定版本，非 `latest`） | `Dockerfile:8,31,149-161` |
| 依赖门禁 | `release.yml` 的 `security-scan` job 显式 `npm audit --json`，node 脚本对 **critical / high 一律 `process.exit(1)` 阻断**，moderate 记录为 warning 并上传 artifact；JSON 解析失败会自然使 job 失败（fail-closed） | `.github/workflows/release.yml:481,508-556` |
| 秘密扫描门禁 | gitleaks `--no-git --redact --exit-code=1`，扫 `git ls-files` 的**当前跟踪树**（刻意不扫 Git 历史），且刻意不传 `--config` 以免默认规则集失效 | `release.yml:610-675` |
| 发布包内容检查 | 检查 `deploy/.env` 不存在等 | `release.yml:672+` |
| 镜像内容检查 | `docker-verify.yml` 检查镜像内无 `.env*` / `*CREDENTIAL*` 等文件 | `.github/workflows/docker-verify.yml:215-228` |
| **缺口 A-11** | 全仓 12 个工作流**没有任何镜像 CVE 扫描**（`trivy` / `grype` / `docker scout` / `snyk` / `hadolint` / CodeQL 均零命中）；所有 `npm ci` 都带 `--no-audit`，扫描只在 release 门禁单点发生。Docker 基础镜像 `node:22.23.4-alpine` 的 OS 层 CVE **从未被扫过** | `grep -n -iE "trivy\|snyk\|hadolint\|codeql\|grype\|docker scout" .github/workflows/*.yml` → 零命中 |
| **诚实声明** | 受 L1/L2 限制，**本报告未运行 `npm audit`、gitleaks、任何镜像扫描**，也**未验证** `release.yml` 注释中「2026-11-03 实测 critical=0 / high=0 / moderate=4」这一历史数字是否仍成立。PR #32 的 Release Notes 新增「安全审计 ✅ 通过 / 已核实」表述，其真实性**依赖 CI 真实运行结果**，本报告不予背书 | 本报告 §0.1；`release.yml:141,181`（新增行） |

### 2.13 Secret scanning / R-01（结论：通过）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 被跟踪的 env 文件 | **仅 3 个模板**：`.env.example`、`deploy/.env.example`、`tests/env/.env.test.example`；实测 `git ls-files \| grep -E '(^\|/)\.env'` | 本报告实测 |
| 模板内容 | 全部为空值或显式占位符（`CHANGE_ME` / `__TEST_DB_PASSWORD__` / `__TEST_SESSION_SECRET__` 等），**无真实口令** | 3 个模板逐行核对 |
| 本机真实 .env | 7 个本机 `.env.*` 全部被 `.gitignore:22-69` 忽略，`git status --porcelain --untracked-files=all` 为空 ⇒ 不入库、不进发布产物 | `.gitignore:22-69`；本报告实测 |
| 构建上下文 | `.dockerignore:8-11` 排除 `.env` / `.env.*`（仅放行 `.env.example`）；同时排除 `.git`、`node_modules`、备份、`*.dump`、`docs/evidence/*` | `.dockerignore:1-70` |
| 镜像 COPY 清单 | runner 层只 COPY `public/`、`.next`、`package.json`、`drizzle/`、`scripts/`、`drizzle.config.ts`、`tsconfig.json`、`src/db/`、`src/lib/password.ts`、`src/lib/env-loader.mjs` —— **不含 `docs/`，不含任何 `.env`** | `Dockerfile:44-75` |
| 高强度密钥模式 | `git grep` 扫描 `ghp_*` / `sk-*` / `AKIA*` / `-----BEGIN PRIVATE KEY-----` → **零命中** | 本报告实测 |
| 私人数据 | 被跟踪文件中未见真实邮箱清单 / 数据库导出 / 客户数据；`email_logs` 只存脱敏地址 | `src/lib/mailer.ts:407,495-501` |
| **R-01 范围确认** | 当前 `master` 树中 `ref-*.png` / `diff-*.png` / `combo.css` / `combo.js` / `docs/evidence/html/` **零命中**；`docs/evidence/` 现存 105 个文件（81 png / 13 json / 7 md / 4 txt），均为本站自产产物，与 `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md:20-21` 一致。Git **历史**中 81 个第三方素材仍经 4 个已发布 Tag + 12 个分支可达，该项维持 **DEFERRED**，属已知待裁决事项（A-14）；本报告**不扩大范围、不改写历史、不重做该结论** | `git ls-tree -r --name-only master` 实测；`docs/R01_COMPLIANCE_REVIEW_v0.0.9.md:17-27,298-323` |

### 2.14 P0 结论

见 §5。

---

## 3. `src/instrumentation.ts` 专项审计（任务第 11 项逐条回答）

> 文件：`src/instrumentation.ts:44-120`（`register()`），配套 `src/lib/observability.ts:124-247`；启用方式见 `next.config.mjs:7-20`（Next 15 默认开启 instrumentation，不显式配置 hook）。

| # | 任务提出的检查点 | 结论 | 证据与推理 |
|---|---|---|---|
| 1 | 是否改变正常 HTTP 响应 | **不改变** ✅ | `patchedWriteHead` 原样透传 `args`，不修改 `statusCode` / headers / body，返回 `originalWriteHead.apply(res, args)` 的结果；`catch` 仅 `throw err` 重新抛出。唯一副作用是注册一个事件监听器（`src/instrumentation.ts:68-76,111-119`） |
| 2 | 是否重复包装（Symbol.for 幂等） | **幂等生效** ✅ | `Symbol.for('v2ex.instrumentation.writeHead')` 挂在 `http.ServerResponse.prototype`，先查后写（`:59-64`）；`http` 是 Node 内置单例模块，同进程不同 webpack bundle 拿到同一 prototype；`NEXT_RUNTIME !== 'nodejs'` 时提前 return（`:46`）。**但幂等只防「多次 register」，不防「单次响应多次 writeHead」**（见第 7 行） |
| 3 | 是否泄露请求头 / Cookie / Token | **当前不泄露** ✅（带条件） | 只读 `res.req?.url` 且 `split('?')[0]` 去 query（`:72-80`）；密码重置 token 在 query（`/reset-password?token=`），不进 `/api/` 路径。**但**：`api.error.4xx.${route}` / `api.error.5xx.${route}` / `recordSlowRequest(route)` 会把**归一化后的路径**写入 counters，并经 `/api/admin/ops` 暴露给 admin/moderator；`normalizeApiPath` 只归一化**纯数字段与 UUID/hex 段**（`observability.ts:206-221`），非 hex 动态段（节点名、base64url token 等）会原样保留。当前路由表下无令牌走 path，故**当前无泄露**，但缺结构性保证 |
| 4 | 是否破坏流式响应（SSE / stream） | **不破坏，但计时口径失真** ⚠️ | 全仓 `text/event-stream` / SSE **零命中**；唯一 `ReadableStream` 是 `/uploads/[...path]`（`src/app/uploads/[...path]/route.ts:83-87`），**不在 `/api/` 前缀下**，被 `:74-76` 直接跳过。RSC 页面流同样被 `/api/` 过滤。监听器只挂在 `'finish'`，不触碰 stream（`:106-111`）。**但** `startedAt` 在 `writeHead` 时刻取值（`:82`），对长耗时流响应 `durationMs` = 整个流时长 ⇒ 必然被判为慢请求（`:98-100`），属**误报**而非破坏 |
| 5 | 能否准确区分 200/401/403/404/5xx | **逻辑上能，未经真实 HTTP 验证** ⚠️ | `finish` 时读 `res.statusCode`（`:86`），`writeHead(status)` 已把它设为最终状态；按 `>=500` → `api.error.5xx`、`>=400` → `api.error.4xx` 分桶（`:91-97`），`api.status.${status}` 逐码计数（`:90`）。**但**：`tests/v009-observability-isolation.spec.ts:24-25` 声称「真实状态码由 `e2e/v009-ops-metrics.spec.ts` 覆盖」，实测**该文件不存在**（`grep -rn "v009-ops-metrics"` 全仓仅命中这一行注释）；`e2e/v009-four-roles-acceptance.spec.ts:404-412` 只断言 `/api/admin/ops` 不含连接串/密钥，**未断言 byStatus 准确性**。⇒ 这是**悬空引用 + 测试覆盖缺口（A-04）** |
| 6 | 指标写入失败是否影响业务 | **不影响** ✅ | `finish` 内全部埋点包在 `try { ... } catch {}`（`:88-103`）；`originalWriteHead` 的 `try/catch` 只 rethrow 原异常（`:113-118`）。`countMetric` 本身也有键数上限保护（`observability.ts:175-184`） |
| 7 | **writeHead 被多次调用时是否重复计数** | **会重复计数（A-03）** ❌ | `:111` 的 `res.once('finish', finish)` 位于 `patchedWriteHead` **函数体内**，每次调用 `writeHead` 都会注册**一个新的** `once` 监听器。`once` 只保证「单个监听器触发一次」，**不保证只注册一个监听器**；同一响应调用 N 次 `writeHead` ⇒ `finish` 时 N 个回调全部执行 ⇒ `api.request` / `api.status.*` 被计 N 次，且各自 `startedAt` 不同会重复登记慢请求。注释 `:108`「用 `once` ⇒ 只结算一次（不重复计数）」是**对 `once` 语义的误解**。此外 >10 次会触发 Node `MaxListenersExceededWarning` |
| 8 | `res.once('finish')` 未触发时的残留 | **存在残留（A-05）** ⚠️ | 客户端提前断开触发 `'close'` 而非 `'finish'` ⇒ ① 该请求**完全不计入统计**（错误率被低估）；② 监听器闭包（含 `route`、`startedAt`）挂在 `res` 上直到对象被 GC。Node 在 socket 销毁后会释放 `ServerResponse`，**不是永久泄漏**，但大量挂起/长连接（Slowloris 型）期间每个连接持有一个闭包 ⇒ 内存随并发线性增长。代码**未监听 `'close'` 做清理，也未做 `removeListener`** |
| 9 | 键基数 / 内存泄漏 | **有界** ✅ | `normalizeApiPath` 归一化数字/UUID 段（`:80`）；`MAX_COUNTER_KEYS = 2000`，到达后不新增键但已有键继续累加（`observability.ts:138-156,175-184`）；`MAX_SLOW = 200` 且 `splice` 裁剪（`:135-136,224-228`）；`countMetric` 的调用点键均为低基数常量/状态码/归一化路由。**单测已锁**：`tests/v009-metrics-cardinality.spec.ts:31-103`、`tests/v009-observability-isolation.spec.ts:99-113` |
| 10 | 监听器累积 / 计数器是否有界 | **计数器有界，监听器无上限** ⚠️ | 见第 7、9 行。`globalThis` 桥接（`observability.ts:95-166`）已被 `tests/v009-observability-isolation.spec.ts:39-61` 覆盖；但**没有任何测试直接 import `src/instrumentation.ts` 或打补丁 `writeHead`**（`grep -rln "instrumentation" tests/ e2e/` 仅命中两个仅测存储层的 spec 文件） |

**专项小结**：该模块在「不改变响应、幂等包装、不泄露请求头、指标失败不影响业务、计数器有界」五项上设计正确；在「writeHead 多次调用重复计数」「finish 未触发残留」「慢请求计时口径」「真实 HTTP 层验证缺失（且引用了不存在的 E2E 文件）」四项上存在**可观测性正确性缺陷**。这些缺陷影响的是**统计准确性与长连接内存**，**不改变任何业务响应、不泄露凭据、不提供越权入口**，因此不构成 P0。

---

## 4. 关注项清单（A-01 ~ A-14，共 14 项）

| 编号 | 级别 | 关注项 | 证据 | 最小修复建议（**均不由本审计执行**） |
|---|---|---|---|---|
| **A-01** | **P1** | 调试端点开关 `isDebugEndpointEnabled()` 不检查 `APP_RUNTIME_ENV` / `TEST_ENV_ISOLATED`，代码层允许生产启用；CI 中被跟踪文件含固定调试令牌字面量 | `src/lib/runtime-flags.ts:45-49`；`security-host-audit.yml:34-44`；`docker-compose.yml:99-103` | 在 `isDebugEndpointEnabled()` 增加 `if (getRuntimeEnv() === 'production') return false;` 或复用 `isIsolatedTestEnv()`；发布前核对生产 `ENABLE_DEBUG_ENDPOINTS=0` 且 `DEBUG_ENDPOINT_TOKEN` 为空 |
| **A-02** | **P1** | CSRF 双提交 token 纯随机、未签名、未绑定会话；`csrfTokenFor()` 是死代码；middleware 仅按长度判定 Cookie 合法性 ⇒ Cookie 注入可绕过 | `src/lib/csrf.ts:22-24,49-78`；`src/middleware.ts:112-113`；`src/lib/auth.ts:144-149` | 改为签名双提交：`token = HMAC(sessionId, SESSION_SECRET)`，校验时同时比对 Cookie 与请求 token 且验证签名（可直接启用现成的 `csrfTokenFor`） |
| **A-03** | **P1** | `instrumentation.ts` 每次 `writeHead` 都注册 `once('finish')` ⇒ 多次调用重复计数 + 监听器累积 + `MaxListenersExceededWarning` | `src/instrumentation.ts:82-111`（尤其 `:111`） | 用 `Symbol.for` 在 `res` 上标记「已挂载」，或在 `finish`/`close` 中 `removeListener`；补充「同一响应多次 writeHead 只计一次」的用例 |
| A-04 | P2 | 无真实 HTTP 层状态码验证；`tests/v009-observability-isolation.spec.ts:25` 引用的 `e2e/v009-ops-metrics.spec.ts` **不存在**（悬空引用） | 前述 + `e2e/` 全目录实测 | 补该 E2E（断言 200/401/403/404/5xx 分别落到 `byStatus`），或删除注释中的不实引用并在门禁中标注「未验证」 |
| A-05 | P2 | instrumentation 慢请求计时从 `writeHead` 起算（长流响应误报）；`'close'` 无 `'finish'` 时请求丢失统计且监听器闭包残留 | `src/instrumentation.ts:82,84-111` | 增加 `res.once('close', ...)` 清理与「异常终止」计数；慢请求计时改从请求开始（或对流响应显式豁免） |
| A-06 | P2 | Session Cookie `secure` 判定读 `process.env.FORWARDED_PROTO`，与注释/文档所述 `x-forwarded-proto` 请求头不符；生产若未显式配置 env 则 `Secure=false`。另登录/注册成功后未轮换会话 ID | `src/lib/auth.ts:44-78,85`；`signin/route.ts:97-98`；`signup/route.ts:158-159` | 统一 Secure 判定口径（显式依赖 `PUBLIC_BASE_URL`/`APP_URL` 的 scheme，文档同步）；登录成功后销毁旧会话并重新签发 |
| A-07 | P2 | 登录限流只有 `ip\|username` 组合键，缺纯 IP 维度；默认 IP 退化为全局单桶 ⇒ 密码喷洒防护不足 | `signin/route.ts:52-60`；`client-ip.ts:45-48` | 增加 `login_ip` 维度（可复用注册的双维度模式），生产部署显式配置 `TRUST_PROXY_HEADERS=1` 并把端口绑到 `127.0.0.1` |
| A-08 | P2 | `kvInitPromise` 单次 reject 后永久故障；Redis `incr` + `expire` 非原子，崩溃可留无 TTL 键导致永久限流 | `src/lib/kv.ts:54-61,179-188` | reject 时 `kvInitPromise = null` 允许重试；改用 Lua 脚本或 `SET ... EX` 原子写法 |
| A-09 | P2 | 日志脱敏兜底不完备：`emit()` 的 `message` 不过 `redact`、`withTiming` 原样写 `err.message`、`public-base-url.ts` 打印 env 原值、多处 `console.error(err)` | `observability.ts:250-265,304-312`；`public-base-url.ts:61-64`；`audit.ts:90` | `message` 也走 `redact()`（并对常见凭据模式做值级匹配）；env 日志只打印变量名不打印值；统一 `logError` 入口 |
| A-10 | P2 | Feed 的 `resolveBaseUrl()` / `siteOrigin()` 在 env 未配时回退到 `new URL(request.url).origin`（Host 可控）⇒ 绝对链接投毒/缓存投毒面 | `src/lib/feed-builder.ts:155-175,389-396` 及 4 个 feed 路由 | 与 `public-base-url.ts` 统一为 fail-closed，或至少要求 `PUBLIC_BASE_URL` 必配；feed 产物加 `Cache-Control` 校验 |
| A-11 | P2 | 无 Docker 镜像 CVE 扫描（trivy/grype/scout/hadolint/CodeQL 全零命中）；所有 `npm ci` 带 `--no-audit`，依赖扫描只在 release 单点；本地无法实扫 | `.github/workflows/*.yml` 全量 grep；`Dockerfile:150` | 在发布门禁加 Trivy（或等价）扫 `node:22.23.4-alpine` 与最终镜像；发布前在联网 CI 真实跑一次 `npm audit` 并留存 artifact |
| A-12 | P3 | 静态安全守卫为朴素字符串匹配（注释含 `sql.raw(` 即判红；无法发现其它拼接形式），会话 Cookie 断言可由注释满足 | `tests/v005-security-audit.spec.ts:221-263,288-303` | 升级为 AST 级检查或补充动态注入回归用例；把 `expect(auth).toMatch(/x-forwarded-proto/)` 换成对 `isHttpsRequest()` 行为的单元断言 |
| A-13 | P3 | `next.config.mjs` 只设 `nosniff` / `X-Frame-Options` / `Referrer-Policy`，无 CSP、HSTS、Permissions-Policy | `next.config.mjs:44-55` | 在反代或 `headers()` 补 HSTS 与最小 CSP；注意与现有内联脚本/Markdown 渲染兼容性 |
| A-14 | P3 | R-01 历史素材仍经 4 个已发布 Tag + 12 分支可达，维持 **DEFERRED**；当前树/新产物干净但不得宣称「已合规」 | `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md:20-27,298-323`；本报告 §13 | 按既有报告建议 E（保留历史 + Release Notes 显著披露）由主人裁决；**本报告不建议改写历史** |

**分级统计**：P1 = 3（A-01 / A-02 / A-03）、P2 = 8（A-04 ~ A-11）、P3 = 3（A-12 ~ A-14）。

---

## 5. P0 阻断结论

### **NO —— 未发现会阻断 v0.0.9 正式公开发布的 P0 真实可利用漏洞。**

**判定理由（逐条对应「真实可利用」的成立条件）**：

| # | 理由 | 支撑证据 |
|---|---|---|
| 1 | **默认生产部署下，最高危的调试端点不可利用**：两份 compose 硬编码 `ENABLE_DEBUG_ENDPOINTS=0` + `DEBUG_ENDPOINT_TOKEN=''`，`checkDebugAccess` 在未开开关/未配令牌时均返回 404；`table-count` 还有表名白名单且排除会话/令牌表；无 seed HTTP 端点 | §2.10；`docker-compose.yml:99-103`；`deploy/docker-compose.yml:113-116` |
| 2 | **账号接管主路径已 fail-closed**：密码重置链接只信运维配置的 `PUBLIC_BASE_URL`/`APP_URL`，未配置即拒发；令牌 32 字节随机、只存 sha256、一次性、改密后销毁全部会话；Host / XFH 全仓零命中 | §2.3；`public-base-url.ts:54-67`；`reset-token.ts:16-60` |
| 3 | **写操作防护无缺口**：45 个写端点 CSRF 覆盖缺失 = 0；admin 端点全部经服务端 `adminGuard` + 权限矩阵；内容编辑有 service 层所有权判定；无 `sql.raw`、SQL 插值 offenders = 0 | §2.2 / §2.7 / §2.8；`tests/v005-security-audit.spec.ts` 等价复现 |
| 4 | **开放重定向与上传路径均已收敛**：303 用站内相对 Location + 双层净化；上传按 magic number、服务端路径、白名单正则 + 越界检查 | §2.4 / §2.6 |
| 5 | **所有已发现问题的利用都需要额外前提，或根本不是安全问题**：A-01 需运维显式误配开关 + 令牌可得；A-02 需先能写目标站 Cookie（子域/中间人）；A-03/A-04/A-05 是**可观测性统计准确性**缺陷，不改变任何业务响应、不泄露凭据、不提供越权入口；A-06~A-14 为加固项、工程缺口或已知待裁决项 | §3 / §4 |
| 6 | **敏感数据与密钥未进入发布产物**：7 个本机 `.env.*` 均被忽略且工作区干净；3 个被跟踪模板无真实值；`.dockerignore` 排除 `.env.*`；Dockerfile 不 COPY `docs/`；当前 master 树原站素材零命中；高强度密钥模式零命中 | §2.13 |

**不成立的极端情形（不属于本次结论范围，但如实列出）**：若运维在生产**同时**设置 `ENABLE_DEBUG_ENDPOINTS=1` 且复用 CI 中公开的固定调试令牌，则 `/api/debug/reset-rate-limits` 可被用于清空全站限流配额（进而放大撞库）。这是 A-01 的具体化，**需两个配置前提**，默认部署不成立；建议发布检查表强制核对这两项。

### 5.1 非阻断的发布前建议（3 条最小加固，不由本审计执行）

1. **A-01**：`src/lib/runtime-flags.ts:45-49` 的 `isDebugEndpointEnabled()` 增加生产环境硬约束，使「生产不可启用」由机制保证而非仅靠配置默认。
2. **A-04 / A-03**：补齐 `instrumentation.ts` 的真实 HTTP 层回归（含多次 `writeHead` 只计一次），并消除 `tests/v009-observability-isolation.spec.ts:25` 的悬空引用。
3. **A-02**：把 CSRF 从「纯随机双提交」升级为签名双提交（复用已存在的 `csrfTokenFor`），关闭 Cookie 注入绕过路径。

> 另建议（不阻断）：发布前在**联网 CI** 真实执行一次 `npm audit` + 镜像 CVE 扫描并留存 artifact，以替换 `release.yml` 注释中 2026-11-03 的历史数字；R-01 按 `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` 由主人单独裁决，本审计不代做决策。

---

## 6. 审计执行声明

- 全程**未**修改任何应用源码；**未**执行 `git commit` / `push` / 建 Tag / 建 Release / 触发任何 GitHub Actions；**未**重置工作区；`README.md` / `CHANGELOG.md` / `docs/SESSION_HANDOFF_v0.0.9.md` / `docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` 等既有文件均**只读**。
- 唯一写入文件：`docs/AUDIT_v0.0.9_SECURITY_FINAL.md`（本报告，新建；写入前已确认不存在）。
- 未使用 Docker（L1）；未执行任何真实动态扫描（L2）；未运行 vitest/playwright（L3）。
- 结论中标注「通过」的项，含义为**静态代码属性与部署配置成立**；**不等价于**动态渗透测试通过或依赖/镜像实扫通过。所有未验证项已在 L1~L5 与 A-11 中显式声明。

### 6.1 并行工作区改动声明（避免误读 `git status`）

本审计**开始时** `git status --short` 为空；**结束时**工作区出现以下由其他并行 teammate 产生的改动，**均非本审计写入**：

| 路径 | 状态 | 是否影响本审计结论 |
|---|---|---|
| `src/**` | **零改动**（`git diff master -- src/ \| wc -l` = 0，`git status --porcelain -- src/` = 0） | **否** —— 全部应用侧结论仍对基线 `af61635` 成立 |
| `deploy/.env.example` | M | **否** —— 实测 diff 仅为标题 `v0.0.4` → `v0.0.9`，未新增任何凭据值；§13「3 个被跟踪模板无真实口令」结论不变 |
| `.github/workflows/soak-test.yml` / `deploy/backup.sh` / `restore.sh` / `start.sh` | M | **否** —— 属 soak / 部署脚本范畴，不在本审计 14 项应用安全结论内；PR #32 的 `238 insertions / 86 deletions` 是 **master..HEAD 已提交 diff**，不受未提交改动影响 |
| `docs/AUDIT_v0.0.9_RELEASE_PIPELINE.md` / `docs/SOAK_24H_FINDING_v0.0.9.md` | 新增 | **否** —— 其他 teammate 的产出，本审计未读取、未引用、未修改 |

本审计**唯一写入**：`docs/AUDIT_v0.0.9_SECURITY_FINAL.md`（新建，310 行 / 44,518 字节）。
