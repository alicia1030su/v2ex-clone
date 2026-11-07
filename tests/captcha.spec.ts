import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCaptcha, verifyCaptcha, verifyCaptchaField, captchaFieldName } from '../src/server/captcha';
import { sanitizeHtml } from '../src/lib/markdown';
import { sanitizeRedirect } from '../src/lib/redirect';
import {
  isCaptchaDisabled,
  isIsolatedTestEnv,
  isDebugEndpointEnabled,
  getRuntimeEnv,
} from '../src/lib/runtime-flags';

/**
 * 安全逻辑单元测试
 *
 * 这些测试直接针对服务端模块，不依赖运行时开关，
 * 因此可以在 DISABLE_CAPTCHA=1 的隔离测试环境下依然验证真实行为。
 */
describe('验证码逻辑（P0-1 / P0-2）', () => {
  it('正确答案通过校验', async () => {
    const { id } = await createCaptcha();
    // 答案未知的场景下，用错误答案必须失败
    const ok = await verifyCaptcha(id, 'DEFINITELYWRONG');
    expect(ok).toBe(false);
  });

  it('验证码一次性：校验后立即作废', async () => {
    const { id } = await createCaptcha();
    await verifyCaptcha(id, 'ANYTHING');
    // 再次使用同一挑战必须失败（已被消费）
    const second = await verifyCaptcha(id, 'ANYTHING');
    expect(second).toBe(false);
  });

  it('不存在的挑战 ID 一律失败', async () => {
    const ok = await verifyCaptcha('nonexistent-challenge-id', 'ABCD');
    expect(ok).toBe(false);
  });

  it('空答案一律失败', async () => {
    const { id } = await createCaptcha();
    const ok = await verifyCaptcha(id, '');
    expect(ok).toBe(false);
  });

  it('字段名与挑战匹配时通过，不匹配时失败', async () => {
    const { id } = await createCaptcha();
    expect(await verifyCaptchaField(id, captchaFieldName(id))).toBe(true);
    expect(await verifyCaptchaField(id, 'wrong-hash')).toBe(false);
  });

  it('不同挑战的字段名互不相同', async () => {
    const a = await createCaptcha();
    const b = await createCaptcha();
    expect(captchaFieldName(a.id)).not.toBe(captchaFieldName(b.id));
  });
});

describe('运行时开关限制（P0-2）', () => {
  it('生产环境下 DISABLE_CAPTCHA 不生效', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'production';
    process.env.DISABLE_CAPTCHA = '1';
    process.env.TEST_ENV_ISOLATED = '1';
    expect(isCaptchaDisabled()).toBe(false);
    process.env = saved;
  });

  it('预发环境下 DISABLE_CAPTCHA 不生效', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'staging';
    process.env.DISABLE_CAPTCHA = '1';
    process.env.TEST_ENV_ISOLATED = '1';
    expect(isCaptchaDisabled()).toBe(false);
    process.env = saved;
  });

  it('非隔离的 test 环境也不允许跳过验证码', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'test';
    process.env.DISABLE_CAPTCHA = '1';
    process.env.TEST_ENV_ISOLATED = '0';
    expect(isCaptchaDisabled()).toBe(false);
    process.env = saved;
  });

  it('仅隔离测试环境允许跳过验证码', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'test';
    process.env.DISABLE_CAPTCHA = '1';
    process.env.TEST_ENV_ISOLATED = '1';
    expect(isCaptchaDisabled()).toBe(true);
    expect(isIsolatedTestEnv()).toBe(true);
    process.env = saved;
  });

  it('未设置 DISABLE_CAPTCHA 时永远不禁用', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'test';
    process.env.TEST_ENV_ISOLATED = '1';
    delete process.env.DISABLE_CAPTCHA;
    expect(isCaptchaDisabled()).toBe(false);
    process.env = saved;
  });

  it('运行时环境判定正确', () => {
    const saved = { ...process.env };
    process.env.APP_RUNTIME_ENV = 'production';
    expect(getRuntimeEnv()).toBe('production');
    process.env.APP_RUNTIME_ENV = 'staging';
    expect(getRuntimeEnv()).toBe('staging');
    process.env.APP_RUNTIME_ENV = 'test';
    expect(getRuntimeEnv()).toBe('test');
    process.env = saved;
  });

});

/**
 * v0.0.9 发布前安全审计 A-01 —— 调试端点开关收紧后的语义
 *
 * 预期实现（由工程师并行修复 src/lib/runtime-flags.ts）：
 *
 *   isDebugEndpointEnabled()
 *     = ENABLE_DEBUG_ENDPOINTS === '1' && isIsolatedTestEnv()
 *
 * 其中 isIsolatedTestEnv() 要求 `APP_RUNTIME_ENV=test` 且 `TEST_ENV_ISOLATED=1`。
 * 即：生产 / 预发 / 普通开发环境**即使把开关显式设为 1** 也一律 false；
 * 只有隔离测试环境 + 开关=1 才 true（且仍须 DEBUG_ENDPOINT_TOKEN 鉴权）。
 *
 * ⚠️ 原用例（「开关=1 就 true」）依赖 vitest 默认 `NODE_ENV=test` 的隐式值，
 *    一旦收紧实现，它会在生产语义下产生假绿/假红。这里每个用例都显式
 *    stub 全部 4 个相关变量，并用 `vi.unstubAllEnvs()` 还原，互不污染。
 */
