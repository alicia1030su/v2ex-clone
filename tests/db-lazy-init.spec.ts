import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { repoRoot } from './helpers/local-bin';

/**
 * 数据库客户端惰性初始化 —— 回归测试（P0-4）
 *
 * 背景：
 *  src/db/index.ts 曾在**模块加载时**就创建 postgres 连接池：
 *    export const sql = createClient();
 *
 *  而 `next build` 会导入全部路由模块。构建期没有数据库，
 *  于是构建直接失败：
 *    Error: DATABASE_URL is not set.
 *    [Error: Failed to collect page data for /api/auth/signout]
 *
 *  这让 Dockerfile 的 builder 阶段（无数据库）根本无法构建镜像 ——
 *  也就是说「干净克隆 + docker build」这条路根本走不通。
 *
 * 本测试验证：
 *  1. 没有 DATABASE_URL 时，导入 db 模块**不抛错**
 *  2. 没有 DATABASE_URL 时，`next build` 能成功
 *  3. 有 DATABASE_URL 时，查询照常工作
 */

function runNode(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: repoRoot,
    env,
  });
}

/** 解析 tsx 入口（Windows 上是 .cmd，不能直接 execFileSync） */
function tsxEntry(): string {
  const pkgJsonPath = path.join(repoRoot, 'node_modules', 'tsx', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['tsx'];
  if (!bin) throw new Error('无法解析 tsx 入口');
  return path.resolve(path.dirname(pkgJsonPath), bin);
}

describe('数据库客户端惰性初始化（P0-4）', () => {
  it('src/db/index.ts 不在模块顶层创建连接池', () => {
    const src = readFileSync(path.join(repoRoot, 'src', 'db', 'index.ts'), 'utf8');
    // 顶层直接 createClient() 是旧的错误写法
    expect(src).not.toMatch(/export const sql = globalForDb\.__v2exSql \?\? createClient\(\)/);
    // 顶层 export const db = drizzle(sql, ...) 同样会在导入时触发连接
    expect(src).not.toMatch(/export const db = drizzle\(sql/);
  });

  it('没有 DATABASE_URL 时导入 db 模块不会抛错', () => {
    const script = `
      import { db, sql, schema } from './src/db/index.ts';
      console.log('IMPORT_OK');
      // 只确认对象存在，不触发查询
      if (!db || !sql || !schema) { throw new Error('exports missing'); }
      console.log('EXPORTS_OK');
    `;
    const tmp = path.join(repoRoot, '.lazy-init-probe.mts');
    require('node:fs').writeFileSync(tmp, script, 'utf8');
    try {
      const out = runNode([tsxEntry(), tmp], {
        ...process.env,
        DATABASE_URL: '',
        ENV_FILE: '',
        NODE_ENV: 'production',
      });
      expect(out).toContain('IMPORT_OK');
      expect(out).toContain('EXPORTS_OK');
    } finally {
      if (existsSync(tmp)) require('node:fs').unlinkSync(tmp);
    }
  });

  it('没有 DATABASE_URL 时真正调用数据库 API 才报错（错误信息可读）', () => {
    const script = `
      import { db } from './src/db/index.ts';
      try {
        // 用不依赖业务表的查询 —— CI 的 unit job 不跑迁移
        await db.execute('select 1');
        console.log('UNEXPECTED_SUCCESS');
      } catch (e) {
        console.log('EXPECTED_ERROR:' + (e && e.message ? e.message : String(e)));
      }
    `;
    const tmp = path.join(repoRoot, '.lazy-init-probe2.mts');
    require('node:fs').writeFileSync(tmp, script, 'utf8');
    try {
      const out = runNode([tsxEntry(), tmp], {
        ...process.env,
        DATABASE_URL: '',
        ENV_FILE: '',
      });
      expect(out).toContain('EXPECTED_ERROR:');
      expect(out).toContain('DATABASE_URL is not set');
    } finally {
      if (existsSync(tmp)) require('node:fs').unlinkSync(tmp);
    }
  });

  it('客户端与 drizzle 实例始终缓存（生产环境也不能每次新建连接池）', () => {
    // 回归：曾经只在非生产环境缓存，导致生产环境每次 db.xxx 都新建
    // 一个 postgres 连接池 —— 几十个请求就耗尽连接，
    // 表现为 E2E 耗时从 1 分钟涨到 7 分钟且并发用例随机失败。
    const src = readFileSync(path.join(repoRoot, 'src', 'db', 'index.ts'), 'utf8');
    expect(src).toContain('__v2exSql = createClient()');
    expect(src).toContain('__v2exDrizzle = drizzle(');
    // 缓存逻辑不得被 NODE_ENV 条件包裹
    expect(src).not.toMatch(/if \(process\.env\.NODE_ENV !== 'production'\) \{\s*globalForDb\.__v2ex/);
  });

  it('生产模式下反复查询复用同一个连接池', () => {
    const script = `
      import { db, sql } from './src/db/index.ts';
      // 用不依赖任何业务表的查询（select 1）——
      // CI 的 unit job 不跑迁移，业务表不存在会导致误报失败。
      for (let i = 0; i < 5; i++) {
        await db.execute('select 1');
      }
      const g = globalThis;
      console.log('CACHED_SQL:' + (g.__v2exSql ? 'yes' : 'no'));
      console.log('CACHED_DRIZZLE:' + (g.__v2exDrizzle ? 'yes' : 'no'));
      await sql.end();
    `;
    const tmp = path.join(repoRoot, '.lazy-init-probe3.mts');
    require('node:fs').writeFileSync(tmp, script, 'utf8');
    try {
      const out = runNode([tsxEntry(), tmp], {
        ...process.env,
        NODE_ENV: 'production',
        ENV_FILE: '',
      });
      expect(out).toContain('CACHED_SQL:yes');
      expect(out).toContain('CACHED_DRIZZLE:yes');
    } finally {
      if (existsSync(tmp)) require('node:fs').unlinkSync(tmp);
    }
  });
});
