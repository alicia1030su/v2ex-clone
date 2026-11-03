// 临时：验证 deploy/ 明文口令扫描器的准确率（不入库，仅本地自测）
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || 'deploy';

// 键名允许驼峰/下划线前缀（dbPassword、POSTGRES_PASSWORD、my_secret_key 都要覆盖），
// 但必须「包含」关键字词，且整体是一个合法标识符 —— 避免把散文里的 password 误判。
const KEY_RE = /\b([A-Za-z_][A-Za-z0-9_]*)?(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|credential)([A-Za-z0-9_]*)\s*[:=]\s*(.+)$/i;

// 明确不是「硬编码口令」的写法：变量引用 / 生成器 / 占位符 / 命令
const NON_LITERAL = [
  /^\$/,                 // $VAR / ${VAR} / $(cmd)
  /^\{\{/,               // {{ template }}
  /^<%/,                 // <% erb %>
  /\$\(/,                // 命令替换 $(...)
  /^\s*(docker|psql|redis-cli|grep|cut|sed|awk|pwsh|powershell|node|npm)\b/i,
  /^\s*(Get-|New-|Set-|Write-|Invoke-)/i, // PowerShell cmdlet
  /^\s*(process\.env|os\.environ|env\b)/i,
  /Get-RandomHex/i,
  /openssl/i,
  /randomBytes/i,
  /gen_random_hex/i,
  /crypto\.random/i,
  /CHANGE_ME/i,
  /^\s*$/,
  // 含 ${...} 变量插值的复合值：例如 postgres://user:${PASSWORD}@host/db
  /\$\{/,
  /^\s*\?/,              // compose 的 ${VAR:?message} 片段
];

function shannonEntropy(s) {
  const m = {};
  for (const c of s) m[c] = (m[c] || 0) + 1;
  let e = 0;
  for (const k in m) { const p = m[k] / s.length; e -= p * Math.log2(p); }
  return e;
}

function looksLikeSecret(v) {
  const bare = v.replace(/^["']|["']$/g, '').trim();
  if (bare.length < 12) return false;
  if (!/[A-Za-z]/.test(bare)) return false;
  // 含 shell 管道 / 重定向 / 命令片段的值不是口令，例如
  //   "' .env | cut -d= -f2)\" ping"
  if (/[|><`]|;\s*\w/.test(bare)) return false;
  const hasDigit = /[0-9]/.test(bare);
  const isHex = /^[0-9a-f]{16,}$/i.test(bare);
  const isB64 = /^[A-Za-z0-9+/=_-]{16,}$/.test(bare);
  if (!hasDigit && !isHex && !isB64) return false;
  // 纯英文短语（句子）不算口令
  if (/^[A-Za-z ]+$/.test(bare)) return false;
  return true;
}

function scanFile(abs) {
  const rel = path.relative(process.cwd(), abs);
  const text = fs.readFileSync(abs, 'utf8');
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(KEY_RE);
    if (!m) return;
    let v = m[4].trim();
    // 去掉行尾注释（但不要动 URL 里的 #）
    if (!/^["'].*["']$/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    if (NON_LITERAL.some((re) => re.test(v))) return;
    if (!looksLikeSecret(v)) return;
    out.push({ rel, line: i + 1, value: v.slice(0, 60), entropy: shannonEntropy(v).toFixed(2) });
  });
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'backups') continue; walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}

const findings = [];
for (const f of walk(ROOT)) {
  if (path.basename(f) === '.env') continue;
  findings.push(...scanFile(f));
}

// 自检：扫描器必须能抓到「真口令」，否则它是个永远通过的空壳
const SELF_TEST = 'const dbPassword = "s3cr3t-P@ssw0rd-2026";';
const probe = scanFile.__selfTest
  ? []
  : (() => {
      const m = SELF_TEST.match(KEY_RE);
      if (!m) return [];
      const v = m[4].trim();
      if (NON_LITERAL.some((re) => re.test(v))) return [];
      if (!looksLikeSecret(v)) return [];
      return [{ rel: '<self-test>', line: 1, value: v, entropy: 'x' }];
    })();

console.log('findings in ' + ROOT + ':', findings.length);
for (const f of findings) console.log('  ', f.rel + ':' + f.line, 'H=' + f.entropy, JSON.stringify(f.value));
console.log('self-test caught planted secret:', probe.length === 1 ? 'YES' : 'NO <-- SCANNER BROKEN');
if (probe.length !== 1) process.exitCode = 2;
