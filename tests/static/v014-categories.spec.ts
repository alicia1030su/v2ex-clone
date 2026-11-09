import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 分类管理链路护栏（v0.0.14）
 *
 * ## 这个护栏防的是什么
 *
 * `categories` 表从 v0.0.1 起就存在，`/nodes` 页面也按分类分组渲染节点，
 * 但全仓 `insert/update/delete(schema.categories)` **零命中** ——
 * 分类只能由 `scripts/seed.ts` 写入。
 * 真实部署中管理员无法创建 / 改名 / 排序 / 禁用分类：
 * **表与页面齐全、管理链路不通**。
 *
 * 与 `tests/static/v014-tag-chain.spec.ts` 同一思路：本护栏**不看文件是否存在**，
 * 只看链路是否真的接上 ——
 * ① 迁移文件与 journal 一致（否则 `scripts/release/preflight.sh` 判红）；
 * ② 两个 admin 路由都经 `adminGuard*`（权限判定的唯一入口）；
 * ③ 路由里**不得**出现手写角色判断（`role === 'admin'` 之类）；
 * ④ 权限矩阵新增 `categories.manage` 且**只允许 admin**。
 *
 * ## 为什么用静态断言
 *
 * 这些是「防护没被删掉」的属性，动态测试很难覆盖
 * （要构造 N 个角色 × M 个端点的组合），且真打提权测试本身有风险。
 * 但静态断言**不能替代**动态验证 —— 后者由
 * `tests/categories-admin.spec.ts`（真库）负责。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * 剥掉注释，只留真实代码。
 *
 * ⚠️ 本仓反复踩过「护栏用朴素字符串匹配，把注释里的说明当成实现」的坑。
 * 凡是「不得出现某写法」这类**反向断言**，都必须先剥注释 ——
 * 否则「刻意不用 role === 'admin'，改用权限矩阵」这句注释自己就会判红。
 */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * 提取导出处理函数的函数体（括号 / 大括号双配平）。
 *
 * 与 `tests/v005-security-audit.spec.ts` 的同名工具思路一致：
 * 参数可能跨行且含嵌套括号（如 `{ params }: Promise<{ id: string }>`），
 * 因此不能靠单行正则判断「函数体里有没有 adminGuard」。
 */
function functionBody(src: string, name: string): string | null {
  const m = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;

  let i = m.index + m[0].length - 1;
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')') {
      paren--;
      if (paren === 0) break;
    }
  }
  if (i >= src.length) return null;

  const brace = src.indexOf('{', i);
  if (brace < 0) return null;

  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(brace, j + 1);
    }
  }
  return null;
}

/** 「方法名 → 函数体」 */
function exportedHandlers(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g)) {
    const body = functionBody(src, m[1]);
    if (body) out[m[1]] = body;
  }
  return out;
}

/**
 * 判据 ①：所有 admin 写处理函数都必须经 `adminGuard` / `adminGuardWrite`。
 *
 * 抽成具名函数是为了让**负向对照**能复用同一判据 ——
 * 否则负向对照只证明了「另写的那个表达式会失败」，
 * 而不是「护栏用的判据本身有鉴别力」。
 */
export function findHandlersWithoutGuard(src: string): string[] {
  const missing: string[] = [];
  for (const [method, body] of Object.entries(exportedHandlers(codeOnly(src)))) {
    if (!body.includes('adminGuard')) missing.push(method);
  }
  return missing;
}

/**
 * 判据 ②：处理函数里不得出现手写角色判断。
 *
 * 允许的写法只有 `adminGuard(request, '<permission>')` ——
 * 角色→权限的映射集中在 `src/lib/permissions.ts`。
 * `role === 'admin'` 这类硬编码会让「某天改了权限矩阵」变成不可能，
 * 更糟的是一个接口忘了校验就整体失效。
 */
