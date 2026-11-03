/**
 * 把 E2E 测试中的 page.request.post('/api/xxx', { data: {...} })
 * 改写为 apiPost(page, '/api/xxx', {...}) —— apiPost 会自动附加 CSRF token。
 *
 * 用法: node tools/patch-e2e-csrf.mjs
 * 该脚本是幂等的，可重复运行。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 需要携带 CSRF token 的写接口
const CSRF_APIS = [
  '/api/collections',
  '/api/nodes',
  '/api/replies',
  '/api/topics',
  '/api/settings/profile',
  '/api/settings/password',
  '/api/auth/signin',
  '/api/auth/signup',
  '/api/auth/signout',
];

const FILES = [
  'e2e/auth.spec.ts',
  'e2e/feature.spec.ts',
  'e2e/topic.spec.ts',
  'e2e/security.spec.ts',
  'e2e/security-regression.spec.ts',
];

const ROOT = path.resolve(process.cwd());

/**
 * 找到形如
 *   await page.request.post('/api/x', {
 *     data: { ... },
 *   });
 * 的调用，改写为
 *   await apiPost(page, '/api/x', { ... });
 */
function rewrite(source) {
  let out = source;
  let changed = 0;

  for (const api of CSRF_APIS) {
    // 匹配 page.request.post('<api>', { ... }) —— 逐字符配平花括号
    const needle = `page.request.post('${api}', {`;
    let idx = 0;
    while (true) {
      const at = out.indexOf(needle, idx);
      if (at === -1) break;

      // 找到匹配的右花括号
      const objStart = at + needle.length - 1; // '{' 的位置
      let depth = 0;
      let end = -1;
      for (let i = objStart; i < out.length; i++) {
        const ch = out[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) break;

      let inner = out.slice(objStart + 1, end);

      // 去掉 data: 前缀（只处理第一层）
      inner = inner.replace(/^\s*data:\s*/, '');
      // 去掉尾逗号与换行缩进
      inner = inner.replace(/,\s*$/, '');
      inner = inner.trim();

      const replacement = `apiPost(page, '${api}', ${inner})`;
      // 原调用 page.request.post(api, { ... }) 在对象之后还有一个右括号，
      // 必须一并消费掉，否则替换后会多出一个 ')'。
      let after = end + 1;
      while (after < out.length && /\s/.test(out[after])) after++;
      if (out[after] === ')') after++;
      out = out.slice(0, at) + replacement + out.slice(after);
      idx = at + replacement.length;
      changed++;
    }
  }

  return { out, changed };
}

/** 确保从 ./helpers 导入 apiPost */
function ensureImport(source) {
  if (!source.includes('apiPost(')) return source;
  if (/import \{[^}]*\bapiPost\b[^}]*\} from '\.\/helpers'/.test(source)) return source;
  return source.replace(
    /import \{([^}]*)\} from '\.\/helpers';/,
    (_m, names) => {
      const list = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.includes('apiPost')) list.push('apiPost');
      return `import { ${list.join(', ')} } from './helpers';`;
    },
  );
}

let total = 0;
for (const file of FILES) {
  const full = path.join(ROOT, file);
  let source;
  try {
    source = await readFile(full, 'utf8');
  } catch {
    continue; // 文件不存在
  }
  const { out, changed } = rewrite(source);
  const final = ensureImport(out);
  if (final !== source) {
    await writeFile(full, final, 'utf8');
    console.log(`${file}: 改写 ${changed} 处`);
    total += changed;
  }
}
console.log(`\n✓ 共改写 ${total} 处 API 调用`);
