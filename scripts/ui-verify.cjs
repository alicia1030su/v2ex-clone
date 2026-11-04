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

/** 收集前端的所有 fetch / csrfFetch 调用 */
const calls = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel.startsWith('src/app/api/')) continue; // 排除后端自身
  const src = fs.readFileSync(f, 'utf8');
  const re = /(csrfFetch|fetch)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let mm;
  while ((mm = re.exec(src))) {
    const fn = mm[1];
    const url = mm[2];
    // 推断方法：取 fetch( 之后到 URL 之前/之后的 method
    const tail = src.slice(mm.index, mm.index + 400);
    const methodMatch = tail.match(/method:\s*'(\w+)'/);
    const method = methodMatch ? methodMatch[1] : 'GET';
    calls.push({ file: rel, fn, method, url });
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
  console.log(`  ${m.method} ${m.url}`);
  console.log(`     来自 ${m.file}`);
}
process.exit(1);