export function findManualRoleChecks(src: string): string[] {
  const code = codeOnly(src);
  const hits: string[] = [];
  // 角色字面量与 === / !== 或 includes 的组合
  const patterns: RegExp[] = [
    /\brole\s*[!=]==?\s*'admin'/,
    /\brole\s*[!=]==?\s*'moderator'/,
    /isAdmin\s*\(/,
    /'admin'\s*[!=]==?\s*\w+\.role/,
  ];
  for (const re of patterns) {
    if (re.test(code)) hits.push(re.source);
  }
  return hits;
}

const CATEGORIES_ROUTE = 'src/app/api/admin/categories/route.ts';
const CATEGORY_ID_ROUTE = 'src/app/api/admin/categories/[id]/route.ts';
const MIGRATION = 'drizzle/0004_v014_categories.sql';
const JOURNAL = 'drizzle/meta/_journal.json';

describe('v0.0.14 · 分类管理的迁移与 journal 必须一致', () => {
  it('迁移文件存在且包含 hidden / updated_at / 排序索引', () => {
    const sql = read(MIGRATION);
    expect(sql, '必须新增 hidden 列（禁用语义，不删数据）').toMatch(
      /ALTER TABLE categories ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false/,
    );
    expect(sql, '必须新增 updated_at 列（管理操作可观测性）').toMatch(
      /ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/,
    );
    expect(sql, '必须为 sort,id 建索引（列表页恒定按此排序）').toMatch(
      /CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories \(sort, id\)/,
    );
    // 幂等性：全部 IF NOT EXISTS，现场手工补迁移时不至于炸库
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'));
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s, `迁移语句必须幂等：${s.slice(0, 60)}`).toMatch(/IF NOT EXISTS/);
    }
  });

  it('**刻意**不给 name 加唯一索引（历史重名会让升级迁移直接失败）', () => {
    const code = codeOnly(read(MIGRATION));
    expect(
      code,
      'categories.name 不得加唯一索引：历史数据可能已有重名，加索引会让升级迁移失败',
    ).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*categories/);
    expect(code).not.toMatch(/UNIQUE[\s]*\([\s]*name[\s]*\)/);
  });

  it('journal 有 0004 条目，且条目数等于迁移文件数（preflight 判据）', () => {
    const journal = JSON.parse(read(JOURNAL)) as {
      entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
    };
    const entry = journal.entries.find((e) => e.idx === 4);
    expect(entry, 'journal 缺少 idx=4 条目 ⇒ scripts/release/preflight.sh 会判红').toBeDefined();
    expect(entry?.tag).toBe('0004_v014_categories');
    expect(entry?.version ?? '7').toBeTruthy();
    expect(entry?.when).toBeGreaterThan(0);
    expect(entry?.breakpoints).toBe(true);

    // 迁移文件数 == journal 条目数（preflight.sh 的 EXPECTED_MIGRATIONS 判据）
    const files = readdirSync(path.join(ROOT, 'drizzle')).filter((f) => /^0.*\.sql$/.test(f));
    expect(
      files.length,
      `drizzle/ 下 ${files.length} 个迁移文件与 journal ${journal.entries.length} 条不一致`,
    ).toBe(journal.entries.length);
  });

  it('schema.ts 的 categories 表与迁移字段一致（不会「迁移加了列、ORM 没加」）', () => {
    const schema = read('src/db/schema.ts');
    expect(schema, 'schema.categories 必须有 hidden 列').toMatch(
      /hidden:\s*boolean\('hidden'\)\.notNull\(\)\.default\(false\)/,
    );
    expect(schema, 'schema.categories 必须有 updatedAt 列').toMatch(
      /updatedAt:\s*timestamp\('updated_at',\s*\{\s*withTimezone:\s*true\s*\}\)\.notNull\(\)\.defaultNow\(\)/,
    );
  });
});

