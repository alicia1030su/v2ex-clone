#!/usr/bin/env node
/**
 * v0.0.18 P1-2：当前源码路由清单
 *
 * 只读枚举 src/app 下的 page.tsx / route.ts，不执行应用、不连接数据库。
 * 权限列为静态启发式提示，不是授权证明；最终仍需阅读守卫与运行负向测试。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function routeFromFile(root, file) {
  const relative = path.relative(path.join(root, 'src/app'), file).split(path.sep).join('/');
  const segments = relative.split('/').slice(0, -1).filter((segment) =>
    !(segment.startsWith('(') && segment.endsWith(')')) && !segment.startsWith('_'));
  const route = `/${segments.map((segment) => {
    if (segment.startsWith('[[...') && segment.endsWith(']]')) return `*${segment.slice(5, -2)}?`;
    if (segment.startsWith('[...') && segment.endsWith(']')) return `*${segment.slice(4, -1)}`;
    if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`;
    return segment;
  }).join('/')}`.replace(/\/$/, '') || '/';
  return { route, source: `src/app/${relative}` };
}

function methodsOf(source) {
  const methods = new Set();
  for (const method of HTTP_METHODS) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`).test(source)
      || new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source)) methods.add(method);
  }
  return [...methods];
}

function permissionHint(source, kind) {
  const markers = [];
  if (/adminGuard\s*\(/.test(source)) markers.push('adminGuard');
  if (/getSessionUser\s*\(/.test(source)) markers.push('getSessionUser');
  if (/guardCsrf\s*\(/.test(source)) markers.push('guardCsrf');
  if (/guardCommunityAction\s*\(/.test(source)) markers.push('community-rate-limit');
  if (/rateLimit(?:ByUser)?\s*\(/.test(source)) markers.push('rate-limit');
  if (/canReviewHiddenNodes\s*\(/.test(source)) markers.push('hidden-node-review');
  const permissionMatch = source.match(/adminGuard\s*\([^,]+,\s*['"]([^'"]+)['"]/);
  if (markers.includes('adminGuard')) return { hint: 'admin', markers, permission: permissionMatch?.[1] ?? null };
  const requiresLogin = /if\s*\(\s*!\s*(?:user|viewer|currentUser)\s*\)/.test(source)
    && /(?:redirect\s*\(|status\s*:\s*401|status\s*:\s*403)/.test(source);
  if (requiresLogin) return { hint: 'authenticated', markers, permission: null };
  if (markers.includes('getSessionUser')) return { hint: kind === 'page' ? 'public-optional-session' : 'mixed', markers, permission: null };
  return { hint: 'public', markers, permission: null };
}

function documented(route, source, pageInventory, apiSpec) {
  const normalize = (value) => value.replace(/\r\n/g, '\n');
  const page = normalize(pageInventory);
  const api = normalize(apiSpec);
  const dynamicPattern = route
    .replace(/:[^/]+/g, '\\[[^\\]]+\\]')
    .replace(/\*[^/?]+\?/g, '\\[\\[\\.\\.\\.[^\\]]+\\]\\]')
    .replace(/\*[^/]+/g, '\\[\\.\\.\\.[^\\]]+\\]');
  const nextStyleRoute = route
    .replace(/:[^/]+/g, (segment) => `[${segment.slice(1)}]`)
    .replace(/\*([^/?]+)\?/g, '[[...$1]]')
    .replace(/\*([^/]+)/g, '[...$1]');
  const routeMention = route === '/' ? api.includes('`/`') : api.includes(route) || api.includes(nextStyleRoute) || new RegExp(dynamicPattern).test(api);
  return {
    pageInventory: page.includes(source) || page.includes(route) || page.includes(nextStyleRoute),
    apiSpec: routeMention || api.includes(source),
  };
}

export function enumerateRoutes(root = ROOT) {
  const appDir = path.join(root, 'src/app');
  const pageInventory = readFileSync(path.join(root, 'docs/PAGE_INVENTORY.md'), 'utf8');
  const apiSpec = readFileSync(path.join(root, 'docs/API_SPEC.md'), 'utf8');
  const files = walk(appDir).filter((file) => ['page.tsx', 'page.ts', 'route.ts', 'route.tsx'].includes(path.basename(file)));
  const pages = [];
  const apis = [];
  for (const file of files) {
    const relativeParts = path.relative(appDir, file).split(path.sep);
    // Next.js 下划线开头目录是私有实现目录，不参与路由；必须排除文件本身，
    // 而不是只把 URL 片段剥掉（否则 _private/page.tsx 会冒充根路由）。
    if (relativeParts.slice(0, -1).some((segment) => segment.startsWith('_'))) continue;
    const { route, source } = routeFromFile(root, file);
    const content = readFileSync(file, 'utf8');
    const docs = documented(route, source, pageInventory, apiSpec);
    if (path.basename(file).startsWith('page.')) {
      pages.push({ route, source, kind: 'page', ...permissionHint(content, 'page'), ...docs });
    } else {
      apis.push({ route, source, kind: 'api', methods: methodsOf(content), ...permissionHint(content, 'api'), ...docs });
    }
  }
  pages.sort((a, b) => a.route.localeCompare(b.route));
  apis.sort((a, b) => a.route.localeCompare(b.route));
  return {
    schema: 'v2ex-clone-route-inventory/v1',
    generatedFrom: 'src/app',
    counts: { pages: pages.length, apis: apis.length, apiMethods: apis.reduce((n, api) => n + api.methods.length, 0) },
    permissionDisclaimer: '静态启发式；不替代守卫阅读、权限矩阵或运行负向测试。',
    pages,
    apis,
  };
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function toMarkdown(inventory) {
  const lines = [
    '# 当前源码路由清单',
    '',
    `页面：${inventory.counts.pages}；API 路由：${inventory.counts.apis}；HTTP 方法：${inventory.counts.apiMethods}。`,
    '',
    '> 权限列为静态启发式提示，不是授权证明。',
    '',
    '## 页面',
    '',
    '| 路由 | 权限提示 | PAGE_INVENTORY | 源码 |',
    '|---|---|---|---|',
  ];
  for (const page of inventory.pages) {
    lines.push(`| \`${escapeCell(page.route)}\` | ${page.hint} | ${page.pageInventory ? '是' : '否'} | \`${escapeCell(page.source)}\` |`);
  }
  lines.push('', '## API', '', '| 路由 | 方法 | 权限提示 | 权限点 | API_SPEC | 源码 |', '|---|---|---|---|---|---|');
  for (const api of inventory.apis) {
    lines.push(`| \`${escapeCell(api.route)}\` | ${api.methods.join(', ') || '未识别'} | ${api.hint} | ${api.permission ?? '-'} | ${api.apiSpec ? '是' : '否'} | \`${escapeCell(api.source)}\` |`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  let format = 'json';
  let out = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format' && ['json', 'markdown'].includes(argv[i + 1])) { format = argv[++i]; continue; }
    if (argv[i] === '--out' && argv[i + 1]) { out = argv[++i]; continue; }
    throw new Error(`未知或无效参数：${argv[i]}`);
  }
  return { format, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const { format, out } = parseArgs(process.argv.slice(2));
    const inventory = enumerateRoutes();
    const content = format === 'markdown' ? toMarkdown(inventory) : `${JSON.stringify(inventory, null, 2)}\n`;
    if (out) writeFileSync(path.resolve(out), content, 'utf8');
    else process.stdout.write(content);
  } catch (error) {
    console.error(`路由枚举失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
