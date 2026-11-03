import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDebugToken, isDebugEndpointEnabled } from '@/lib/runtime-flags';

/**
 * 调试端点访问控制
 *
 * 修复前：只要 NODE_ENV !== 'production' 即可匿名调用，
 *          任何本地进程都能清空全站限流配额或读取其他用户数据。
 *
 * 现在要求：
 *  1. ENABLE_DEBUG_ENDPOINTS=1 显式开启
 *  2. 配置了非空 DEBUG_ENDPOINT_TOKEN
 *  3. 请求携带匹配的令牌（X-Debug-Token 头或 Authorization: Bearer）
 */
export function checkDebugAccess(request: Request): NextResponse | null {
  if (!isDebugEndpointEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const expected = getDebugToken();
  if (!expected) {
    // 未配置令牌 = 拒绝一切访问（避免"开了开关就裸奔"）
    return NextResponse.json({ error: 'debug endpoints disabled: token not configured' }, { status: 404 });
  }

  const header = request.headers.get('x-debug-token');
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const provided = header?.trim() || bearer;

  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/** 恒定时间比较，避免时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
