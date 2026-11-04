/**
 * 校验：前端组件里所有写死的 API 路径是否都有对应的后端路由。
 *
 * 背景：任务说明里写的端点清单与后端实际挂载的路由并不完全一致
 * （例如「标记已读」写成 POST /api/notifications/read，
 *   但实际只有 POST /api/notifications）。这个脚本把这类偏差自动找出来。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 递归收集所有源文件 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

/** 收集后端已挂载的路由：method + 路径 */
const routes = new Set();
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const m = rel.match(/^src\/app\/api\/(.+)\/route\.(ts|tsx)$/);
  if (!m) continue;
  const segs = m[1].split('/');
  let route = '/api/' + segs.map((s) => (s.startsWith('[') ? s : s)).join('/');
  // Next 的动态段 [id] 匹配任意单段
  route = route.replace(/\[\.\.\.(\w+)\]/g, '*').replace(/\[(\w+)\]/g, '*');
  const src = fs.readFileSync(f, 'utf8');
  for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    if (new RegExp(`export\\s+async\\s+function\\s+${verb}\\b`).test(src)) {
      routes.add(`${verb} ${route}`);
    }
  }
}

/** 把前端调用里的模板串 / 动态段归一化 */
function normalize(p) {
  return p
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/\?.*$/, '')
    .replace(/\[(\w+)\]/g, '*');
}

/**
 * 判断一行是否为注释。
 *
 * 必须排除注释 —— 组件文件头常有「API 清单」注释表格，
 * 里面的 URL 字符串不是真实调用，误判会让校验长期误报
 * （CI 上曾因此把 `/api/admin/logs?action=&targetType=&targetId=` 当成真实调用）。
 */
function isCommentLine(line) {
  const t = line.trim();
  if (!t) return true;
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('*/') ||
    t.startsWith('<!--')
  );
}

/** 收集前端的所有 fetch / csrfFetch 调用（跳过注释行） */
const calls = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel.startsWith('src/app/api/')) continue; // 排除后端自身
  const src = fs.readFileSync(f, 'utf8');

  // 逐行扫描 —— 跳过注释行
  const lines = src.split('\n');
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (isCommentLine(line)) continue;

    const re = /(csrfFetch|fetch)\(\s*[`'"]([^`'"]+)[`'"]/g;
    let mm;
    while ((mm = re.exec(line)) !== null) {
      const fn = mm[1];
      const url = mm[2];
      // 推断方法：取 fetch( 之后的 400 字符内的 method
      const tail = src.slice(lineStart + mm.index, lineStart + mm.index + 400);
      const methodMatch = tail.match(/method:\s*['"](\w+)['"]/);
      const method = methodMatch ? methodMatch[1] : 'GET';
      calls.push({ file: rel, fn, method, url });
    }
  }
}

console.log(`后端路由数：${routes.size}`);
console.log(`前端调用数：${calls.length}\n`);

const missing = [];
for (const c of calls) {
  const n = normalize(c.url);
  if (!n.startsWith('/api/')) continue;
  // 静态匹配：把 * 当通配
  const pattern = new RegExp(
    '^' + n.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$',
  );
  const hit = [...routes].some((r) => {
    const [verb, p] = r.split(' ');
    if (verb !== c.method) return false;
    const rp = p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
    return new RegExp('^' + rp + '$').test(n);
  });
  if (!hit) missing.push(c);
}

if (missing.length === 0) {
  console.log('✓ 所有前端 API 调用都能匹配到后端路由');
  process.exit(0);
}

console.log(`✗ ${missing.length} 个前端调用没有对应的后端路由：\n`);
for (const m of missing) {
  // 报告归一化后的路径 —— 原始模板串里的 ${...} 对读者没有意义
  console.log(`  ${m.method} ${normalize(m.url)}`);
  console.log(`     来自 ${m.file}`);
  if (m.url !== normalize(m.url)) {
    console.log(`     原始：${m.url}`);
  }
}
process.exit(1);
