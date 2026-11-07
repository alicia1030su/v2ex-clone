import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * v0.0.8：E2E / 工具脚本的**语法**护栏
 *
 * ## 为什么需要（实测踩到）
 *
 * v0.0.8 提交了一个 `e2e/helpers.ts` 的**注释块语法错误**
 * （旧注释的结束符之后紧跟新注释的开头符）：
 *
 *   SyntaxError: e2e/helpers.ts: Unexpected token (225:1)
 *
 * 而 **`npx tsc --noEmit` 没有报出来**（TS 对注释块的解析比
 * Playwright/esbuild 宽松）⇒ 错误一路进了 CI ⇒ 15 个分片全部
 * 「0 个用例被收集」⇒ 矩阵看起来像「跑完了」，实际**一条都没跑**。
 *
 * ## 本护栏断言什么
 *
 * ① e2e/、tools/、tests/ 下所有 .ts 文件都能被 TypeScript **解析器**
 *    无错误地解析（parseDiagnostics）；
 * ② 每个 Playwright spec 文件都至少定义了一个 test（防止「空文件」）；
 * ③ spec 引用的 helper 导出确实存在（防止拼错名字 ⇒ 收集期失败）。
 *
 * 纯静态检查，**不依赖数据库** ⇒ 可以在任何环境跑。
 */

// vitest 的 cwd = 项目根（即使配置文件在根目录）—— 实测：多退一级会收集到 0 个文件
const ROOT = path.resolve(process.cwd());
const DIRS = ['e2e', 'tools', 'tests', 'src'];

/** 递归收集 .ts 文件（跳过 node_modules / .next） */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === 'node_modules_cache') continue;
    const p = path.join(abs, e);
    const st = statSync(p);
    if (st.isDirectory()) collectTsFiles(path.join(dir, e), out);
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(path.join(dir, e));
  }
  return out;
}

describe('v0.0.8 E2E/工具脚本语法护栏', () => {
  it('所有 TypeScript 文件都能被解析器无错解析（tsc 抓不到的注释块错误）', () => {
    const files = DIRS.flatMap((d) => collectTsFiles(d));
    expect(files.length).toBeGreaterThan(50);

    const problems: string[] = [];
    for (const rel of files) {
      const src = ts.createSourceFile(
        rel,
        readFileSync(path.join(ROOT, rel), 'utf8'),
        ts.ScriptTarget.ESNext,
        true,
      );
      const diags = src.parseDiagnostics ?? [];
      if (diags.length > 0) {
        const first = diags[0]!;
        const pos = src.getLineAndCharacterOfPosition(first.start ?? 0);
        problems.push(
          `${rel}:${pos.line + 1}:${pos.character + 1} ${ts.flattenDiagnosticMessageText(
            first.messageText,
            ' ',
          )}`,
        );
      }
    }
    expect(
      problems,
      `以下文件有语法错误（**tsc --noEmit 未必能抓到**，但 Playwright/esbuild 会）：\n` +
        problems.join('\n'),
    ).toEqual([]);
  });

  it('每个 E2E spec 都至少定义了一个 test', () => {
    const specDir = path.join(ROOT, 'e2e');
    const specs = readdirSync(specDir).filter((f) => f.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(3);

    const empty: string[] = [];
    for (const f of specs) {
      const src = readFileSync(path.join(specDir, f), 'utf8');
      if (!/\btest\s*\(/.test(src) && !/\btest\.describe\b/.test(src)) {
        empty.push(f);
      }
    }
    expect(empty, `以下 spec 没有任何 test 定义（会被静默跳过）：${empty.join(', ')}`).toEqual([]);
  });

  it('E2E spec 从 helpers 导入的名字都真实存在', () => {
    const helperSrc = readFileSync(path.join(ROOT, 'e2e', 'helpers.ts'), 'utf8');
    // helpers.ts 的导出名
    const exports = new Set<string>();
    for (const m of helperSrc.matchAll(
      /export\s+(?:async\s+)?function\s+(\w+)/g,
    )) exports.add(m[1]!);
    for (const m of helperSrc.matchAll(/export\s+const\s+(\w+)/g)) exports.add(m[1]!);
    for (const m of helperSrc.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)) exports.add(m[1]!);
    expect(exports.size).toBeGreaterThan(5);

    const specDir = path.join(ROOT, 'e2e');
    const specs = readdirSync(specDir).filter((f) => f.endsWith('.spec.ts'));
    const bad: string[] = [];
    for (const f of specs) {
      const src = readFileSync(path.join(specDir, f), 'utf8');
      // ⚠️ 用**非贪婪且不跨分号**的匹配：原来的 `[\s\S]*?` 会从**第一个**
      //   `import {` 一路吃到 helpers 那个 `}`（贪婪跨越其它 import 语句）
      //   ⇒ 把 '@playwright/test' 的导入名也当成 helpers 的导出 ⇒ 误报。
      //   限定 `[^;]*?` ⇒ 不跨越语句边界。
      const re = /import\s*\{([^;]*?)\}\s*from\s*['"]\.\/helpers['"]/g;
      for (const imp of src.matchAll(re)) {
        for (const raw of imp[1]!.split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
          if (!name) continue;
          if (!exports.has(name)) bad.push(`${f}: ${name}`);
        }
      }
    }
    expect(
      bad,
      `以下从 helpers 导入的名字不存在（Playwright 收集期就会失败 ⇒ 全部用例不跑）：\n${bad.join('\n')}`,
    ).toEqual([]);
  });
});
