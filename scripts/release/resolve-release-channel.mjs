#!/usr/bin/env node
/**
 * 发布渠道解析器（v0.0.18 P0-1）
 * ============================================================================
 *
 * 唯一事实来源：docs/RELEASE_CHANNELS.json
 *
 * 这个脚本只回答一个问题：给定版本，它应当是 prerelease 还是 stable？
 * 它**不**决定是否有权发布（那是 verify-risk-decision.mjs 的事），
 * 也**不**查询 GitHub（那是 release-decision.mjs 的事）。
 *
 * 用法：
 *   node scripts/release/resolve-release-channel.mjs --version v0.0.17
 *   node scripts/release/resolve-release-channel.mjs --version v0.0.17 --format json
 *   node scripts/release/resolve-release-channel.mjs --version v0.0.17 --format github-output
 *
 * 退出码：0 = 解析成功；1 = 清单无效 / 迁移清单冲突；2 = 参数错误
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const argv = process.argv.slice(2);

function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const versionArg = argOf('--version');
const format = argOf('--format') ?? 'text';
if (!versionArg || !/^v\d+\.\d+\.\d+$/.test(versionArg)) {
  console.error('用法：node scripts/release/resolve-release-channel.mjs --version vX.Y.Z [--format text|json|github-output]');
  process.exit(2);
}
if (!['text', 'json', 'github-output'].includes(format)) {
  console.error(`不支持的 format：${format}`);
  process.exit(2);
}

function loadJson(rel) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (e) {
    console.error(`✗ 无法读取 ${rel}：${e.message}`);
    process.exit(1);
  }
}

const manifest = loadJson('docs/RELEASE_CHANNELS.json');
const problems = [];

if (manifest.schema !== 'v2ex-clone-release-channels/v1') {
  problems.push(`schema 必须为 v2ex-clone-release-channels/v1，实际为 ${JSON.stringify(manifest.schema)}`);
}
if (!['prerelease', 'stable'].includes(manifest.default)) {
  problems.push(`default 必须为 prerelease 或 stable，实际为 ${JSON.stringify(manifest.default)}`);
}
if (!manifest.versions || typeof manifest.versions !== 'object' || Array.isArray(manifest.versions)) {
  problems.push('versions 必须是对象');
} else {
  for (const [v, channel] of Object.entries(manifest.versions)) {
    if (!/^v\d+\.\d+\.\d+$/.test(v)) {
      problems.push(`versions 的键 "${v}" 不是精确 vX.Y.Z（不支持通配/范围）`);
    }
    if (!['prerelease', 'stable'].includes(channel)) {
      problems.push(`versions.${v} 必须为 prerelease 或 stable，实际为 ${JSON.stringify(channel)}`);
    }
  }
}

// 迁移清单一致性：旧 stable 数组里的每一项，新清单必须显式 stable；
// 反向也校验，避免有人只改旧清单导致“改了但没生效”。
const legacyPath = path.join(ROOT, 'docs/STABLE_RELEASES.json');
if (exists(legacyPath)) {
  const legacy = loadJson('docs/STABLE_RELEASES.json');
  if (!Array.isArray(legacy.stable)) {
    problems.push('docs/STABLE_RELEASES.json 的 stable 必须是数组');
  } else {
    for (const v of legacy.stable) {
      if (manifest.versions?.[v] !== 'stable') {
        problems.push(`迁移冲突：旧清单把 ${v} 标为 stable，但 RELEASE_CHANNELS.json 未标为 stable`);
      }
    }
    for (const [v, channel] of Object.entries(manifest.versions ?? {})) {
      if (channel === 'stable' && !legacy.stable.includes(v)) {
        problems.push(`迁移冲突：RELEASE_CHANNELS.json 把 ${v} 标为 stable，但旧清单未登记`);
      }
    }
  }
} else {
  problems.push('缺少迁移清单 docs/STABLE_RELEASES.json —— 无法确认 v0.0.17 的历史登记未漂移');
}

function exists(p) {
  try { readFileSync(p); return true; } catch { return false; }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const channel = manifest.versions[versionArg] ?? manifest.default;
const result = {
  version: versionArg,
  channel,
  prerelease: channel === 'prerelease',
  latest: channel === 'stable',
};

if (format === 'json') {
  console.log(JSON.stringify(result));
} else if (format === 'github-output') {
  console.log(`channel=${result.channel}`);
  console.log(`prerelease=${result.prerelease}`);
  console.log(`latest=${result.latest}`);
} else {
  console.log(`${versionArg} => ${channel}（prerelease=${result.prerelease}, latest=${result.latest}）`);
}
process.exit(0);
