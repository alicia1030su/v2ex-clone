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
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
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

USER nextjs
EXPOSE 3000

# 启动入口：分离「迁移 / 首次初始化 / 应用启动」三个阶段。
# 详见 scripts/docker-entrypoint.sh。
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["all"]
