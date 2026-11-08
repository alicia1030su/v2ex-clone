import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.10：仓库根目录**卫生**护栏
 *
 * ## 事故（v0.0.10 发布过程中两次踩到）
 *
 * 本地调试时写下 `... > v0.0.12`、`... > V2EX` 这类 shell 重定向（本意是
 * "把结果丢进某个变量/文件"），在 Windows Git Bash 下会**真的创建空文件**。
 * 随后 `git add -A` 把它们一起提交了：
 *
 *   - 4 个 0 字节垃圾文件先后进入 master（`本项目与`、`\uf02a\uf02a⚠️`、
 *     `V2EX`、`v0.0.12`）；
 *   - 其中 `v0.0.12` 让 `git rev-list -n1 v0.0.12` 直接报
 *     `fatal: ambiguous argument 'v0.0.12': both revision and filename`
 *     —— **同名文件与 Tag 冲突**，所有依赖 Tag 解引用的脚本全部失效。
 *
 * 这些文件不被任何测试、构建或流水线引用 ⇒ 全部 CI 依然是绿的。
 * 属于"工具链污染源码树"，只能靠静态护栏发现。
 *
 * ## 本护栏断言什么
 *
 * ① 仓库根目录**不得**存在与 Tag 同形的条目（`v1.2.3` / `1.2.3`）——
 *    它们会和 `git rev-parse <tag>` 抢解析权；
 * ② 所有被 git 跟踪的**根目录文件**都必须非空（0 字节 = 重定向垃圾）；
 * ③ 全仓（排除 `node_modules` / `.next*` / 上传目录）不得有被跟踪的 0 字节文件。
 *
 * 纯静态检查，不依赖数据库与网络。
 */

const ROOT = path.resolve(__dirname, '..', '..');

/** 与 Tag 同形：`v1.2.3` 或 `1.2.3` */
const VERSION_LIKE = /^v?\d+\.\d+\.\d+$/;

/** 被 git 跟踪的全部文件（相对路径，posix 分隔符） */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

const TRACKED = trackedFiles();

describe('仓库根目录卫生', () => {
  it('根目录不得存在与 Tag 同形的文件（会破坏 git rev-parse）', () => {
    const offenders = readdirSync(ROOT).filter((name) => {
      if (!VERSION_LIKE.test(name)) return false;
      return statSync(path.join(ROOT, name)).isFile();
    });

    expect(
      offenders,
      `根目录出现与 Tag 同形的文件：${offenders.join(', ')}\n` +
        '后果：git rev-list/rev-parse <tag> 会报 "both revision and filename"，' +
        '所有按 Tag 取源码、取迁移集的发布脚本全部失效。'
    ).toEqual([]);
  });

  it('根目录下被跟踪的文件都不得为 0 字节', () => {
    const rootTracked = TRACKED.filter((f) => !f.includes('/'));
    const empty = rootTracked.filter((f) => {
      const abs = path.join(ROOT, f);
      try {
        return statSync(abs).size === 0;
      } catch {
        // 文件被删除但索引未更新 —— 交给 git status 报，不算本护栏的职责
        return false;
      }
    });

    expect(
      empty,
      `根目录存在 0 字节且被 git 跟踪的文件：${empty.join(', ')}\n` +
        '这类文件通常是 shell 重定向（`... > 名字`）误创建后又被 git add -A 带进来的。'
    ).toEqual([]);
  });

  it('全仓不得有被跟踪的 0 字节文件（排除上传目录与工具缓存）', () => {
    const IGNORE_PREFIX = ['node_modules/', '.next', 'public/uploads/', 'docs/evidence/'];
    // 有意为之的空文件（占位符），必须逐个列出，不得用通配放过
    const ALLOWED_EMPTY = new Set(['public/static/.gitkeep']);
    const empty = TRACKED.filter((f) => {
      if (IGNORE_PREFIX.some((p) => f.startsWith(p))) return false;
      if (ALLOWED_EMPTY.has(f)) return false;
      try {
        return statSync(path.join(ROOT, f)).size === 0;
      } catch {
        return false;
      }
    });

    expect(
      empty,
      `以下被跟踪文件是 0 字节：${empty.join(', ')}\n` +
        '（若确属有意为之的空文件——例如 .gitkeep——请在本用例里显式加入白名单，' +
        '不要直接放宽断言。）'
    ).toEqual([]);
  });
});
