import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../src/lib/password';
import { runDrizzleKit, runTsx, repoRoot } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';

/**
 * 管理员账号管理 CLI 回归测试（P0-1）
 *
 * 验证「口令与角色的变更只能走独立授权流程」这条约束确实成立：
 *
 *  1. 未配置 ADMIN_CLI_TOKEN → 一律拒绝
 *  2. 使用 --token 命令行参数 → 拒绝（会泄露到进程列表 / shell 历史）
 *  3. 缺少 --reason → 拒绝（变更必须留痕）
 *  4. 口令过短 / 过长 → 拒绝
 *  5. 目标用户不存在 → 拒绝
 *  6. 合法调用 → 成功，且口令真的变了，且写了审计日志
 *  7. 降级最后一个 admin → 拒绝（避免把系统锁死）
 *  8. list-admins 是只读操作，不需要令牌
 *
 * 数据库隔离：
 *  与 seed 测试一样，使用**专用库** v2ex_admintest，绝不触碰开发库/生产库。
 */

const TEST_DB = process.env.ADMIN_CLI_TEST_DB ?? 'v2ex_admintest';
const ADMIN_TOKEN = 'unit-test-admin-token-not-real';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** 运行 admin-cli，返回 { code, stdout, stderr } */
function runAdminCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): { code: number; stdout: string; stderr: string } {
  // 复用 local-bin 的跨平台入口解析（tsx 在 Windows 上是 .cmd，不能直接 exec）
  const { command, args: binArgs } = resolveTsx();
  try {
    const stdout = execFileSync(command, [...binArgs, 'scripts/admin-cli.ts', ...args], {
      encoding: 'utf8',
      cwd: repoRoot,
      env: {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
        APP_RUNTIME_ENV: 'test',
        NODE_ENV: 'test',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

/** 解析 tsx 入口（Windows 上是 .cmd，不能直接 execFileSync） */
function resolveTsx(): { command: string; args: string[] } {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = path.join(repoRoot, 'node_modules', 'tsx', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['tsx'];
  if (!bin) throw new Error('无法解析 tsx 入口');
  return {
    command: process.execPath,
    args: [path.resolve(path.dirname(pkgJsonPath), bin)],
  };
}

describe('admin-cli 授权与审计（P0-1）', () => {
  beforeAll(async () => {
    logDbTarget('tests/admin-cli.spec.ts', TEST_DB);

    // 建库 → 迁移，逐阶段计时（护栏在 provision 内部强制生效）
    await provisionTestDatabase({
      file: 'tests/admin-cli.spec.ts',
      db: TEST_DB,
      adminUrl: adminUrlOf(TEST_DB),
      migrate: () =>
        runDrizzleKit(['migrate'], {
          ...process.env,
          ENV_FILE: '',
          DATABASE_URL: dbUrlFor(TEST_DB),
        }),
    });

    client = postgres(dbUrlFor(TEST_DB), { prepare: false });
    db = drizzle(client, { schema });

    // 造两个账号：lisi（普通用户）与 admin（唯一的管理员）
    await db.insert(schema.users).values([
      {
        username: 'lisi',
        email: 'lisi@test.local',
        passwordHash: hashPassword('original-password-123'),
        role: 'user',
        balance: 100,
      },
      {
        username: 'admin',
        email: 'admin@test.local',
        passwordHash: hashPassword('admin-original-password-123'),
        role: 'admin',
        balance: 100,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
  }, 60_000);

  it('未配置 ADMIN_CLI_TOKEN 时拒绝改密', () => {
    const r = runAdminCli(
      ['set-password', '--username', 'lisi', '--password', 'BrandNewPass123', '--reason', 'test'],
      { ADMIN_CLI_TOKEN: '' },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('未配置 ADMIN_CLI_TOKEN');
  });

  it('拒绝 --token 命令行参数（会泄露到进程列表）', () => {
    const r = runAdminCli(
      [
        'set-password',
        '--username',
        'lisi',
        '--password',
        'BrandNewPass123',
        '--reason',
        'test',
        '--token',
        ADMIN_TOKEN,
      ],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('不接受 --token');
  });

  it('缺少 --reason 时拒绝', () => {
    const r = runAdminCli(
      ['set-password', '--username', 'lisi', '--password', 'BrandNewPass123'],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--reason');
  });

  it('口令过短时拒绝', () => {
    const r = runAdminCli(
      ['set-password', '--username', 'lisi', '--password', 'short', '--reason', 'test'],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('8 位');
  });

  it('目标用户不存在时拒绝', () => {
    const r = runAdminCli(
      [
        'set-password',
        '--username',
        'no-such-user-xyz',
        '--password',
        'BrandNewPass123',
        '--reason',
        'test',
      ],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('不存在');
  });

  it('合法调用成功：口令被修改且写入审计日志', async () => {
    const r = runAdminCli(
      [
        'set-password',
        '--username',
        'lisi',
        '--password',
        'BrandNewPass123',
        '--reason',
        '用户申诉后重置',
      ],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('已更新');

    // 口令真的变了
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'lisi'))
      .limit(1);
    expect(verifyPassword('BrandNewPass123', rows[0].passwordHash)).toBe(true);
    expect(verifyPassword('original-password-123', rows[0].passwordHash)).toBe(false);

    // 审计日志被写入
    const logs = await db.select().from(schema.moderationLogs);
    const entry = logs.find((l) => l.action === 'admin.set_password');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('用户申诉后重置');
    expect(entry!.targetType).toBe('user');
  });

  it('拒绝降级最后一个 admin', async () => {
    const r = runAdminCli(
      ['set-role', '--username', 'admin', '--role', 'user', '--reason', '测试降级'],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('最后一个 admin');

    // 角色未变
    const rows = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.username, 'admin'))
      .limit(1);
    expect(rows[0].role).toBe('admin');
  });

  it('角色变更成功并记录审计', async () => {
    const r = runAdminCli(
      ['set-role', '--username', 'lisi', '--role', 'moderator', '--reason', '任命为版主'],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).toBe(0);

    const rows = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.username, 'lisi'))
      .limit(1);
    expect(rows[0].role).toBe('moderator');

    const logs = await db.select().from(schema.moderationLogs);
    const entry = logs.find((l) => l.action === 'admin.set_role');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('任命为版主');
  });

  it('非法角色值被拒绝', () => {
    const r = runAdminCli(
      ['set-role', '--username', 'lisi', '--role', 'superuser', '--reason', 'test'],
      { ADMIN_CLI_TOKEN: ADMIN_TOKEN },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--role');
  });

  it('list-admins 是只读操作，不需要令牌', () => {
    const r = runAdminCli(['list-admins'], { ADMIN_CLI_TOKEN: '' });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('admin');
    expect(r.stdout).toContain('moderator');
  });

  it('admin-cli 不会在 seed 之后偷偷改回原口令', async () => {
    // 关键回归：跑一次 seed 后，admin-cli 设置的口令依然有效
    // （seed 不该覆盖 admin-cli 的变更结果）
    runTsx('scripts/seed.ts', {
      ...process.env,
      ENV_FILE: '',
      DATABASE_URL: dbUrlFor(TEST_DB),
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_EMAIL: 'admin@test.local',
      SEED_ADMIN_PASSWORD: 'seed-admin-password-123456',
      SEED_DEMO_USERS: '0',
      APP_RUNTIME_ENV: 'test',
      NODE_ENV: 'test',
    });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'lisi'))
      .limit(1);
    expect(verifyPassword('BrandNewPass123', rows[0].passwordHash)).toBe(true);
  });
});
