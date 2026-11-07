import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

/**
 * 存活探针（liveness）
 *
 * 语义：**进程能响应 HTTP** 即 200。不查数据库 ——
 * 数据库故障不应让容器被kill 重建（那是 readiness 的职责，
 * 见 `/api/health/ready`）。
 *
 * 安全：不返回任何内部状态（连接串/版本明细），仅 ok + 版本号。
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'ok', version: process.env.npm_package_version ?? undefined },
    { status: 200 },
  );
}
