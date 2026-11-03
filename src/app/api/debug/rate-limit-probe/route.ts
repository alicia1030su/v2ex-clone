import { NextResponse } from 'next/server';
import { checkDebugAccess } from '@/lib/debug-auth';
import { getKV } from '@/lib/kv';

export const dynamic = 'force-dynamic';

/**
 * 调试端点：验证限流窗口的跨窗口重置语义。
 *
 * 修复前 PostgreSQL 的 incrWindow 只做 count+1，从不比较 window_start，
 * 窗口过期后计数会无限累积，导致该键被永久锁死。
 *
 * 本探针用 1 秒窗口连续自增两次，验证第二个窗口的计数回到 1。
 */
export async function POST(request: Request) {
  const denied = checkDebugAccess(request);
  if (denied) return denied;

  const kv = await getKV();
  const key = `probe:rate-limit:${Date.now()}`;

  const first = await kv.incrWindow(key, 1);
  const second = await kv.incrWindow(key, 1);

  // 等待窗口切换
  await new Promise((r) => setTimeout(r, 1100));
  const third = await kv.incrWindow(key, 1);

  await kv.del(key);

  return NextResponse.json({
    firstWindowCount: first.count,
    secondWindowCount: second.count,
    thirdWindowCount: third.count,
    /** 若跨窗口重置正确，第三个计数应回到 1 */
    windowResetWorking: third.count === 1,
  });
}
