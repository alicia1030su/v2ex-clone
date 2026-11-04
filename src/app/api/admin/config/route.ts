import { NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { smtpConfig } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/config —— 系统配置展示（只读）
 *
 * 权限：config.view（moderator / admin）
 *
 * **脱敏**：所有凭据类配置一律不返回明文。
 * 这是「不得提供未经验证的危险操作」的一部分 ——
 * 后台只读展示配置，绝不提供修改配置或执行任意 SQL 的接口。
 */
export async function GET(request: Request) {
  const guard = await adminGuard(request, 'config.view');
  if (guard.response) return guard.response;

  const smtp = smtpConfig();

  const mask = (v: string | undefined): string | null => {
    if (!v) return null;
    if (v.length <= 4) return '****';
    return `${v.slice(0, 2)}****${v.slice(-2)}`;
  };

  const databaseUrl = process.env.DATABASE_URL ?? '';
  let dbInfo: { host?: string; port?: string; database?: string } = {};
  try {
    const u = new URL(databaseUrl);
    dbInfo = { host: u.hostname, port: u.port, database: u.pathname.replace(/^\//, '') };
  } catch {
    dbInfo = {};
  }

  return NextResponse.json({
    ok: true,
    app: {
      nodeEnv: process.env.NODE_ENV ?? 'development',
      runtimeEnv: process.env.APP_RUNTIME_ENV ?? 'development',
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,
    },
    database: {
      ...dbInfo,
      // 绝不返回口令
      password: databaseUrl ? '****' : null,
    },
    redis: {
      configured: !!process.env.REDIS_URL,
      // 只显示 host，不显示完整连接串（可能含口令）
      host: process.env.REDIS_URL
        ? (() => {
            try {
              return new URL(process.env.REDIS_URL!).hostname;
            } catch {
              return '****';
            }
          })()
        : null,
    },
    smtp: {
      configured: !!smtp,
      host: smtp?.host ?? null,
      port: smtp?.port ?? null,
      secure: smtp?.secure ?? null,
      from: smtp?.from ?? null,
      user: smtp?.user ? mask(smtp.user) : null,
      pass: smtp?.pass ? '****' : null,
    },
    security: {
      trustProxyHeaders: process.env.TRUST_PROXY_HEADERS === '1',
      topicEditWindowMinutes: Number(process.env.TOPIC_EDIT_WINDOW_MINUTES ?? 60),
      passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60),
      enableDebugEndpoints: process.env.ENABLE_DEBUG_ENDPOINTS === '1',
    },
    note: '敏感凭据一律脱敏展示；本后台不提供修改配置或执行任意 SQL 的接口',
  });
}
