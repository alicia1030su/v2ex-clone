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

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000

# 启动时依次执行：迁移 → 种子数据 → 启动服务
CMD ["sh", "-c", "npx drizzle-kit migrate && npx tsx scripts/seed.ts && node node_modules/next/dist/bin/next start -p 3000"]
