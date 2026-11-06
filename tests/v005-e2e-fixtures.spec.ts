/**
 * v0.0.5 · E2E 测试夹具（fixture）一致性护栏
 *
 * ## 为什么需要这个护栏
 *
 * 远端 CI 实测失败（run `42142762352`，E2E job）：
 *
 * ```
 * Error: listen EADDRINUSE: address already in use 127.0.0.1:3025
 *   ✘  188 [core] › e2e/v005-password-reset-flow.spec.ts:57:1
 *         › 游客：未登录也能打开「忘记密码」页
 * ```
 *
 * 根因：CI workflow 里有一个「启动 fake SMTP server」步骤，
 * 而 `e2e/v005-password-reset-flow.spec.ts` 的 `beforeAll`
 * **自己也会起一个** fake SMTP server —— 两者都监听 3025 ⇒ 端口冲突。
 *
 * 那个裸错误**完全指不到**「是两处同时起了 server」这个真正原因。
 *
 * ## 这个护栏断言什么
 *
 * | # | 断言 | 挡住什么 |
 * |---|---|---|
 * | 1 | **没有两个 E2E spec 声明同一个固定端口** | 将来再加一个 spec 起 3025 ⇒ 立刻红 |
 * | 2 | `FakeSmtpServer.start` 的端口参数必须来自 env 或字面量 0 | 硬编码端口散落各处 |
 * | 3 | fake SMTP server 必须跑在**测试进程**里，不能靠 CI 起 | 重复的启动方 |
 * | 4 | CI workflow 不得包含「启动 fake SMTP server」步骤 | 历史上真实踩过的坑 |
 * | 5 | `FakeSmtpServer.start` 必须识别 EADDRINUSE 并给出清晰错误 | 裸错误指不到真正原因 |
 *
 * ## 为什么用静态断言而不是动态测试
 *
 * 端口冲突是**运行时**才暴露的问题，但它有一个**静态可判定的**成因：
 * 「两处代码用了同一个固定端口」。
 * 静态扫描能在**改完代码的瞬间**发现问题，不需要真的跑一次 E2E。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const E2E_DIR = path.join(ROOT, 'e2e');
const read = (p: string) => readFileSync(p, 'utf8');

/** 所有 E2E spec 文件 */
function e2eSpecs(): string[] {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => path.join(E2E_DIR, f));
}

