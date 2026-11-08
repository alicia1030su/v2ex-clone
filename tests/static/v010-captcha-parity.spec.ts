import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.13（V10-25）：**验证码渲染口径一致性**护栏
 *
 * ## 事故（CI 实测，run 42499586462，firefox/375x812）
 *
 * 「收藏主题后出现在收藏页」用例在 `login()` 的 `waitForURL` 上挂满 30s。
 * 失败截图显示：表单已填好、按钮**未进 pending 态**、无任何错误提示，
 * 但页面上**有验证码** —— 而 CI 明确设置了 `DISABLE_CAPTCHA=1` +
 * `APP_RUNTIME_ENV=test` + `TEST_ENV_ISOLATED=1`，服务端根本不校验验证码。
 *
 * 根因：`SignInForm` 在 `useEffect` 里**无条件** `fetch('/api/captcha')`。
 * 服务端 `isCaptchaDisabled()` 为真 ⇒ SSR **不渲染**验证码；
 * 客户端水合后又把验证码**插了进来** ⇒ 表单在两行之间多出一行，
 * 高度在「Playwright 可操作性检查」与「实际派发鼠标事件」之间发生变化
 * ⇒ 点击落到别处 ⇒ 提交从未发生。
 *
 * 这是**产品缺陷**（不只是测试问题）：用户看到验证码框，而服务端不校验。
 *
 * ## 本护栏守什么
 *
 * ① `SignInForm` 必须接受 `captchaRequired` 开关，且**所有** `loadCaptcha()`
 *    调用点都在它有条件保护之下（不得有任何一处无条件拉取）
 * ② 登录页必须把 `!isCaptchaDisabled()` 传下去（两端口径同源）
 * ③ 服务端 signin 路由必须**仍然**在 `!isCaptchaDisabled()` 时强制校验
 *    （防止有人「为了修测试」把服务端校验删掉 —— 那才是真事故）
 */

const ROOT = path.resolve(__dirname, '..', '..');
const FORM = readFileSync(path.join(ROOT, 'src', 'components', 'SignInForm.tsx'), 'utf8');
const PAGE = readFileSync(path.join(ROOT, 'src', 'app', 'signin', 'page.tsx'), 'utf8');
const API = readFileSync(
  path.join(ROOT, 'src', 'app', 'api', 'auth', 'signin', 'route.ts'),
  'utf8',
);

/** 去掉注释行，只扫可执行代码（注释里正着引用反模式不算违规） */
function codeOnly(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join('\n');
}

describe('验证码渲染口径一致性（V10-25）', () => {
  it('SignInForm 必须声明 captchaRequired 开关', () => {
    expect(FORM).toContain('captchaRequired');
    // 默认值必须是 true —— 生产/预发没有页面传参时仍然要验证码
    expect(FORM).toMatch(/captchaRequired\s*=\s*true/);
  });

  it('所有 loadCaptcha() 调用点都在 captchaRequired 保护之下（不得无条件拉取）', () => {
    const code = codeOnly(FORM);
    // 收集每个调用点所在行
    const lines = code.split('\n');
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      // 只看「实际调用」，跳过函数定义与 useCallback 依赖
      if (!/loadCaptcha\(\)/.test(line)) return;
      if (/const loadCaptcha|useCallback/.test(line)) return;
      // 上下文 3 行内必须出现 captchaRequired 守卫
      const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!window.includes('captchaRequired')) offenders.push(`L${i + 1}: ${line.trim()}`);
    });
    expect(
      offenders,
      `以下 loadCaptcha() 调用没有 captchaRequired 守卫（会在服务端已禁用时又插出验证码行）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('登录页把服务端判定传下去（两端口径同源）', () => {
    expect(PAGE).toContain('isCaptchaDisabled');
    expect(PAGE).toMatch(/captchaRequired=\{!captchaDisabled\}/);
  });

  it('服务端 signin 路由仍强制校验验证码（不得为了修测试而删）', () => {
    expect(API).toContain('isCaptchaDisabled');
    expect(API).toContain('verifyCaptcha');
    expect(API).toMatch(/if\s*\(\s*!isCaptchaDisabled\(\)\s*\)/);
  });
});
