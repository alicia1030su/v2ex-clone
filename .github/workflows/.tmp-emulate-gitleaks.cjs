// 临时：用 gitleaks v8.18.4 官方配置的 generic-api-key 规则 + 其 stopwords
// 精确模拟「gitleaks 扫描本仓库历史会报什么」。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const toml = fs.readFileSync('/tmp/gl.toml', 'utf8');

// --- 解析 generic-api-key 规则 ---
const ruleIdx = toml.indexOf('id = "generic-api-key"');
const ruleBlock = toml.slice(ruleIdx, toml.indexOf('[rules.allowlist]', ruleIdx));
const regexSrc = ruleBlock.match(/regex = '''([\s\S]*?)'''/)[1];
const entropyThreshold = parseFloat(ruleBlock.match(/entropy = ([\d.]+)/)[1]);

// --- 解析该规则的 stopwords（紧跟规则后的第一个 [rules.allowlist]）---
const swStart = toml.indexOf('[rules.allowlist]', ruleIdx);
const swBlock = toml.slice(swStart, toml.indexOf(']', swStart));
const stopwords = (swBlock.match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ''));

// --- 全局 allowlist paths ---
const gStart = toml.indexOf('[allowlist]');
const gBlock = toml.slice(gStart, toml.indexOf(']', gStart));
const globalPaths = (gBlock.match(/'''(.*?)'''/g) || []).map((s) => s.replace(/'''/g, ''));

console.log('entropy threshold =', entropyThreshold);
console.log('rule stopwords    =', stopwords.length);
console.log('global path allow =', globalPaths.length);

function shannonEntropy(s) {
  const m = {};
  for (const c of s) m[c] = (m[c] || 0) + 1;
  let e = 0;
  for (const k in m) { const p = m[k] / s.length; e -= p * Math.log2(p); }
  return e;
}
const containsStopWord = (s) => {
  const low = s.toLowerCase();
  return stopwords.some((w) => low.includes(w.toLowerCase()));
};
const globalPathAllowed = (p) =>
  globalPaths.some((rx) => {
    try { return new RegExp(rx).test(p); } catch { return false; }
  });

// Go 的 regexp 与 JS 基本兼容；把 \x60 保留即可
const RE = new RegExp(regexSrc, 'gi');

// --- 扫描工作区全部 tracked 文件 ---
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const findings = [];
for (const f of files) {
  if (globalPathAllowed(f)) continue;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  // Go 的 (?i) 已在 regexSrc 内
  const r = new RegExp(RE.source, 'gi');
  let m;
  while ((m = r.exec(text)) !== null) {
    const groups = m;
    // SecretGroup = 0 -> 若只有一个捕获组则取它
    let secret = groups.length === 2 ? groups[1] : groups[0];
    if (containsStopWord(secret)) continue;
    const ent = shannonEntropy(secret);
    if (ent <= entropyThreshold) continue;
    // generic* 前缀规则要求 secret 同时含数字与字母
    if (!/[0-9]/.test(secret)) continue;
    findings.push({ file: f, secret: secret.slice(0, 60), entropy: +ent.toFixed(3) });
  }
}

console.log('\n=== 模拟结果：generic-api-key 规则命中', findings.length, '条 ===');
const uniq = new Map();
for (const f of findings) {
  const k = f.file + '|' + f.secret;
  if (!uniq.has(k)) uniq.set(k, f);
}
for (const f of uniq.values()) console.log(`  H=${f.entropy}  ${f.file}  ${JSON.stringify(f.secret)}`);
