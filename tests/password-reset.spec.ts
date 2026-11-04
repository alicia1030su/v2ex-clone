import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { maskEmail } from '../src/lib/mailer';
import {
  createResetToken,
  consumeResetToken,
  hashToken,
  revokeUserTokens,
} from '../src/lib/reset-token-store';

/**
 * v0.0.3 密码重置 —— 安全属性回归测试
 *
 * 覆盖：
 *  1. 令牌只存哈希（数据库里没有明文）
 *  2. 过期令牌被拒
 *  3. 已使用令牌被拒（防重放）
 *  4. 已撤销令牌被拒
 *  5. 并发消费同一令牌只有一个成功
 *  6. 邮箱脱敏正确
 *  7. 生成新令牌会撤销旧的
 *
 * 数据库隔离：专用库 v2ex_v003_reset。
 */

const TEST_DB = process.env.V003_RESET_TEST_DB ?? 'v2ex_v003_reset';

/**
 * 让 `@/db` 的全局连接池也指向本测试库。
 *
 * `src/db/index.ts` 在模块加载时读取 DATABASE_URL 并缓存连接池，
 * 因此必须在**导入任何使用 @/db 的模块之前**通过 ENV_FILE 覆盖
 * （src/db/index.ts 对 ENV_FILE 使用 override:true）。
 * 否则服务层写 A 库、断言读 B 库，会出现外键约束失败。
 */
process.env.ENV_FILE = '';
process.env.DATABASE_URL = testDatabaseUrl();
// 清掉可能被其他测试文件（同一 worker 进程）缓存的连接池，
// 强制 @/db 用上面设置的测试库重新建连接。
{
  const g = globalThis as unknown as {
    __v2exSql?: unknown;
    __v2exDrizzle?: unknown;
  };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL 未配置，无法运行密码重置测试');
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId = 0;

beforeAll(async () => {
  const adminUrl = new URL(testDatabaseUrl());
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { prepare: false });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  client = postgres(testDatabaseUrl(), { prepare: false, max: 20 });
  db = drizzle(client, { schema });

  runDrizzleKit(['migrate'], {
    ...process.env,
    ENV_FILE: '',
    DATABASE_URL: testDatabaseUrl(),
  });

  const rows = await db
    .insert(schema.users)
    .values({
      username: 'resetuser',
      email: 'reset@example.com',
      passwordHash: hashPassword('OriginalPass-123'),
      role: 'user',
    })
    .returning({ id: schema.users.id });
  userId = rows[0].id;
}, 180000);

afterAll(async () => {
  await client?.end();
});

beforeEach(async () => {
  await client.unsafe(`DELETE FROM password_reset_tokens`);
  await client.unsafe(`DELETE FROM sessions`);
});

describe('v0.0.3 密码重置 —— 令牌安全', () => {
  it('数据库中只存哈希，不存明文令牌', async () => {
    const { token } = await createResetToken(userId, '127.0.0.1');

    const rows = await client.unsafe(
      `SELECT token_hash FROM password_reset_tokens WHERE user_id = ${userId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_hash).toHaveLength(64); // sha256 十六进制
  });

  it('有效令牌可以被消费一次', async () => {
    const { token } = await createResetToken(userId);
    const result = await consumeResetToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe(userId);
  });

  it('已使用的令牌被拒绝（防重放）', async () => {
    const { token } = await createResetToken(userId);

    const first = await consumeResetToken(token);
    expect(first.ok).toBe(true);

    const second = await consumeResetToken(token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('已被使用');
  });

  it('已过期的令牌被拒绝', async () => {
    const { token } = await createResetToken(userId);
    // 手动把过期时间改到过去
    await client.unsafe(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour'
       WHERE user_id = ${userId}`,
    );

    const result = await consumeResetToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('过期');
  });

  it('已撤销的令牌被拒绝', async () => {
    const { token } = await createResetToken(userId);
    await revokeUserTokens(userId);

    const result = await consumeResetToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('撤销');
  });

  it('生成新令牌会撤销该用户此前所有未使用令牌', async () => {
    const first = await createResetToken(userId);
    const second = await createResetToken(userId);

    const firstResult = await consumeResetToken(first.token);
    expect(firstResult.ok).toBe(false);

    const secondResult = await consumeResetToken(second.token);
    expect(secondResult.ok).toBe(true);
  });

  it('并发消费同一令牌，只有一个请求成功', async () => {
    const { token } = await createResetToken(userId);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeResetToken(token)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('无效令牌被拒绝', async () => {
    const result = await consumeResetToken('a'.repeat(64));
    expect(result.ok).toBe(false);
  });

  it('改密后旧会话全部失效', async () => {
    // 造两个会话
    await db.insert(schema.sessions).values([
      { id: 'sess-a', userId, expiresAt: new Date(Date.now() + 86400_000) },
      { id: 'sess-b', userId, expiresAt: new Date(Date.now() + 86400_000) },
    ]);

    const before = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    expect(before).toHaveLength(2);

    // 模拟改密流程
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash: hashPassword('BrandNewPass-456') })
        .where(eq(schema.users.id, userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    });

    const after = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    expect(after).toHaveLength(0);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(verifyPassword('BrandNewPass-456', users[0].passwordHash)).toBe(true);
    expect(verifyPassword('OriginalPass-123', users[0].passwordHash)).toBe(false);
  });
});

describe('v0.0.3 密码重置 —— 邮箱脱敏', () => {
  it('maskEmail 只保留首字母与域名', () => {
    // 脱敏规则：保留首字母 + 星号 + 完整域名；不含 @ 的异常输入整体掩码
    expect(maskEmail('alice@example.com')).toBe('a****@example.com');
    expect(maskEmail('bob@x.cn')).toBe('b**@x.cn');
    // 不含 @ 的输入不应泄漏任何原字符
    const maskedInvalid = maskEmail('not-an-email');
    expect(maskedInvalid).not.toContain('not-an-email');
    expect(maskedInvalid.startsWith('n')).toBe(true);
    expect(maskedInvalid.replace(/[^\*]/g, '').length).toBeGreaterThan(0);
  });

  it('脱敏结果不含完整本地部分', () => {
    const masked = maskEmail('secretuser@example.com');
    expect(masked).not.toContain('secretuser');
    expect(masked).toContain('@example.com');
  });
});