describe('v0.0.14 · 分类 admin 路由必须经统一守卫', () => {
  it('GET 用 adminGuard(categories.view)，POST 用 adminGuardWrite(categories.manage)', () => {
    const src = codeOnly(read(CATEGORIES_ROUTE));
    const handlers = exportedHandlers(src);

    expect(handlers.GET, '缺少 GET 处理函数').toBeTruthy();
    expect(handlers.POST, '缺少 POST 处理函数').toBeTruthy();

    expect(handlers.GET, 'GET 必须校验 categories.view').toMatch(
      /adminGuard\(\s*request\s*,\s*'categories\.view'\s*\)/,
    );
    expect(handlers.POST, 'POST 必须用 adminGuardWrite（含 CSRF）').toMatch(
      /adminGuardWrite\(\s*request\s*,\s*'categories\.manage'\s*\)/,
    );
  });

  it('PATCH /[id] 用 adminGuardWrite(categories.manage)，且**没有** DELETE', () => {
    const src = codeOnly(read(CATEGORY_ID_ROUTE));
    const handlers = exportedHandlers(src);

    expect(handlers.PATCH, '缺少 PATCH 处理函数').toBeTruthy();
    expect(handlers.PATCH, 'PATCH 必须用 adminGuardWrite（含 CSRF）').toMatch(
      /adminGuardWrite\(\s*request\s*,\s*'categories\.manage'\s*\)/,
    );
    // 删分类会让 nodes.category_id 悬空 —— 禁用（hidden=true）才是正确语义
    expect(handlers.DELETE, '不得提供 DELETE：禁用用 hidden=true，避免节点外键断裂').toBeUndefined();
  });

  it('两个路由都不手写角色判断（权限矩阵是唯一事实来源）', () => {
    for (const file of [CATEGORIES_ROUTE, CATEGORY_ID_ROUTE]) {
      const hits = findManualRoleChecks(read(file));
      expect(
        hits,
        `${file} 出现了手写角色判断（应改用 adminGuard + permissions.ts 的矩阵）：${hits.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('两个路由都不手写 CSRF 校验（adminGuardWrite 已包含）', () => {
    for (const file of [CATEGORIES_ROUTE, CATEGORY_ID_ROUTE]) {
      const code = codeOnly(read(file));
      expect(
        code,
        `${file} 手写了 CSRF 校验 —— adminGuardWrite 已包含，重复实现会掩盖漏检`,
      ).not.toMatch(/guardCsrf\s*\(/);
    }
  });

  it('响应只回显白名单字段（不整行返回 categories）', () => {
    for (const file of [CATEGORIES_ROUTE, CATEGORY_ID_ROUTE]) {
      const code = codeOnly(read(file));
      expect(code, `${file} 必须经 toCategoryDto 输出，避免将来新增内部字段被顺手泄漏`).toContain(
        'toCategoryDto(',
      );
    }
  });

  it('审计日志被**真实调用**（不是只 import）', () => {
    const create = codeOnly(read(CATEGORIES_ROUTE));
    const patch = codeOnly(read(CATEGORY_ID_ROUTE));
    expect(create, 'POST 必须真实写审计日志').toMatch(/writeAuditLog\(/);
    expect(create).toContain('AuditAction.CATEGORY_CREATE');
    expect(patch, 'PATCH 必须真实写审计日志').toMatch(/writeAuditLog\(/);
    // 禁用 / 启用 / 普通更新必须是三个可区分的动作
    expect(patch).toContain('AuditAction.CATEGORY_HIDE');
    expect(patch).toContain('AuditAction.CATEGORY_SHOW');
    expect(patch).toContain('AuditAction.CATEGORY_UPDATE');
  });

  /**
   * 负向对照：证明「必须经守卫」这个判据**有鉴别力**。
   *
   * 把 `adminGuardWrite(` 整体抹掉后，判据必须报告缺失 ——
   * 若判据实现成 `expect([]).toEqual([])` 之类的恒真式，这条会红。
   */
  it('负向对照：抹掉 adminGuardWrite 后判据必须失败', () => {
    const real = read(CATEGORY_ID_ROUTE);
    const damaged = real.replace(/adminGuardWrite\(/g, 'noopGuard(');

    expect(findHandlersWithoutGuard(real), '真实实现应通过').toEqual([]);
    expect(
      findHandlersWithoutGuard(damaged),
      '被破坏的实现必须被判据抓到（否则护栏没有鉴别力）',
    ).toContain('PATCH');

    // 同理验证「不得手写角色判断」判据：注入一行 role === 'admin' 必须被判出
    const withManualCheck = `${real}\nconst forbidden = user.role === 'admin';\n`;
    expect(findManualRoleChecks(real)).toEqual([]);
    expect(findManualRoleChecks(withManualCheck).length).toBeGreaterThan(0);
  });
});

describe('v0.0.14 · 权限矩阵必须只给 admin 分类管理权', () => {
  const P = 'src/lib/permissions.ts';

  it('Permission union 增加 categories.view / categories.manage', () => {
    const src = codeOnly(read(P));
    expect(src, '缺 categories.view（版主需要只读）').toMatch(/'\s*categories\.view'|'categories\.view'/);
    expect(src, '缺 categories.manage（仅 admin 可写）').toContain("'categories.manage'");
  });

  it('categories.view 允许 moderator + admin，categories.manage **只**允许 admin', () => {
    const src = read(P);
    const viewLine = /\s*'categories\.view':\s*\[([^\]]*)\]/.exec(src);
    const manageLine = /\s*'categories\.manage':\s*\[([^\]]*)\]/.exec(src);

    expect(viewLine, 'MATRIX 缺少 categories.view 一行').toBeTruthy();
    expect(manageLine, 'MATRIX 缺少 categories.manage 一行').toBeTruthy();

    const viewRoles = (viewLine?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const manageRoles = (manageLine?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

    expect(viewRoles.sort(), 'categories.view 应为 moderator + admin').toEqual(['admin', 'moderator']);
    expect(manageRoles, 'categories.manage 必须**只有** admin（版主不能下架一整组节点）').toEqual([
      'admin',
    ]);
  });

  it('audit.ts 增加四个分类 Action 与 category 目标类型', () => {
    const src = read('src/lib/audit.ts');
    for (const a of ['CATEGORY_CREATE', 'CATEGORY_UPDATE', 'CATEGORY_HIDE', 'CATEGORY_SHOW']) {
      expect(src, `审计 Action 缺少 ${a}`).toContain(`${a}:`);
    }
    expect(src, 'TargetType 必须包含 category').toMatch(/\|\s*'category'/);
  });
});

describe('v0.0.14 · 公共侧必须过滤已禁用分类', () => {
  it('node-service.listCategories 过滤 hidden，且不再查询不存在的 description 列', () => {
    const src = codeOnly(read('src/lib/node-service.ts'));
    expect(src, '公共分类列表必须过滤 hidden=false').toMatch(/WHERE\s+c\.hidden\s*=\s*false/);
    // v0.0.14 前该查询写了 c.description，而 categories 表没有该列 ⇒ 必然 500
    expect(
      src,
      'categories 表没有 description 列，查询它会让端点必然 500',
    ).not.toMatch(/c\.description/);
  });

  it('服务层导出 listPublicCategories，供公共页面统一取用', () => {
    const src = read('src/server/categories.ts');
    expect(src, '缺 listPublicCategories').toMatch(/export\s+async\s+function\s+listPublicCategories/);
    expect(src, '缺 listAllCategories（后台含禁用）').toMatch(
      /export\s+async\s+function\s+listAllCategories/,
    );
    // 并发去重必须靠 advisory lock（name 无唯一索引）
    expect(src, 'createCategory 必须在事务内取 advisory lock 串行化').toContain(
      'pg_advisory_xact_lock',
    );
  });
});

describe('v0.0.14 · 后台 UI 必须真的接上分类面板', () => {
  it('AdminConsole 有分类 tab，并按权限区分只读 / 可写', () => {
    const src = read('src/components/AdminConsole.tsx');
    expect(src, "TabKey 必须包含 'categories'").toMatch(/\|\s*'categories'/);
    expect(src, 'ALL_TABS 必须有分类 tab').toMatch(/key:\s*'categories',\s*label:\s*'分类'/);
    expect(src, '必须接收 canManageCategories（categories.manage）').toContain(
      'canManageCategories',
    );
    // 写操作必须走已有的 csrfFetch 机制（不得发明新机制）
    expect(src, '分类写操作必须复用 act() → csrfFetch').toContain('csrfFetch');
    expect(src, '不得引入新的 HTTP 客户端封装').not.toMatch(/axios|fetch\s*=\s*new/);
  });

  it('节点管理走的是既有 /api/nodes，不是自造的端点', () => {
    const src = read('src/components/AdminConsole.tsx');
    expect(src, '分类列表走 GET /api/admin/categories').toContain("fetch('/api/admin/categories')");
    expect(src, '分类写操作走 /api/admin/categories').toContain("'/api/admin/categories'");
  });

  it('管理后台页面把 canManageCategories 按 isAdmin 传入（服务端判定）', () => {
    const page = read('src/app/admin/page.tsx');
    expect(page).toContain('canManageCategories={isAdmin(user)}');
  });
});

describe('v0.0.14 · 仓库卫生（分类模块不得被复制成多份实现）', () => {
  it('`categories` 表的写操作只允许出现在服务层单点', () => {
    const dir = path.join(ROOT, 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(dir);

    const writers = files.filter((f) =>
      /(insert|update|delete)\(schema\.categories\)/.test(readFileSync(f, 'utf8')),
    );
    const rel = writers.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    expect(rel, `写入 categories 的位置必须唯一，实际：${rel.join(', ')}`).toEqual([
      'src/server/categories.ts',
    ]);
  });

  it('服务层的 CategoryWithCount 聚合只扫一次（不做 N+1）', () => {
    const src = codeOnly(read('src/server/categories.ts'));
    // 一次 WITH ... LEFT JOIN 聚合，而不是每个分类一次 count 查询
    expect(src, 'listAllCategories 必须用单次聚合查询').toMatch(/LEFT JOIN nc/);
    // 全文件只允许出现一次 count(*) —— 出现两次以上通常是"列表里再循环查 count"
    const countCalls = src.match(/count\(\*\)/g) ?? [];
    expect(
      countCalls.length,
      `categories.ts 里 count(*) 出现 ${countCalls.length} 次，应只有 1 次（一次聚合，不做逐分类 count）`,
    ).toBe(1);
  });
});
