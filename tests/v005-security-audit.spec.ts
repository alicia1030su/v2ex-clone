import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.5 安全审计 —— **静态属性断言**
 *
 * ## 为什么用静态断言
 *
 * 任务书 §十一 要求复核 16 类安全风险。动态测试（真的打 SQL 注入、真的试提权）
 * 有两个问题：
 *  1. **无法覆盖「不存在」的路径** —— 比如「这个端点有没有限流」，
 *     静态扫一眼源码就有答案，动态测则要构造 N 个请求
 *  2. **动态攻击测试本身有风险** —— 在 CI 里真的打 SQL 注入，
 *     万一代码有洞，测试环境的数据就脏了
 *
 * 所以这里用**静态断言**把安全属性固化成**可执行的契约**：
 *  - 新增一个写端点却忘了加限流 ⇒ **本测试立刻红**
 *  - 有人删掉了某个端点的 `guardCsrf` ⇒ **本测试立刻红**
 *  - 有人把 `role` 写入点挪到用户可触达的路由 ⇒ **本测试立刻红**
 *
 * 这就是「把安全要求变成回归护栏」——比一次性的人工审计更有价值。
 *
 * ## 边界
 *
 * 静态断言**不能替代**动态验证。它只能保证「某个防护没被删掉」，
 * 不能保证「防护真的有效」。后者由各端点自己的 E2E / 单元测试负责。
 */

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');

/** 递归列出所有 route.ts */
function listRouteFiles(dir: string = API_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out.sort();
}

/** 读文件 */
function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 相对路径（用于报错信息） */
function rel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

/**
 * 提取某个导出函数的函数体。
 *
 * ⚠️ 参数部分可能跨行且含**嵌套括号**（如 `Promise<{ id: string }>`），
 * 所以必须**括号配平**地跳过参数，再从函数体的 `{` 开始按大括号配平。
 */
function functionBody(src: string, name: string): string | null {
  const m = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;

  // ① 跳过参数：从 "(" 开始做括号配平
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

  // ② 找到函数体的 "{"
  const brace = src.indexOf('{', i);
  if (brace < 0) return null;

  // ③ 大括号配平
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

/** 取出所有导出函数的「方法名 → 函数体」 */
function exportedHandlers(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g)) {
    const body = functionBody(src, m[1]);
    if (body) out[m[1]] = body;
  }
  return out;
}

const ROUTES = listRouteFiles();