describe('v0.0.5 E2E 夹具护栏', () => {
  /**
   * ① 没有两个 spec 声明同一个**固定端口**
   *
   * 固定端口 = 字面量数字（`port: 3025`）或带默认值的 env（`?? 3025`）。
   * `port: 0` 是**随机端口** ⇒ 不冲突，不计入。
   */
  it('没有两个 E2E spec 声明同一个固定端口', () => {
    const portOwners = new Map<string, string[]>();

    for (const file of e2eSpecs()) {
      const src = read(file);

      // 形态 A：`port: 3025` / `{ port: 3025, ... }`
      for (const m of src.matchAll(/\bport:\s*(\d+)\b/g)) {
        const port = m[1];
        if (port === '0') continue; // 随机端口
        const owners = portOwners.get(port) ?? [];
        owners.push(path.basename(file));
        portOwners.set(port, owners);
      }

      // 形态 B：`process.env.E2E_SMTP_PORT ?? 3025`
      for (const m of src.matchAll(/process\.env\.\w+PORT\s*\?\?\s*(\d+)/g)) {
        const port = m[1];
        const owners = portOwners.get(port) ?? [];
        owners.push(`${path.basename(file)}(env-default)`);
        portOwners.set(port, owners);
      }
    }

    const conflicts: string[] = [];
    for (const [port, owners] of portOwners) {
      if (owners.length > 1) {
        conflicts.push(`  端口 ${port}: ${owners.join(' + ')}`);
      }
    }

    expect(
      conflicts,
      `以下固定端口被多个 E2E spec 同时使用 —— 并行运行时会 EADDRINUSE：\n${conflicts.join('\n')}\n\n` +
        `修法：要么让其中一个用 \`port: 0\`（随机端口，仅当不需要外部连接时），\n` +
        `要么用 \`E2E_SMTP_PORT\` 之类的 env 给它们分配不同端口。`,
    ).toEqual([]);
  });

  /**
   * ② `FakeSmtpServer.start` 的端口必须来自**参数**，不能是散落的字面量
   *
   * 这条断言防止「有人直接写 `new FakeSmtpServer(3025)`」绕过上面那条。
   */
  it('FakeSmtpServer 只通过 start() 的 options 指定端口', () => {
    const offenders: string[] = [];
    for (const file of e2eSpecs()) {
      const src = read(file);
      // `new FakeSmtpServer(` 出现在 spec 里 ⇒ 绕过了 start() 的错误处理
      if (/new\s+FakeSmtpServer\s*\(/.test(src)) {
        offenders.push(path.basename(file));
      }
    }
    expect(
      offenders,
      '这些 spec 直接 new FakeSmtpServer(...)，绕过了 start() 的 EADDRINUSE 处理',
    ).toEqual([]);
  });

  /**
   * ③ fake SMTP server 必须跑在**测试进程**里
   *
   * `e2e/**` 里的 fake SMTP 必须在 spec 自己的 `beforeAll` 里启动 ——
   * 这样测试才能**直接断言**收到的邮件。
   */
  it('fake SMTP server 由 E2E spec 自己的 beforeAll 启动', () => {
    const spec = path.join(E2E_DIR, 'v005-password-reset-flow.spec.ts');
    const src = read(spec);

    // 必须在 beforeAll 里调用 FakeSmtpServer.start
    const beforeAll = /test\.beforeAll\(([\s\S]*?)\}\)/.exec(src)?.[1] ?? '';
    expect(beforeAll, '应能在 beforeAll 块内找到 FakeSmtpServer.start').toContain(
      'FakeSmtpServer.start',
    );
  });

  /**
   * ④ CI workflow 不得包含「启动 fake SMTP server」步骤
   *
   * 这是**历史上真实踩过的坑**：CI 起了独立进程的 fake server，
   * 与 spec 的 beforeAll 抢同一个端口 ⇒ EADDRINUSE。
   */
  it('CI workflow 没有重复的 fake SMTP server 启动步骤', () => {
    const ci = read(path.join(ROOT, '.github', 'workflows', 'ci.yml'));

    // 允许在**注释**里提到（说明历史教训），但**不允许**有真的启动步骤。
    // 判据：`npx tsx scripts/fake-smtp-server.ts` 只允许出现在注释里。
    const lines = ci.split('\n');
    const offending: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue; // 注释行跳过
      if (trimmed.includes('scripts/fake-smtp-server.ts')) {
        offending.push(trimmed);
      }
    }

    expect(
      offending,
      `CI workflow 里有真实的 fake SMTP server 启动命令 ——\n` +
        `它会与 e2e/v005-password-reset-flow.spec.ts 的 beforeAll 抢同一个端口 ⇒ EADDRINUSE。\n` +
        `fake SMTP server 必须由 spec 自己在测试进程内启动。\n` +
        `（远端 run 42142762352 就是这么失败的。）`,
    ).toEqual([]);
  });

  /**
   * ⑤ `FakeSmtpServer.start` 必须识别 EADDRINUSE
   *
   * 裸的 `EADDRINUSE` 错误指不到「是两处同时起了 server」这个真正原因。
   */
  it('FakeSmtpServer.start 对 EADDRINUSE 给出清晰错误', () => {
    const helper = read(path.join(ROOT, 'tests', 'helpers', 'fake-smtp-server.ts'));
    expect(helper).toContain('EADDRINUSE');
    expect(helper).toMatch(/端口已被占用|address already in use/i);
  });
});
