import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 发布链路**触发器就绪性**护栏（v0.0.14）
 *
 * ## 这个护栏防的是什么（真实事故）
 *
 * v0.0.14 已获主人明确风险接受 + 公开发布授权，版本载体同步到 `0.0.14`，
 * 候选产物也在该源码树上验证通过。打 Tag 前逐项核对发布链路时发现：
 *
 *   `release.yml` 的 `on.push.tags` 白名单**只到 `v0.0.13`**。
 *
 * 后果不是「发布失败」，而是**发布根本不发生**：推 `v0.0.14` tag
 * 不会触发任何 job，没有报错、没有红叉、没有任何通知 —— 看起来"推上去了"，
 * 实际上 Release 永远不会出现。而 Tag 一旦推上去就**不可移动**
 * （移动 Tag 属需主人单独授权的不可逆操作），于是这个版本直接卡死。
 *
 * ## 为什么既有门禁全都抓不到
 *
 * · `ci.yml` 跑的是分支与 PR，**从不跑 tag 触发器**；
 * · 静态套件当时只断言「白名单里有 `v0.0.13`」—— 这是**历史字符串**，
 *   它不追问「当前版本的版本号在不在里面」；
 * · 单元 / E2E / 构建 / 安装验证都不需要 tag，因此全绿。
 *
 * 同类缺陷的一般形态是「**配置里少了一行，而这一行只在真实触发时才被读取**」，
 * 与 V14-01 的「代码齐全、链路不通」是同一类。本护栏因此不看历史字符串，
 * 而是**把当前版本载体与白名单做交叉比对**。
 *
 * ## 判据
 *
 * 1. `package.json` 的 version 必须出现在 `release.yml` 的 tag 白名单里；
 * 2. 白名单条目必须是纯版本号字符串（不能写成 `v*` 之类的通配 ——
 *    那会让任意 tag 都能触发带 `packages:write` / `contents:write` 的流水线）；
 * 3. 白名单里的版本号必须严格递增且无重复（防止手滑写成 `v0.0.1` 覆盖旧值）。
 *
 * ⚠️ 本护栏**不能**替代「打 Tag 前的人工核对」：它只保证「版本号在里面」，
 * 不能证明白名单里的版本**该不该**发布（那是 G10 授权判据的职责）。
 * 白名单就绪 ≠ 已授权 ≠ 已发布。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const WORKFLOW_PATH = '.github/workflows/release.yml';
const workflow = read(WORKFLOW_PATH);
const pkg = JSON.parse(read('package.json')) as { version: string };
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

/**
 * 从 `on.push.tags` 段里抽出白名单条目。
 *
 * 只解析 **`on:` 之后的 `push:` → `tags:` 列表**，不扫全文 —— 否则
 * 注释里提到的历史版本号（本文件注释里就有一堆）会被误当成条目。
 * 这正是本仓反复踩的「朴素字符串匹配把注释当实现」的坑（V13-17 / V14-03）。
 */
function parseTagWhitelist(source: string): string[] {
  const lines = source.split('\n');
  const onIndex = lines.findIndex((l) => /^on:\s*$/.test(l));
  expect(onIndex, '未找到顶层 on: 段').toBeGreaterThanOrEqual(0);

  let inPush = false;
  let inTags = false;
  let pushIndent = -1;
  const entries: string[] = [];

  for (let i = onIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // 顶层键出现 ⇒ on: 段结束
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!inPush) {
      if (/^push:\s*$/.test(trimmed)) {
        inPush = true;
        pushIndent = indent;
      }
      continue;
    }
    // 回到与 push 同级或更浅 ⇒ push 段结束
    if (trimmed && indent <= pushIndent && !/^\s*#/.test(line)) break;

    if (!inTags) {
      if (/^tags:\s*$/.test(trimmed)) inTags = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^-\s*'([^']+)'\s*$/) || trimmed.match(/^-\s*"([^"]+)"\s*$/);
    if (!m) {
      // 出现了非字符串条目（例如通配或裸标量）⇒ 直接记录，交由下面的断言判红
      entries.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }
    entries.push(m[1]);
  }
  return entries;
}

describe('发布链路：Tag 白名单与版本载体一致（v0.0.14）', () => {
  it('release.yml 存在且能被解析出非空白名单', () => {
    expect(existsSync(path.join(ROOT, WORKFLOW_PATH))).toBe(true);
    const list = parseTagWhitelist(workflow);
    expect(list.length, 'tag 白名单为空 —— 任何 tag 都不会触发发布流水线').toBeGreaterThan(0);
  });

  it('版本载体中的当前版本必须出现在 tag 白名单里（否则推 Tag 不会触发发布）', () => {
    const list = parseTagWhitelist(workflow);
    expect(
      list,
      `release.yml 的 on.push.tags 白名单缺少当前版本 ${TAG}（package.json version = ${VERSION}）。\n` +
        `后果：推送 ${TAG} tag **不会触发任何 job**，Release 永远建不出来，` +
        `而 Tag 推上去就不可移动 ⇒ 该版本会被卡死。\n` +
        `修复：在 .github/workflows/release.yml 的 on.push.tags 下加入 '- '${TAG}''。`,
    ).toContain(TAG);
  });

  it('白名单条目必须是具体版本号，不得使用通配（否则任意 tag 都能触发带写权限的流水线）', () => {
    const list = parseTagWhitelist(workflow);
    const bad = list.filter((t) => !/^v\d+\.\d+\.\d+$/.test(t));
    expect(bad, `白名单含非具体版本条目：${bad.join(', ')}`).toEqual([]);
  });

  it('白名单版本号严格递增且无重复', () => {
    const list = parseTagWhitelist(workflow);
    const versions = list.map((t) => t.replace(/^v/, ''));
    expect(new Set(versions).size, `白名单存在重复版本：${versions.join(', ')}`).toBe(versions.length);

    const bySemver = (a: string, b: string) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
      }
      return 0;
    };
    const sorted = [...versions].sort(bySemver);
    expect(versions, '白名单未按版本号递增排列（易被手滑覆盖）').toEqual(sorted);
  });
});
