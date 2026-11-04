import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import {
  hasPermission,
  checkPermission,
  canBanUser,
  canChangeRole,
  type Permission,
} from '../src/lib/permissions';

/**
 * v0.0.3 后台权限矩阵测试
 *
 * 验证每个管理权限在三种角色下的判定，确保：
 *  - 未登录 → 401（需要认证）
 *  - 已登录但权限不足 → 403（无权）
 *  - 权限矩阵与 src/lib/permissions.ts 的声明一致
 *
 * 这层测试保护的是「服务端鉴权」的正确性 ——
 * 路由层的实际鉴权由 adminGuard / adminGuardWrite 统一执行，
 * 本测试确保该守卫所依赖的权限矩阵本身没有漏洞。
 */

const TEST_DB = process.env.V003_ADMIN_TEST_DB ?? 'v2ex_v003_admin';

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
  if (!base) throw new Error('DATABASE_URL 未配置，无法运行后台权限测试');
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Role = 'user' | 'moderator' | 'admin';

function makeUser(role: Role) {
  return {
    id: role === 'user' ? 1 : role === 'moderator' ? 2 : 3,
    username: role,
    role,
    status: 'active' as const,
    balance: 100,
    avatar: null,
  };
}

/** 权限矩阵期望表 —— 与 src/lib/permissions.ts 的 MATRIX 对应 */
const EXPECTED: Record<Permission, Record<Role, boolean>> = {
  'users.view': { user: false, moderator: true, admin: true },
  'users.role': { user: false, moderator: false, admin: true },
  'users.ban': { user: false, moderator: true, admin: true },
  'users.ban_admin': { user: false, moderator: false, admin: true },
  'reports.view': { user: false, moderator: true, admin: true },
  'reports.handle': { user: false, moderator: true, admin: true },
  'content.hide': { user: false, moderator: true, admin: true },
  'nodes.approve': { user: false, moderator: true, admin: true },
  'credits.adjust': { user: false, moderator: false, admin: true },
  'logs.view': { user: false, moderator: true, admin: true },
  'config.view': { user: false, moderator: true, admin: true },
};

beforeAll(async () => {
  const adminUrl = new URL(testDatabaseUrl());
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { prepare: false });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  client = postgres(testDatabaseUrl(), { prepare: false });
  db = drizzle(client, { schema });

  runDrizzleKit(['migrate'], {
    ...process.env,
    ENV_FILE: '',
    DATABASE_URL: testDatabaseUrl(),
  });

  await db.insert(schema.users).values([
    { username: 'u_normal', passwordHash: 'x', role: 'user' },
    { username: 'u_mod', passwordHash: 'x', role: 'moderator' },
    { username: 'u_admin', passwordHash: 'x', role: 'admin' },
  ]);
}, 180000);

afterAll(async () => {
  await client?.end();
});

describe('v0.0.3 后台 —— 权限矩阵', () => {
  for (const [permission, expected] of Object.entries(EXPECTED)) {
    it(`${permission}：user=${expected.user} moderator=${expected.moderator} admin=${expected.admin}`, () => {
      for (const role of ['user', 'moderator', 'admin'] as Role[]) {
        const user = makeUser(role);
        expect(hasPermission(user, permission as Permission)).toBe(expected[role]);
      }
    });
  }

  it('未登录对任何管理权限都无权限', () => {
    for (const permission of Object.keys(EXPECTED) as Permission[]) {
      expect(hasPermission(null, permission)).toBe(false);
      expect(hasPermission(undefined, permission)).toBe(false);
    }
  });
});

describe('v0.0.3 后台 —— 401 与 403 的区分', () => {
  it('未登录 → 401（需要登录）', () => {
    const check = checkPermission(null, 'users.view');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(401);
      expect(check.reason).toContain('登录');
    }
  });

  it('已登录但角色不足 → 403（权限不足）', () => {
    const check = checkPermission(makeUser('user'), 'users.view');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(403);
      expect(check.reason).toContain('权限');
    }
  });

  it('权限充足 → ok 且返回用户', () => {
    const check = checkPermission(makeUser('admin'), 'users.view');
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.user.role).toBe('admin');
  });
});

describe('v0.0.3 后台 —— 高危操作的额外保护', () => {
  it('不能封禁自己', () => {
    const admin = makeUser('admin');
    const result = canBanUser(admin, { id: admin.id, role: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('自己');
  });

  it('moderator 不能封禁 admin', () => {
    const mod = makeUser('moderator');
    const result = canBanUser(mod, { id: 3, role: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('管理员');
  });

  it('admin 可以封禁普通用户与 moderator', () => {
    const admin = makeUser('admin');
    expect(canBanUser(admin, { id: 1, role: 'user' }).ok).toBe(true);
    expect(canBanUser(admin, { id: 2, role: 'moderator' }).ok).toBe(true);
  });

  it('moderator 可以封禁普通用户', () => {
    const mod = makeUser('moderator');
    expect(canBanUser(mod, { id: 1, role: 'user' }).ok).toBe(true);
  });

  it('普通用户不能封禁任何人', () => {
    const user = makeUser('user');
    expect(canBanUser(user, { id: 2, role: 'moderator' }).ok).toBe(false);
  });

  it('管理员不能把自己降级（防锁死）', () => {
    const admin = makeUser('admin');
    const result = canChangeRole(admin, { id: admin.id, role: 'admin' }, 'user');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('自己');
  });

  it('管理员可以调整他人角色', () => {
    const admin = makeUser('admin');
    expect(canChangeRole(admin, { id: 1, role: 'user' }, 'moderator').ok).toBe(true);
    expect(canChangeRole(admin, { id: 2, role: 'moderator' }, 'user').ok).toBe(true);
  });

  it('moderator 不能改变任何人的角色', () => {
    const mod = makeUser('moderator');
    expect(canChangeRole(mod, { id: 1, role: 'user' }, 'moderator').ok).toBe(false);
  });
});

describe('v0.0.3 后台 —— 危险操作不存在', () => {
  it('后台不提供删除用户 / 执行 SQL / 修改配置的接口', async () => {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const base = join(process.cwd(), 'src', 'app', 'api', 'admin');

    const found: string[] = [];
    async function walk(dir: string, rel = '') {
      let entries: string[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          await walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.name === 'route.ts') {
          found.push(rel ? `${rel}/${e.name}` : e.name);
        }
      }
    }
    await walk(base);

    // 不应存在的高危路径
    const forbidden = ['delete', 'sql', 'exec', 'shell', 'reset-password', 'config/write'];
    for (const rel of found) {
      const lower = rel.toLowerCase();
      for (const bad of forbidden) {
        expect(lower).not.toContain(bad);
      }
    }
    // 确认扫描确实覆盖到了路由（否则测试是假通过）
    expect(found.length).toBeGreaterThanOrEqual(10);
  });
});
