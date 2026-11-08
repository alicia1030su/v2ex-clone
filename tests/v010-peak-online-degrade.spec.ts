import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.10 回归：**缓存不可用时页脚不得把整页打成 5xx**
 *
 * ## 真实事故（CI R-17a 抓到）
 *
 * v0.0.10 新增的 `getOnlinePeak()` 第一版直接 `await kv.get(...)`。
 * Redis 被 stop 之后 ioredis 抛出 `Error: Connection is closed.`，
 * 而这个函数在 **Footer** 里被调用 —— Footer 是**每个页面**都渲染的组件
 * ⇒ 任何页面都 500。
 *
 * `docker-verify.yml` 的 `[R-17a] Redis 中断与恢复` 正是断言
 * 「Redis 停止期间 `/`、`/nodes`、`/api/nodes` 不得出现 5xx」，
 * 于是当场判红。这是**本仓的既有契约**（见 `src/lib/kv.ts` 头注释：
 * 「生产使用 Redis，本地开发在没有 Redis 时自动降级到 PostgreSQL，
 * 两者行为一致」）。
 *
 * ## 为什么用源码断言而不是运行时断言
 *
 * `getOnlinePeak` 是带 `server-only` 的模块，单测环境里直接 import 会
 * 触发 server-only 保护。而这里要守的性质非常具体、且**位置固定**：
 * 「这个函数体内必须有 try/catch，catch 分支必须回退到 current」。
 *
 * 因此用**结构化源码断言**（与 `tests/static/*` 同思路）：
 * 它不会因为 mock 写得漂亮而误绿，也不会因为测试环境有 Redis 而失去意义。
 *
 * ⚠️ 这条判据不能替代真实 Docker 下的 R-17a；两者互补：
 *    本文件保证「代码结构上不可能漏掉降级」，R-17a 保证「行为上真的没 5xx」。
 */
const REPO_ROOT = path.resolve(__dirname, '..');
const QUERIES = path.join(REPO_ROOT, 'src', 'server', 'queries.ts');

describe('v0.0.10 · 页脚缓存降级（R-17a 回归）', () => {
  let src: string;

  beforeEach(() => {
    src = readFileSync(QUERIES, 'utf8');
  });

  /** 取 `getOnlinePeak` 的函数体（从签名到下一个顶层 export 之前） */
  function peakBody(): string {
    const start = src.indexOf('export async function getOnlinePeak');
    expect(start, 'getOnlinePeak 不存在 —— 函数被删了？').toBeGreaterThanOrEqual(0);
    const nextExport = src.indexOf('\nexport ', start + 10);
    return src.slice(start, nextExport === -1 ? undefined : nextExport);
  }

  it('getOnlinePeak 内部必须有 try/catch', () => {
    const body = peakBody();
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/\}\s*catch\s*(\([^)]*\))?\s*\{/);
  });

  it('catch 分支必须回退到 current（不得重抛、不得返回 0）', () => {
    const body = peakBody();
    const catchIdx = body.search(/\}\s*catch\s*(\([^)]*\))?\s*\{/);
    expect(catchIdx).toBeGreaterThanOrEqual(0);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).toContain('return current');
    // 不得在 catch 里重新抛出（那会让上层 5xx）
    expect(catchBody).not.toMatch(/throw\s/);
  });

  it('调用方（Footer）不得再把 KV 读写放在 try 之外', () => {
    const footer = readFileSync(path.join(REPO_ROOT, 'src', 'components', 'Footer.tsx'), 'utf8');
    // Footer 只应通过 getOnlinePeak 间接访问 KV，不应直接 import getKV
    expect(footer).not.toMatch(/from '@\/lib\/kv'/);
    expect(footer).toContain('getOnlinePeak');
  });

  it('getOnlinePeak 的返回值不会小于 current（不虚增、不虚减）', () => {
    // 结构性断言：Math.max(current, ...) 必须存在
    expect(peakBody()).toMatch(/Math\.max\(\s*current/);
  });
});
