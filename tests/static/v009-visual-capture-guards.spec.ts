import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.9：截图工具的**假成功机制**护栏
 *
 * ## 事故（2026-11-08 人工发现）
 *
 * README 首页截图 `local-home.png` 完全没有 CSS：默认蓝色下划线链接、
 * 内容堆在左上角、双栏消失、白卡消失。
 * 而当时视觉回归是「63/63 全绿」。
 *
 * 三个工具层缺陷：
 *   ① `--proxy-server` 施加在整只浏览器上，本地 `localhost` 的
 *      `/_next/static/*` 也被送进代理；
 *   ② `waitForLoadState(...).catch(() => {})` 把失败吞掉后照截图、照报成功；
 *   ③ 从不检查 CSS 是否真的加载、布局是否真的是双栏。
 *
 * ## 本护栏断言什么
 *
 * 静态断言（不需要浏览器）：
 *   ① 三张截图/测量工具都必须调用页面健康门禁 `loadAndVerify`；
 *   ② 不得出现「swallow 之后照常成功」的 `.catch(() => {})` 等待模式；
 *   ③ 不允许把 `--proxy-server` 无条件塞进浏览器启动参数；
 *   ④ 代理若存在，必须同时给出 bypass（本机地址不得走代理）；
 *   ⑤ 保存截图必须受门禁结果约束（`result.ok` 分支）。
 *
 * ⚠️ 这是**补充**而不是替代：真正的行为验证由
 *    `tools/visual/negative-tests.mjs`（需要真实站点在跑）与
 *    `scripts/ci` 里的健康门禁步骤完成。
 *    静态护栏的价值在于：有人「优化」工具时，不会把这些约束悄悄删掉。
 */

const ROOT = path.resolve(__dirname, '..', '..');

const TOOLS = [
  { file: 'tools/visual/capture.mjs', purpose: '单视口截图' },
  { file: 'tools/visual/capture-multi.mjs', purpose: '多视口截图（README 图片来源）' },
  { file: 'tools/visual/measure.mjs', purpose: '布局测量' },
];

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 只保留「代码行」，剔除注释行。
 *
 * 这些工具文件的文件头注释里**引用了旧实现的坏写法**（作为反面教材），
 * 直接对全文做正则会把注释也当代码判红 —— 那就变成「谁写注释谁倒霉」。
 * 判据应当针对**实际执行的代码**，因此这里先按行剔除：
 *   - 以 `//` 开头的行
 *   - 以 `*` 或 `/*` 开头的行（块注释体）
 * 这样不会误伤字符串里的 `http://`（那种行不是以 `//` 开头）。
 */
function readCode(rel: string): string {
  return read(rel)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

describe('截图工具：必须走页面健康门禁', () => {
  for (const { file, purpose } of TOOLS) {
    it(`${purpose}（${file}）调用 loadAndVerify`, () => {
      const src = read(file);
      expect(src).toContain("from './lib/page-health.mjs'");
      expect(src).toContain('loadAndVerify');
    });

    it(`${purpose}（${file}）不再吞掉等待失败`, () => {
      const src = readCode(file);
      // 旧实现的特征写法：等待失败后 `.catch(() => {})` 静默继续
      expect(src).not.toMatch(/waitForLoadState\([^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
      expect(src).not.toMatch(/waitForLoadState\([^)]*\)\.catch\(\(\)\s*=>\s*\{\}\)/);
    });

    it(`${purpose}（${file}）不无条件注入代理`, () => {
      const src = read(file);
      // 允许出现 --proxy-server，但必须伴随 bypass 声明；
      // 否则 localhost 的静态资源会被送进代理 ⇒ 无样式截图。
      if (src.includes('--proxy-server')) {
        expect(src).toContain('bypass');
      }
    });
  }

  it('截图落盘受门禁结果约束（ok 才写正式路径）', () => {
    const multi = read('tools/visual/capture-multi.mjs');
    // 必须存在「门禁通过才截图到正式路径」的分支。
    //
    // ⚠️ 不要写死变量名。v0.0.9 时是 `locPage` / `page`；v0.0.10 为了给
    //    登录/注册页用**未登录**上下文，引入了 `target`（按页面切换 context）。
    //    写死 `*[Pp]age` 会让这条护栏在**代码仍然正确**的情况下变红 ——
    //    护栏要守的是「screenshot 必须发生在 result.ok 分支内」，
    //    而不是变量叫什么名字。因此匹配任意标识符的 .screenshot 调用。
    expect(multi).toMatch(/if\s*\(\s*result\.ok\s*\)\s*\{[\s\S]*?[A-Za-z_$][\w$]*\.screenshot/);
    // 且失败分支必须写诊断图而不是正式图
    expect(multi).toMatch(/else\s*\{[\s\S]*?INVALID\.png/);
  });

  it('多视口工具在门禁失败时以非零码退出', () => {
    const multi = read('tools/visual/capture-multi.mjs');
    expect(multi).toMatch(/if\s*\(\s*invalid\s*>\s*0\s*\)\s*\{[\s\S]*?process\.exit\(1\)/);
  });

  it('基线更新必须提供人工审查凭据', () => {
    const reg = read('tools/visual/regression.mjs');
    expect(reg).toContain('VISUAL_BASELINE_APPROVE');
    // 没有凭据时必须拒绝（退出码 2），不能静默写基线
    expect(reg).toMatch(/process\.exit\(2\)/);
  });
});

describe('页面健康门禁：判据本身不得被削弱', () => {
  const health = read('tools/visual/lib/page-health.mjs');

  it('把「无默认蓝链接」作为 CSS 生效的硬判据', () => {
    // 浏览器默认链接色 #0000EE 出现 ⇒ 说明样式表没生效
    expect(health).toContain('uaLinkColor');
    expect(health).toContain('design.noUaLinks');
  });

  it('断言 #Wrapper 灰底、.box 白卡与桌面双栏', () => {
    expect(health).toContain('design.wrapperBg');
    expect(health).toContain('design.boxCard');
    expect(health).toContain('design.twoColumn');
  });

  it('断言静态资源与样式表解析结果', () => {
    expect(health).toContain('static.noFailures');
    expect(health).toContain('css.parsed');
  });

  it('断言无横向溢出', () => {
    expect(health).toContain('layout.noHorizontalOverflow');
  });

  it('console 错误白名单默认为空（不允许靠白名单变绿）', () => {
    expect(health).toMatch(/CONSOLE_ERROR_ALLOWLIST\s*=\s*\[\s*\]/);
  });
});

describe('负向测试：必须存在会「故意弄坏页面」的用例', () => {
  const src = read('tools/visual/negative-tests.mjs');

  it('覆盖无 CSS、静态资源失败、错误路由、站点 404、单栏塌陷五类场景', () => {
    for (const id of ['no-css', 'no-static', 'wrong-route', 'site-404', 'not-two-column']) {
      expect(src).toContain(`id: '${id}'`);
    }
  });

  it('每个场景都断言了具体的失败检查项（不能只看整体失败）', () => {
    expect(src).toContain('forbidden');
    expect(src).toMatch(/missing\.length\s*===\s*0/);
  });

  it('门禁未能按预期判红时以非零码退出', () => {
    expect(src).toMatch(/if\s*\(\s*broken\s*>\s*0\s*\)\s*\{[\s\S]*?process\.exit\(1\)/);
  });
});
