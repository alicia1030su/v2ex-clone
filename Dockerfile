# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# V2EX Clone — 生产镜像
# 多阶段构建：deps → builder → runner
# ---------------------------------------------------------------------------

FROM node:22.23.4-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- 依赖层 ---------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- 构建层 ---------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# 构建期不需要数据库连接；迁移在容器启动时执行
RUN npm run build

# --- 运行层 ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV APP_RUNTIME_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# public/ 可能为空目录（Git 不跟踪空目录），COPY 空目录会失败。
# 这里用「先建目录再复制」的方式，保证该目录在镜像中一定存在。
RUN mkdir -p /app/public
# v0.0.5：预创建**运行时**上传目录（头像）。
#
# 背景：头像文件在**运行时**写入 `public/uploads/avatars/...`，
# 而不是构建期存在 ⇒ `public/` 的内容不会被 COPY 进镜像。
# 若不预创建，首次上传会因目录不存在而失败（ENOENT）。
#
# 权限：容器以 `nextjs`（uid 1001）运行 ⇒ 目录必须对它可写。
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads
COPY --from=builder --chown=nextjs:nodejs /app/public/ /app/public/
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
# ---------------------------------------------------------------------------
# scripts —— 只拷**运行时真正要执行的**那些（v0.0.15 收窄）
#
# 修复前是 `COPY --from=builder /app/scripts ./scripts`（整目录）。
# 而 `.dockerignore` 里**没有任何 scripts 规则** ⇒ 整个 scripts/（45 个文件）
# 全部进入构建上下文，再被这条整目录 COPY 搬进生产镜像。后果：
#
#   · `scripts/ci/*.sh` 与 `scripts/release/verify-upgrade-*.sh` 里
#     **明文写着测试专用凭据**（`ci-only-session-secret-…`、
#     `v2ex_test_password_local_only`、`ci-postgres-password-not-real`）
#     ⇒ 生产镜像里带着一份「看起来像真密钥」的字面量。
#     它们不是生产凭据（安装器会随机生成），但会误导审计、也会被扫描器报警。
#   · `fake-smtp-server.ts` / `reset-test-credentials.ts` / `ui-verify.cjs`
#     是**测试与 CI 专用**的，运行时一个都不执行。
#   · `scripts/release/*` 是**发布机**上的工具（打包 / 校验 / 升级演练），
#     在容器里跑没有意义，还会把发布流程细节暴露进镜像。
#
# 因此改为**显式白名单**：只拷容器内真实执行的四个脚本 + 一个目录。
# 白名单的好处是「新增脚本默认不进镜像」——漏掉必须靠加白名单才会坏，
# 而整目录 COPY 是「新增脚本默认进镜像」，两种默认值的安全方向相反。
#
# 容器内真实执行的（证据：scripts/docker-entrypoint.sh 与 deploy/INSTALL.md）：
#   · docker-entrypoint.sh  ← ENTRYPOINT（阶段 1 迁移 / 阶段 2 初始化 / 启动）
#   · seed.ts               ← entrypoint 阶段 2（node tsx scripts/seed.ts）
#   · wait-for-db.mjs       ← entrypoint 阶段 1 就绪探测
#   · admin-cli.ts          ← INSTALL.md:493 指导用户在容器内重置口令
#   · db-admin.mjs          ← 运维脚本（Dockerfile 下方注释已声明）
#
# ⚠️ 改这里必须同步 `.dockerignore` 的白名单，否则 builder 阶段
#    `COPY . .` 会把被排除的文件从上下文里剔掉，这里的 COPY 直接失败。
#    `tests/static/v015-image-hygiene.spec.ts` 钉死了两者的双向一致。
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/scripts/seed.ts ./scripts/seed.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/wait-for-db.mjs ./scripts/wait-for-db.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/admin-cli.ts ./scripts/admin-cli.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/db-admin.mjs ./scripts/db-admin.mjs
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# seed.ts 与 admin-cli.ts 需要 src/db（schema 与客户端），必须一并拷入。
# 缺了它容器启动时会出现：
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/db/index'
COPY --from=builder --chown=nextjs:nodejs /app/src/db ./src/db
# 只拷 seed / admin-cli 真正用到的 lib 模块。
# 整目录拷贝会把带 `import 'server-only'` 的模块也带进去 —— 那在纯 Node
# 环境下会抛错，反而让容器里的运维脚本无法运行。
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/password.ts ./src/lib/password.ts
# env-loader.mjs —— **容器启动链的真实依赖**（2026-11-04 回归修复）
#
# 漏拷它的真实事故（CI docker-verify 首跑抓到的）：
#   entrypoint 阶段 1「迁移」→ drizzle-kit 读 /app/drizzle.config.ts
#   → 它 import './src/lib/env-loader.mjs'
#   → Cannot find module './src/lib/env-loader.mjs'
#   → 迁移失败、容器退出、compose 无限重启，第 2 项断言红灯。
#
# 镜像内依赖它的代码（全部）：
#   · drizzle.config.ts              （阶段 1 迁移的子进程入口）
#   · scripts/seed.ts                （阶段 2 首次初始化）
#   · scripts/admin-cli.ts、db-admin.mjs（运维脚本）
#   · src/db/index.ts                （上面所有路径都经它连库）
#
# 传递依赖审计：本模块只 import node:fs / node:module / node:path / dotenv，
# 无其他 src/ 依赖 —— 不存在「补一个又漏一个」的递归风险。
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/env-loader.mjs ./src/lib/env-loader.mjs