describe('v0.0.5 安全 · 写端点的 CSRF 与限流覆盖', () => {
  /**
   * 免限流 + 免 CSRF 的端点 —— 每个都要写明理由。
   *
   * `debug/*` 的豁免理由（三条同时成立才豁免）：
   *  1. **令牌鉴权而非 cookie 鉴权** —— `checkDebugAccess(request)` 要求
   *     `ENABLE_DEBUG_ENDPOINTS=1` + `DEBUG_ENDPOINT_TOKEN`，
   *     攻击者拿不到令牌 ⇒ CSRF 双提交保护对它**没有意义**
   *     （CSRF 防护的前提是「浏览器会自动带上 cookie」）
   *  2. **只影响测试环境的限流桶** —— 不构成生产滥用面
   *  3. **「清空限流」端点加限流在语义上自相矛盾** ——
   *     清空之后计数归零，限流随即失效 ⇒ 限流形同虚设
   *
   * 对应地，这两个端点**必须**有 `checkDebugAccess` —— 由下面的
   * 「调试端点需要令牌」用例守护。
   */
  const EXEMPT = new Set<string>([
    'src/app/api/debug/rate-limit-probe/route.ts',
    'src/app/api/debug/reset-rate-limits/route.ts',
  ]);

  it('所有写端点都有 CSRF 校验', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      if (EXEMPT.has(rel(file))) continue;
      const src = read(file);
      for (const [method, body] of Object.entries(exportedHandlers(src))) {
        if (method === 'GET') continue;
        // adminGuardWrite 内部已含 guardCsrf —— 算通过
        if (body.includes('guardCsrf') || body.includes('adminGuardWrite')) continue;
        offenders.push(`${rel(file)} ${method}`);
      }
    }
    expect(
      offenders,
      `这些写端点缺少 CSRF 校验：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('所有写端点都有频率限制', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const r = rel(file);
      if (EXEMPT.has(r)) continue;
      const src = read(file);
      for (const [method, body] of Object.entries(exportedHandlers(src))) {
        if (method === 'GET') continue;
        const hasLimit =
          body.includes('rateLimit') || body.includes('guardCommunityAction');
        if (!hasLimit) offenders.push(`${r} ${method}`);
      }
    }
    expect(
      offenders,
      `这些写端点缺少频率限制：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('admin 写端点也有限流（防管理员会话被盗后批量滥用）', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      if (!rel(file).includes('/api/admin/')) continue;
      const src = read(file);
      for (const [method, body] of Object.entries(exportedHandlers(src))) {
        if (method === 'GET') continue;
        if (!body.includes('guardCommunityAction')) {
          offenders.push(`${rel(file)} ${method}`);
        }
      }
    }
    expect(
      offenders,
      `这些 admin 写端点缺少限流：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('v0.0.5 安全 · 权限提升', () => {
  it('users.role 字段只写在 admin 路由里', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const r = rel(file);
      if (r.includes('/api/admin/')) continue;
      // 注册路由例外：注册时 role **恒为 'user'**（服务端写死），
      // 用户无法通过请求体影响它 —— 这不是提权路径。
      if (r.endsWith('/api/auth/signup/route.ts')) continue;
      const src = read(file);
      // 匹配 `set({ role: ... })` 或 `values({ role: ... })` 这类写入
      if (/\.set\(\s*\{[^}]*\brole\s*:/.test(src)) offenders.push(r);
      if (/values\(\s*\{[^}]*\brole\s*:/.test(src)) offenders.push(r);
    }
    expect(
      offenders,
      `非 admin 路由不应写入 users.role：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('所有 admin 路由都经过 adminGuard / adminGuardWrite', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      if (!rel(file).includes('/api/admin/')) continue;
      const src = read(file);
      for (const [method, body] of Object.entries(exportedHandlers(src))) {
        if (!body.includes('adminGuard')) offenders.push(`${rel(file)} ${method}`);
      }
    }
    expect(
      offenders,
      `这些 admin 端点缺少 adminGuard：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('v0.0.5 安全 · 注入', () => {
  it('没有 sql.raw（未经参数化的 SQL 拼接）', () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const src = read(file);
      if (src.includes('sql.raw(')) offenders.push(rel(file));
    }
    for (const file of ROUTES) {
      const src = read(file);
      // `sql(` 模板里插 `${}` 是**参数化**（postgres.js 会转成 $1），允许
    }
    expect(offenders, `这些文件用了 sql.raw：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SQL 模板里的插值只用于参数（不是字符串拼接）', () => {
    // postgres.js 的模板会把 `${value}` 转成占位符 ⇒ 安全。
    // 危险写法是 `sql` 标签里做字符串操作（如 `${a + b}`、`${x.replace()}`）。
    const offenders: string[] = [];
    const srcFiles = [
      ...ROUTES,
      path.join(ROOT, 'src', 'lib', 'credit-service.ts'),
      path.join(ROOT, 'src', 'lib', 'content-service.ts'),
    ];
    for (const file of srcFiles) {
      if (!file.endsWith('.ts')) continue;
      const src = read(file);
      // 找出 `${...}` 内部含有函数调用或运算符的（可疑）
      for (const m of src.matchAll(/sql`([^`]*)`/g)) {
        const body = m[1];
        for (const im of body.matchAll(/\$\{([^}]*)\}/g)) {
          const expr = im[1].trim();
          if (/[+*/]|\.\w+\(|replace\(|concat\(|`|toUpperCase|toLowerCase/.test(expr)) {
            offenders.push(`${rel(file)}: \${${expr}}`);
          }
        }
      }
    }
    expect(
      offenders,
      `这些 SQL 插值疑似字符串拼接：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('v0.0.5 安全 · 输出编码', () => {
  it('Markdown 渲染经过 sanitize-html 清洗', () => {
    const md = read(path.join(ROOT, 'src', 'lib', 'markdown.ts'));
    expect(md).toContain('sanitize-html');
    expect(md).toContain('sanitizeHtmlLib');
  });

  it('sanitize 配置禁用了 javascript: 协议与事件属性', () => {
    const md = read(path.join(ROOT, 'src', 'lib', 'markdown.ts'));
    // 事件属性（on*）必须被禁
    expect(md).toMatch(/allowedAttributes/);
    // 必须有协议白名单或显式禁用 javascript:
    expect(md).toMatch(/allowedSchemes|javascript:/);
  });
});

describe('v0.0.5 安全 · 会话与口令', () => {
  it('会话 Cookie 设置了 HttpOnly / SameSite / Path', () => {
    const auth = read(path.join(ROOT, 'src', 'lib', 'auth.ts'));
    const setCookie = /store\.set\(SESSION_COOKIE[\s\S]{0,400}?\);/.exec(auth)?.[0] ?? '';
    expect(setCookie).toContain('httpOnly: true');
    expect(setCookie).toMatch(/sameSite:\s*'lax'/);
    expect(setCookie).toMatch(/path:\s*'\/'/);
    // ⚠️ v0.0.5：`secure` 的判定已从「按 NODE_ENV」改为「按**实际请求协议**」。
    //
    // 原因（v0.0.5 跨浏览器实测发现）：`next start`（**任何**部署方式，
    // 含本地 HTTP 调试与非 HTTPS 部署）都会设 `NODE_ENV=production`
    // ⇒ 旧判定会让 Cookie 带 `Secure`。
    // **WebKit 在 HTTP 下直接拒绝存储带 Secure 的 Cookie**
    // （Chromium / Firefox 对 localhost 有放宽）⇒ 所有写操作 403。
    //
    // 新判定优先级：`x-forwarded-proto` → `APP_URL`/`NEXT_PUBLIC_APP_URL`
    // /`PUBLIC_BASE_URL` 是否 https → 否则视为 HTTP。
    expect(setCookie).toMatch(/secure:\s*isHttpsRequest\(\)/);
    // 判定函数本身必须真的看协议，而不是又退回 NODE_ENV
    expect(auth).toContain('function isHttpsRequest');
    expect(auth).toMatch(/forwarded-proto|x-forwarded-proto/);
    expect(auth).toMatch(/startsWith\('https:\/\/'\)/);
  });

  it('口令用 scrypt 且带随机盐', () => {
    const pwd = read(path.join(ROOT, 'src', 'lib', 'password.ts'));
    expect(pwd).toContain('scryptSync');
    expect(pwd).toContain('randomBytes(16)');
    // 比较必须用 timingSafeEqual（防时序侧信道）
    expect(pwd).toContain('timingSafeEqual');
  });

  it('改密后旧会话被销毁', () => {
    const reset = read(
      path.join(ROOT, 'src', 'app', 'api', 'auth', 'reset-password', 'route.ts'),
    );
    expect(reset).toContain('delete(schema.sessions)');
  });
});

describe('v0.0.5 安全 · 文件上传', () => {
  it('头像按 magic number 判定格式（不信 MIME 声明）', () => {
    const avatar = read(path.join(ROOT, 'src', 'lib', 'avatar.ts'));
    expect(avatar).toContain('detectImageFormat');
    // 不得用客户端声明的 content-type 作为唯一判据
    expect(avatar).not.toMatch(/content-type['"]\s*\)?\s*(===|==)\s*['"]image\//i);
  });

  it('头像有大小上限与图片炸弹防护', () => {
    const avatar = read(path.join(ROOT, 'src', 'lib', 'avatar.ts'));
    expect(avatar).toContain('MAX_AVATAR_BYTES');
    expect(avatar).toContain('limitInputPixels');
  });

  it('头像存储路径由服务端生成且做越界检查', () => {
    const avatar = read(path.join(ROOT, 'src', 'lib', 'avatar.ts'));
    expect(avatar).toContain('buildStoragePath');
    expect(avatar).toContain('resolveStoragePath');
    // 独占创建（不覆盖已有文件）
    expect(avatar).toContain("flag: 'wx'");
  });

  it('上传目录路由拒绝非法路径与非法扩展名', () => {
    const route = read(
      path.join(ROOT, 'src', 'app', 'uploads', '[...path]', 'route.ts'),
    );
    expect(route).toContain('resolveStoragePath');
    expect(route).toContain('nosniff');
  });
});

describe('v0.0.5 安全 · 运行环境隔离', () => {
  it('验证码绕过只在隔离测试环境生效', () => {
    const flags = read(path.join(ROOT, 'src', 'lib', 'runtime-flags.ts'));
    const fn = /export function isCaptchaDisabled\(\)[\s\S]{0,300}?\}/.exec(flags)?.[0] ?? '';
    expect(fn).toContain('isIsolatedTestEnv');
    expect(fn).toContain('DISABLE_CAPTCHA');
  });

  it('真实 SMTP 开关只在隔离测试环境生效', () => {
    const flags = read(path.join(ROOT, 'src', 'lib', 'runtime-flags.ts'));
    const fn =
      /export function isRealSmtpAllowedInTest\(\)[\s\S]{0,300}?\}/.exec(flags)?.[0] ?? '';
    expect(fn).toContain('isIsolatedTestEnv');
    expect(fn).toContain('SMTP_ALLOW_REAL_IN_TEST');
  });

  it('调试端点需要令牌', () => {
    const flags = read(path.join(ROOT, 'src', 'lib', 'runtime-flags.ts'));
    expect(flags).toContain('getDebugToken');
    const route = read(
      path.join(ROOT, 'src', 'app', 'api', 'debug', 'reset-rate-limits', 'route.ts'),
    );
    expect(route).toMatch(/getDebugToken|x-debug-token/i);
  });
});

describe('v0.0.5 安全 · 审计日志', () => {
  it('敏感操作都有对应的审计 Action', () => {
    const audit = read(path.join(ROOT, 'src', 'lib', 'audit.ts'));
    const required = [
      'TOPIC_EDIT',
      'TOPIC_DELETE',
      'TOPIC_RESTORE',
      'TOPIC_LOCK',
      'TOPIC_UNLOCK',
      'TOPIC_PIN',
      'TOPIC_UNPIN',
      'REPLY_EDIT',
      'REPLY_DELETE',
      'REPLY_RESTORE',
      'USER_BAN',
      'USER_UNBAN',
      'USER_ROLE_CHANGE',
      'USER_CREDITS_ADJUST',
      'REPORT_SUBMIT',
      'REPORT_HANDLE',
      'NODE_REQUEST_APPROVE',
      'NODE_REQUEST_REJECT',
    ];
    const missing = required.filter((a) => !audit.includes(a));
    expect(missing, `缺少审计 Action：${missing.join(', ')}`).toEqual([]);
  });

  it('审计 Action 都被真正使用（不是只定义不调用）', () => {
    const audit = read(path.join(ROOT, 'src', 'lib', 'audit.ts'));
    const defined = [...audit.matchAll(/^\s{2}([A-Z_]+):\s*'/gm)].map((m) => m[1]);
    const unused: string[] = [];
    for (const action of defined) {
      let used = false;
      for (const file of ROUTES) {
        if (read(file).includes(`AuditAction.${action}`)) {
          used = true;
          break;
        }
      }
      // lib 内部也可能有调用
      if (!used) {
        const libDir = path.join(ROOT, 'src', 'lib');
        for (const f of readdirSync(libDir)) {
          if (!f.endsWith('.ts')) continue;
          if (read(path.join(libDir, f)).includes(`AuditAction.${action}`)) {
            used = true;
            break;
          }
        }
      }
      if (!used) unused.push(action);
    }
    expect(
      unused,
      `这些审计 Action 定义了但从未被调用：\n${unused.join('\n')}`,
    ).toEqual([]);
  });
});
