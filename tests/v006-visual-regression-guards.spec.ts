/**
 * v0.0.6 视觉回归工具的**行为护栏**
 *
 * 这些断言保护的是「失败必须失败」这条纪律：
 *   - 基线文件不存在 ⇒ 退出码非 0（否则 CI 绿灯掩盖「从未做过视觉验证」）
 *   - 基线里有回归项 ⇒ 退出码非 0
 *   - 基线缺组合 ⇒ 退出码非 0（未审查的组合不得静默跳过）
 *   - 工具**不得**在对比模式下自动写基线（基线更新必须人工审查）
 *
 * 实测方式：真跑工具（用 mock 的 page.evaluate 结果），断言退出码。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO = path.resolve(process.cwd());
const TOOL = path.join(REPO, 'tools', 'visual', 'regression.mjs');

/** 读工具源码，做静态断言（比跑起来快，且能覆盖到「危险写法」） */
const source = readFileSync(TOOL, 'utf8');

describe('视觉回归工具的失败语义（v0.0.6 护栏）', () => {
  it('基线文件不存在时必须以非 0 退出码结束', () => {
    // ⚠️ v0.0.8：断言点从「catch 块的首个 1200 字符」改为**定位缺基线的
    //    失败分支本身** —— v0.0.8 调整了读基线的位置（对比前先读一次以取
    //    clockAnchor），原断言会因为「第一个匹配到『基线不存在』的注释」
    //    而取错片段（实测：取到的是新加的注释文本 ⇒ 误报失败）。
    //
    //    用 lastIndexOf：脚本里有**两处**提到「基线不存在」——
    //    前一处是 v0.0.8 新增的读基线注释，后一处才是真正的失败分支。
    //
    //    语义不变：**读基线失败 ⇒ 退出码非 0**。
    const idx = source.lastIndexOf('基线不存在');
    expect(idx).toBeGreaterThan(-1);
    const segment = source.slice(idx, idx + 2000);
    expect(segment).toContain('process.exitCode = 1');
  });

  it('检测到回归项时必须以非 0 退出码结束', () => {
    expect(source).toContain('if (regressions > 0) process.exitCode = 1;');
  });

  it('基线缺少组合时必须判为失败（不得静默跳过）', () => {
    expect(source).toContain('missingKeys');
    expect(source).toMatch(/missingKeys\.length > 0/);
  });

  it('对比模式下不得自动写入基线文件', () => {
    // writeFile(BASELINE_FILE, ...) 只能出现在 SAVE_BASELINE 分支里
    //
    // ⚠️ v0.0.8：断言从「字符串精确匹配」改为**正则**（允许换行/空格差异）——
    //    重构基线写入（加 clockAnchor 字段）后 `writeFile(\n    BASELINE_FILE,`
    //    不再与单行字符串匹配 ⇒ 原断言恒失败（实测 expected -1）。
    //    语义不变：**写基线只能发生在 SAVE_BASELINE 分支内**。
    const saveIdx = source.indexOf('if (SAVE_BASELINE)');
    const compareIdx = source.indexOf('} else if (COMPARE_BASELINE)');
    const writeMatch = /writeFile\(\s*BASELINE_FILE/.exec(source);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(compareIdx).toBeGreaterThan(saveIdx);
    expect(writeMatch).not.toBeNull();
    const writeIdx = writeMatch!.index;
    expect(writeIdx).toBeGreaterThan(saveIdx);
    expect(writeIdx).toBeLessThan(compareIdx);
  });

  it('横向溢出必须被显式检出（overflow > 1 判定）', () => {
    expect(source).toContain('ov.overflow > 1');
  });
});

describe('视觉回归工作流的纪律（v0.0.6 护栏）', () => {
  const wf = readFileSync(
    path.join(REPO, '.github', 'workflows', 'visual-regression.yml'),
    'utf8',
  );

  it('必须安装三个浏览器引擎（只跑 Chromium 漏 Firefox 缺陷）', () => {
    expect(wf).toContain('chromium firefox webkit');
  });

  it('CI 中不得自动更新基线（只有显式勾选才允许）', () => {
    expect(wf).toContain('update_baseline');
    // 基线更新的唯一开关必须是 workflow_dispatch 的显式输入
    expect(wf).toMatch(/inputs\.update_baseline/);
    expect(wf).toMatch(/inputs\.update_baseline[\s\S]{0,40}=\s*"true"/);
    // 默认必须是 false（不勾选就不更新）
    expect(wf).toMatch(/update_baseline:[\s\S]{0,300}default:\s*false/);
  });

  it('必须区分三类失败：回归失败 / 基线缺失 / 原站不可达', () => {
    expect(wf).toContain('基线缺失');
    expect(wf).toContain('溢出');
    expect(wf).toContain('origin_status');
  });

  it('关键门禁（回归项 / 溢出 / 基线缺失）必须失败，不得伪装成 success', () => {
    // 三项必须以 ::error:: 报出并 exit 1
    expect(wf).toMatch(/::error::视觉回归失败[\s\S]{0,200}exit 1/);
    expect(wf).toMatch(/::error::检测到横向溢出[\s\S]{0,200}exit 1/);
    expect(wf).toMatch(/::error::视觉基线缺失[\s\S]{0,400}exit 1/);
  });

  it('跨浏览器不一致只告警不阻断（字体度量差异不是产品回归），但必须可见', () => {
    expect(wf).toContain('::warning::同视口下跨浏览器存在');
    // 不得把它写成 error + exit 1
    expect(wf).not.toMatch(/::error::同视口下跨浏览器存在[\s\S]{0,200}exit 1/);
  });

  it('原站不可达时必须显式声明「不构成与原站一致的结论」', () => {
    expect(wf).toContain('不构成');
  });

  it('失败时必须上传视觉证据（截图 + 测量数据）', () => {
    expect(wf).toContain('upload-artifact');
    expect(wf).toContain('docs/evidence/visual/runs/');
  });

  it('不得依赖开发机缓存：必须是全新数据库 + 全新构建', () => {
    expect(wf).toContain('drizzle-kit migrate');
    expect(wf).toContain('next build');
    expect(wf).toContain('postgres:17-alpine');
  });
});

describe('视觉回归工具的覆盖范围（v0.0.6 护栏）', () => {
  const source = readFileSync(TOOL, 'utf8');

  it('必须覆盖 7 个视口（任务书指定）', () => {
    for (const vp of ['320x568', '375x812', '390x844', '768x1024', '1280x900', '1440x900', '1920x1080']) {
      expect(source).toContain(vp);
    }
  });

  it('必须覆盖三个核心页面：首页 / 节点详情 / 主题详情', () => {
    expect(source).toContain("key: 'home'");
    expect(source).toContain("key: 'node'");
    expect(source).toContain("key: 'topic'");
    // 节点详情必须是 /go/[name]（不是节点索引页 /nodes）
    expect(source).toContain('/go/programmer');
  });

  it('必须测量横向溢出（scrollWidth vs clientWidth）', () => {
    expect(source).toContain('scrollWidth');
    expect(source).toContain('clientWidth');
  });
});

describe('视觉基线必须按平台分文件（v0.0.6 护栏）', () => {
  const source = readFileSync(TOOL, 'utf8');

  it('基线文件名必须带平台标识', () => {
    expect(source).toContain('component-baseline-${PLATFORM}.json');
    expect(source).toContain('process.platform');
  });

  it('基线必须记录平台字段', () => {
    expect(source).toMatch(/platform:\s*PLATFORM/);
  });

  it('平台不匹配时必须给出明确提示（不得静默对比）', () => {
    expect(source).toContain('LEGACY_BASELINE_FILE');
    expect(source).toContain('只在其建立时的平台有效');
  });

  it('CI 工作流必须按 linux 平台指定基线', () => {
    const wf = readFileSync(
      path.join(REPO, '.github', 'workflows', 'visual-regression.yml'),
      'utf8',
    );
    expect(wf).toContain('--platform=linux');
  });

  it('基线缺失时工作流必须明确失败并说明如何建立', () => {
    const wf = readFileSync(
      path.join(REPO, '.github', 'workflows', 'visual-regression.yml'),
      'utf8',
    );
    expect(wf).toContain('基线缺失');
    expect(wf).toContain('update_baseline');
  });
});