# ---------------------------------------------------------------------------
# 生产依赖（2026-11-04 重做）
#
# 修复前的真实缺陷：runner 层直接 `COPY --from=builder /app/node_modules`，
# 把**整个** node_modules（含全部 devDependencies）搬进了最终镜像 ——
# 本机实测 node_modules 共 530 MB，其中：
#   @playwright/test + vitest + typescript + @types/* + pixelmatch + pngjs
#   全部是**测试期工具**，生产运行时一个都用不到。
# 此外 devDependencies 里还带着 GHSA-67mh-4wv8-2f99 的受影响版本
# （@esbuild-kit/core-utils → esbuild 0.18.20），等于把漏洞版本一起发了出去。
#
# 现在的做法：runner 层用 `npm ci --omit=dev` 按依赖图装**生产依赖**。
#
# 关键前提：drizzle-kit 与 tsx 已从 devDependencies **上移到 dependencies**
# —— 它们不是测试工具，而是容器启动的真实运行时依赖：
#   - drizzle-kit：entrypoint 阶段 1「迁移」（node node_modules/drizzle-kit/bin.cjs migrate）
#   - tsx：entrypoint 阶段 2「首次初始化」（node node_modules/tsx/dist/cli.mjs scripts/seed.ts）
# 漏掉任何一个，容器都起不来。
#
# 为什么不整目录 COPY builder 的 node_modules：那会把测试工具链一起带上，
# 既 bloating 镜像又把漏洞版本带进生产。npm ci --omit=dev 是按依赖图裁剪的，
# 只会装真正需要的闭包。
#
# ---------------------------------------------------------------------------
# playwright-core 残余（14 MB）—— 必须显式删除
#
# 根因：`next@15.5.28` 把 `@playwright/test` 声明为 **peerOptional**：
#   "peerDependenciesMeta": { "@playwright/test": { "optional": true } }
# npm 会**自动安装 optional peer** —— 即使根项目的 `@playwright/test`
# 在 devDependencies 里。所以 `npm ci --omit=dev` 之后 playwright-core 仍在。
#
# `--omit=peer` **无效**（实测：73 packages / 429 MB，playwright-core 仍在），
# 因为 optional peer 的语义就是「可选但默认装」。
#
# 实测证据（2026-11-04，真实 `npm ci --omit=dev` + 真实 `next start`）：
#   · next 的**运行时**（dist/server/**）**零处**引用 playwright；
#     仅 `dist/cli/next-test.js` 与 `dist/experimental/testmode/**`
#     引用 —— 那是 `next test` / `experimental-test` 的路径，
#     本项目从不使用。
#   · 删除 playwright-core 后，`next start` 实测：
#       / -> 200   /signin -> 200   /nodes -> 200
#       /api/captcha -> 200   /t/1 -> 200
#     且日志中 `MODULE_NOT_FOUND` 计数为 **0**。
#   · 三个 entrypoint 路径（drizzle-kit/bin.cjs、tsx/dist/cli.mjs、
#     next/dist/bin/next）在删除后**全部仍在**。
#   · 体积 429 MB -> 411 MB。
#
# 下面的断言是**防回归护栏**：若将来 next 把 playwright 变成运行时必需，
# 构建会**当场失败**，而不是等容器启动时才炸。
# ---------------------------------------------------------------------------
#
# ---------------------------------------------------------------------------
# sharp（v0.0.5）：头像裁剪 / 重编码 / EXIF 处理的原生依赖
# ---------------------------------------------------------------------------
#
# 本项目的头像上传**依赖 sharp** 做服务端裁剪与重新编码
# （src/lib/avatar.ts 的 processAvatar）。
#
# ⚠️ 关键事实：Alpine Linux 用的是 **musl libc**，不是 glibc ——
# sharp 的原生二进制是平台专属的。sharp 通过 `optionalDependencies`
# 提供各平台预编译包（`@img/sharp-linuxmusl-x64` 等），
# `npm ci` 会按运行平台自动选对 —— **前提是 lock 文件里有对应条目**。
#
# 本轮已把 sharp 从「Next 的传递依赖」提升为**直接依赖**
# （package.json dependencies: "sharp": "0.35.5"）：
#   · 传递依赖的版本不受我们控制，Next 升级可能静默换掉它；
#   · 直接依赖才能在 lock 里锁定版本与各平台二进制。
#
# 下面的断言是**防回归护栏**：若将来某个环节漏掉了 sharp 的原生包，
# 容器会**当场构建失败**，而不是等用户上传头像时才报
# 「无法解析该图片文件」。
# ---------------------------------------------------------------------------
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/playwright-core node_modules/playwright node_modules/@playwright \
 && npm cache clean --force \
 && rm -rf /root/.npm \
 && test -f node_modules/drizzle-kit/bin.cjs \
 && test -f node_modules/tsx/dist/cli.mjs \
 && test -f node_modules/next/dist/bin/next \
 && test -d node_modules/sharp \
 && node -e "require('sharp')" \
 && echo "✓ 生产依赖闭包校验通过（entrypoint 三个必需路径 + sharp 均在）"

USER nextjs
EXPOSE 3000

# 启动入口：分离「迁移 / 首次初始化 / 应用启动」三个阶段。
# 详见 scripts/docker-entrypoint.sh。
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["all"]
