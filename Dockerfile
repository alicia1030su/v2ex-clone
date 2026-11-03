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
COPY --from=builder --chown=nextjs:nodejs /app/public/ /app/public/
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/playwright-core node_modules/playwright node_modules/@playwright \
 && npm cache clean --force \
 && rm -rf /root/.npm \
 && test -f node_modules/drizzle-kit/bin.cjs \
 && test -f node_modules/tsx/dist/cli.mjs \
 && test -f node_modules/next/dist/bin/next \
 && echo "✓ 生产依赖闭包校验通过（entrypoint 三个必需路径均在）"

USER nextjs
EXPOSE 3000

# 启动入口：分离「迁移 / 首次初始化 / 应用启动」三个阶段。
# 详见 scripts/docker-entrypoint.sh。
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["all"]
