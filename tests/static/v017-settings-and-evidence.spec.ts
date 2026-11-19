import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.17 P1-2 设置页体验 + P1-3 视觉证据诚实性
 * ============================================================================
 *
 * ## P1-2 改的是什么
 *
 * 「修改密码」三个输入框都带 `required`，浏览器会拦截提交 —— 但那是**静默**的：
 * 用户点「修改密码」后页面没有任何反应，只能自己发现某个框没填。
 * 部分浏览器只在聚焦时才画笔气泡，而点击按钮不会自动聚焦第一个空字段；
 * 移动端软键盘还可能把提示挡在视口外。
 *
 * 修法：表单加 `noValidate`（不让浏览器替代我们校验）+ 提交处理里**逐项**
 * 检查并指出**具体哪一项**没填。
 *
 * ## P1-3 改的是什么
 *
 * `ref-nodes_all.png` 的实际内容是 **Go 节点页**，不是「全部节点」页
 * ⇒ 它没有资格做 `nodes_all` 的对照证据。
 * 本版把它显式标为 **INVALID / UNVERIFIED**（不是删除、不是改名、
 * 更不是裁剪成「看起来对」），并禁止后续引用它作为对比依据。
 *
 * ⚠️ 这里锁的是「不许假装有证据」，不是「必须补一张图」。
 * 拿不到合法参考图就保持 UNVERIFIED —— 那比一张错图诚实。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SETTINGS = read('src/components/SettingsForm.tsx');
const MATRIX = read('docs/FEATURE_MATRIX.md');
/*
 * 证据索引**可能不存在** —— 那本身就是一种合法状态（不引用即不出错）。
 * 第一版直接 `read(...)`，文件不存在时整个 spec 在加载阶段就抛
 * `ENOENT`，一条断言都没跑（表现为 "Tests no tests"）。
 * 用 existsSync 先判存在性，把「不存在」当成正常分支。
 */
const EVIDENCE_INDEX_PATH = 'docs/evidence/README.md';
const EVIDENCE_INDEX = existsSync(path.join(ROOT, EVIDENCE_INDEX_PATH))
  ? read(EVIDENCE_INDEX_PATH)
  : '';

describe('v0.0.17 P1-2 修改密码：必填校验必须可见', () => {
  it('表单必须加 noValidate（否则浏览器静默拦截，用户看不到原因）', () => {
    expect(
      SETTINGS,
      '表单没有 noValidate —— 浏览器会静默阻止提交，用户点了没反应',
    ).toMatch(/<form[^>]*onSubmit=\{changePassword\}[^>]*noValidate/);
  });

  it('必须逐项校验，且报错要指出**具体哪一项**', () => {
    // 三项各自有独立提示文案 —— 只说「请填写完整」等于把排查成本转给用户
    expect(SETTINGS).toMatch(/请填写「当前密码」/);
    expect(SETTINGS).toMatch(/请填写「新密码」/);
    expect(SETTINGS).toMatch(/请填写「确认新密码」/);
  });

  it('校验必须在发请求**之前**（不能先打服务端再说缺字段）', () => {
    const submitIdx = SETTINGS.indexOf('async function changePassword');
    expect(submitIdx).toBeGreaterThan(0);
    const body = SETTINGS.slice(submitIdx, submitIdx + 2200);
    const firstCheck = body.indexOf('请填写「当前密码」');
    const firstFetch = body.indexOf("csrfFetch('/api/settings/password'");
    expect(firstCheck, '找不到必填校验').toBeGreaterThan(0);
    expect(firstFetch, '找不到请求调用').toBeGreaterThan(0);
    expect(firstCheck, '校验在请求之后 —— 白打一次网络往返').toBeLessThan(firstFetch);
  });

  it('错误消息区必须可被读屏播报（role=alert），不能只靠颜色', () => {
    expect(SETTINGS).toMatch(/role=\{msg\.kind === 'err' \? 'alert' : 'status'\}/);
  });

  it('保留 required 语义（辅助技术仍要念「必填」）', () => {
    const count = (SETTINGS.match(/\n\s+required\n/g) ?? []).length;
    expect(count, 'required 被一并删掉了 —— 语义标注仍然需要').toBeGreaterThanOrEqual(3);
  });

  it('原有强度校验不得被弱化（长度 / 两次一致）', () => {
    expect(SETTINGS).toMatch(/两次输入的新密码不一致/);
    expect(SETTINGS).toMatch(/新密码至少 8 位/);
  });
});

describe('v0.0.17 P1-3 视觉证据：失效参考必须标 INVALID', () => {
  it('FEATURE_MATRIX 必须明确把 ref-nodes_all.png 标为无效证据', () => {
    expect(MATRIX).toContain('ref-nodes_all.png');
    // 必须有「实际内容是 Go 节点页」这一事实陈述
    expect(MATRIX).toMatch(/Go 节点页/);

    /*
     * ⚠️ 判据必须锚到**那一行表格**，不能全文搜 `UNVERIFIED`。
     *
     * 第一版写 `expect(MATRIX).toMatch(/UNVERIFIED|INVALID/)` —— 负向对照
     * （把该行的 `INVALID / UNVERIFIED` 改成「可用」）**仍然通过**，
     * 因为同一句后半段还留着「保持 UNVERIFIED」。一个词在同段出现两次，
     * 全文匹配就分不清「标了」还是「没标」。
     */
    const row = MATRIX.split('\n').find((l) => l.includes('ref-nodes_all.png') && l.includes('证据资格'));
    expect(row, '找不到 ref-nodes_all 的证据资格那一行 —— 结构已变，本用例需重写').toBeTruthy();
    expect(row!, '该行未标 INVALID').toContain('INVALID');
    expect(row!, '该行状态仍写「可用」').toContain('不可用');
  });

  it('不得把该图当成 nodes_all 的对照依据（禁止据此改代码）', () => {
    expect(MATRIX).toMatch(/不据此改代码|不得作为|不具备.*对照/);
  });

  it('证据索引里若登记了该文件，必须标注失效', () => {
    if (!EVIDENCE_INDEX.includes('ref-nodes_all')) {
      // 未登记也是一种合法状态：不引用它
      return;
    }
    const idx = EVIDENCE_INDEX.indexOf('ref-nodes_all');
    const around = EVIDENCE_INDEX.slice(Math.max(0, idx - 300), idx + 300);
    expect(around, '证据索引里引用了 ref-nodes_all 却没有失效标注').toMatch(/UNVERIFIED|INVALID|失效/);
  });
});