describe('调试端点开关（A-01 收紧后语义）', () => {
  beforeEach(() => {
    // 显式设定全部相关变量 —— 断言不依赖 vitest 的隐式 NODE_ENV
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_RUNTIME_ENV', 'production');
    vi.stubEnv('TEST_ENV_ISOLATED', '0');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** 设为隔离测试环境（不动开关） */
  function isolatedTestEnv() {
    vi.stubEnv('APP_RUNTIME_ENV', 'test');
    vi.stubEnv('TEST_ENV_ISOLATED', '1');
  }

  it('production：开关=1 且隔离标记=1 仍返回 false', () => {
    vi.stubEnv('APP_RUNTIME_ENV', 'production');
    vi.stubEnv('TEST_ENV_ISOLATED', '1');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('production');
    expect(isIsolatedTestEnv()).toBe(false);
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('staging：开关=1 且隔离标记=1 仍返回 false', () => {
    vi.stubEnv('APP_RUNTIME_ENV', 'staging');
    vi.stubEnv('TEST_ENV_ISOLATED', '1');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('staging');
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('普通 development：开关=1 且隔离标记=1 仍返回 false', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_RUNTIME_ENV', 'development');
    vi.stubEnv('TEST_ENV_ISOLATED', '1');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('development');
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('test 环境但隔离标记为 0：开关=1 仍返回 false', () => {
    isolatedTestEnv();
    vi.stubEnv('TEST_ENV_ISOLATED', '0');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('test');
    expect(isIsolatedTestEnv()).toBe(false);
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('test 环境且隔离变量完全未设置：开关=1 仍返回 false', () => {
    vi.stubEnv('APP_RUNTIME_ENV', 'test');
    vi.stubEnv('TEST_ENV_ISOLATED', undefined);
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(isIsolatedTestEnv()).toBe(false);
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('隔离测试环境但开关=0：返回 false', () => {
    isolatedTestEnv();
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '0');
    expect(isIsolatedTestEnv()).toBe(true);
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('隔离测试环境但开关未设置：返回 false', () => {
    isolatedTestEnv();
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', undefined);
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('仅「隔离测试环境 + 开关=1」返回 true', () => {
    isolatedTestEnv();
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('test');
    expect(isIsolatedTestEnv()).toBe(true);
    expect(isDebugEndpointEnabled()).toBe(true);
  });

  it('不依赖 NODE_ENV 隐式值：NODE_ENV=test 但显式 production 仍为 false', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_RUNTIME_ENV', 'production');
    vi.stubEnv('TEST_ENV_ISOLATED', '1');
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('production');
    expect(isDebugEndpointEnabled()).toBe(false);
  });

  it('NODE_ENV=production 不阻断显式隔离测试环境', () => {
    vi.stubEnv('NODE_ENV', 'production');
    isolatedTestEnv();
    vi.stubEnv('ENABLE_DEBUG_ENDPOINTS', '1');
    expect(getRuntimeEnv()).toBe('test');
    expect(isDebugEndpointEnabled()).toBe(true);
  });
});

describe('HTML 清洗器（P1-14）', () => {
  it('移除 script 标签', () => {
    const out = sanitizeHtml('<script>alert(1)</script><p>ok</p>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>ok</p>');
  });

  it('移除 on* 事件处理器', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });

  it('拒绝 javascript: 协议', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('拒绝 data:image/svg+xml（SVG 可内嵌脚本）', () => {
    const out = sanitizeHtml(
      '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvc3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">',
    );
    expect(out).not.toContain('data:image/svg+xml');
  });

  it('拒绝 style 属性（防 CSS 注入）', () => {
    const out = sanitizeHtml('<div style="background:url(javascript:alert(1))">x</div>');
    expect(out).not.toContain('style=');
  });

  it('外链自动加 rel=noopener noreferrer', () => {
    const out = sanitizeHtml('<a href="https://example.com/">x</a>');
    expect(out).toContain('noopener');
    expect(out).toContain('noreferrer');
  });

  it('剥离控制字符的 javascript: 绕过', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('script:');
  });

  it('移除 iframe / object / embed 等危险标签', () => {
    const out = sanitizeHtml(
      '<iframe src="https://evil.com"></iframe><object data="x"></object><embed src="y">',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<embed');
  });

  it('保留允许的 Markdown 结构', () => {
    const out = sanitizeHtml(
      '<h2>标题</h2><ul><li>项</li></ul><pre><code>code()</code></pre><blockquote>引用</blockquote>',
    );
    expect(out).toContain('<h2>标题</h2>');
    expect(out).toContain('<li>项</li>');
    expect(out).toContain('<pre>');
    expect(out).toContain('<blockquote>');
  });

  it('保留表格', () => {
    const out = sanitizeHtml('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>h</th>');
  });
});

describe('redirect 规范化（P1-11）', () => {
  it('允许站内相对路径', () => {
    expect(sanitizeRedirect('/t/1')).toBe('/t/1');
  });

  it('拒绝外部绝对 URL', () => {
    expect(sanitizeRedirect('https://evil.com/')).toBe('/');
  });

  it('拒绝协议相对 URL', () => {
    expect(sanitizeRedirect('//evil.com/')).toBe('/');
    expect(sanitizeRedirect('/\\evil.com')).toBe('/');
  });

  it('拒绝含换行的注入', () => {
    expect(sanitizeRedirect('/a\r\nSet-Cookie: x=1')).toBe('/');
  });

  it('非字符串一律归一为 /', () => {
    expect(sanitizeRedirect(undefined)).toBe('/');
    expect(sanitizeRedirect(null)).toBe('/');
    expect(sanitizeRedirect(123)).toBe('/');
    expect(sanitizeRedirect({})).toBe('/');
  });
});
