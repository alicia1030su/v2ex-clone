import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * v0.0.16 发布授权闸门：必须校验**结构化字段的语义**，不能只 grep 关键词
 * ============================================================================
 *
 * ## 为什么这条护栏必须用「真实执行」而不是字符串匹配
 *
 * 上一轮的闸门是：
 *
 *     for token in 'A3' 'B1' 'R-01'; do grep -q "$token" ... || exit 1; done
 *
 * 它只能证明三个字符串出现过。真实存在的反例：
 *
 *   1. 「本次**不**授权 B1 公开发布」—— 含 B1，意思相反；
 *   2. 「上一版是 A3 + B1，本版沿用」—— 别人的裁决；
 *   3. 「待补，先写 A3/B1 占位」—— 三个词都在，一个字不是裁决；
 *   4. 把 v0.0.15 的裁决文件复制成 v0.0.16 —— 文件名对、内容旧。
 *
 * 纯 grep 判据对这四种**全部判绿**。
 *
 * 因此本 spec **真的执行** `verify-risk-decision.mjs`，用真实临时文件
 * 逐个构造上述反例，断言它必须拒绝（非零退出），并断言**拒绝原因**
 * 确实指向目标项（否则「判红」也可能是因为别的原因碰巧红了）。
 *
 * 这是本仓一贯要求的「负向对照必须能证明判据自己有效」。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/release/verify-risk-decision.mjs');

function runGate(file: string, version = 'v0.0.16'): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--version', version, '--file', file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** 从一份合法裁决文件里取出结构化 JSON，供反例复用 */
function validFields(): Record<string, unknown> {
  const text = readFileSync(path.join(ROOT, 'docs/RISK_DECISION_v0.0.16.md'), 'utf8');
  const m = text.slice(text.indexOf('RISK-DECISION-FIELDS')).match(/```json\s*\n([\s\S]*?)```/);
  if (!m) throw new Error('真实裁决文件里找不到结构化块 —— 本 spec 的前提不成立');
  return JSON.parse(m[1]) as Record<string, unknown>;
}

function docWith(fields: unknown): string {
  return [
    '# 测试用裁决',
    '',
    '<!-- RISK-DECISION-FIELDS -->',
    '',
    '```json',
    JSON.stringify(fields, null, 2),
    '```',
    '',
  ].join('\n');
}

describe('v0.0.16 发布授权闸门：结构化语义校验', () => {
  it('真实裁决文件必须能通过（正向前提）', () => {
    const r = runGate(path.join(ROOT, 'docs/RISK_DECISION_v0.0.16.md'));
    expect(r.code, `真实裁决文件未通过：\n${r.out}`).toBe(0);
  });

  it('负向 ①：缺文件必须拒绝', () => {
    const r = runGate(path.join(ROOT, 'docs/RISK_DECISION_v9.9.9.md'), 'v9.9.9');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/缺少|没有走过公开发布授权流程/);
  });

  it('负向 ②：版本不符必须拒绝（不能挪用上一版的裁决）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-ver-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(f, docWith({ ...validFields(), version: 'v0.0.15' }), 'utf8');
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/version/);
      expect(r.out).toMatch(/不一致/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ③：B1 只出现在否定句中必须拒绝（无结构化字段时）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-neg-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(
        f,
        [
          '# 说明',
          '',
          '本次**不**授权 B1 公开发布。A3 与 R-01 也不构成发布授权。',
          '',
          '（没有结构化裁决块）',
        ].join('\n'),
        'utf8',
      );
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/结构化|RISK-DECISION-FIELDS/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ④：A2 / B2 决策必须拒绝', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-ab-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(f, docWith({ ...validFields(), decision_a: 'A2', decision_b: 'B2' }), 'utf8');
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/decision_a/);
      expect(r.out).toMatch(/decision_b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ⑤：缺少明确公开发布权限（非布尔 true）必须拒绝', () => {
    for (const bad of [false, 'true', 1, undefined]) {
      const dir = mkdtempSync(path.join(tmpdir(), 'authz-pub-'));
      try {
        const f = path.join(dir, 'decision.md');
        const fields: Record<string, unknown> = { ...validFields() };
        if (bad === undefined) delete fields.public_release_authorized;
        else fields.public_release_authorized = bad;
        writeFileSync(f, docWith(fields), 'utf8');
        const r = runGate(f, 'v0.0.16');
        expect(r.code, `public_release_authorized=${JSON.stringify(bad)} 竟然通过了`).not.toBe(0);
        expect(r.out).toMatch(/public_release_authorized/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('负向 ⑥：授权主体是自动化身份必须拒绝（机器不能自己授权自己）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-by-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(f, docWith({ ...validFields(), authorized_by: 'AI assistant' }), 'utf8');
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/authorized_by/);
      expect(r.out).toMatch(/自动化身份/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ⑦：作用域不是单版本 / 非一次性必须拒绝', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-scope-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(f, docWith({ ...validFields(), scope: 'all-versions', one_time: false }), 'utf8');
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/scope|one_time/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ⑧：R-01 被宣称已修复必须拒绝', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-r01-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(f, docWith({ ...validFields(), r01_status: 'FIXED' }), 'utf8');
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/r01_status/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向 ⑨：允许 / 禁止清单缺关键项必须拒绝', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-ops-'));
    try {
      const f = path.join(dir, 'decision.md');
      writeFileSync(
        f,
        docWith({ ...validFields(), allowed_operations: ['push-tag'], forbidden_operations: [] }),
        'utf8',
      );
      const r = runGate(f, 'v0.0.16');
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/allowed_operations|forbidden_operations/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v0.0.16 授权闸门的接线（preflight 必须调用结构化校验，而不是 grep）', () => {
  const WF = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

  it('preflight 必须调用 verify-risk-decision.mjs', () => {
    expect(WF, 'preflight 未调用 verify-risk-decision.mjs').toContain('verify-risk-decision.mjs');
    expect(WF).toMatch(/verify-risk-decision\.mjs --version "\$VERSION"/);
  });

  it('不得再用 grep 关键词当作授权判据', () => {
    // 反向断言：作用域限定在授权步骤块内，避免被别处的 grep 误伤
    const start = WF.indexOf('授权闸门（本版本裁决记录必须存在）');
    expect(start, '找不到授权闸门步骤').toBeGreaterThan(0);
    const block = WF.slice(start, start + 4000);
    expect(
      /grep\s+-q\s+"?\$token/.test(block),
      '授权步骤又回到「grep 关键词」判据 —— 关键词存在 ≠ 拿到授权',
    ).toBe(false);
  });

  it('闸门仍在构建 job 之前（失败必须发生在烧 runner 之前）', () => {
    const gate = WF.indexOf('授权闸门（本版本裁决记录必须存在）');
    const build = WF.indexOf('代码检查（类型 + 构建）');
    expect(gate).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(gate);
  });
});
