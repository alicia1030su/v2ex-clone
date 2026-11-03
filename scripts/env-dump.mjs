/**
 * 把 .env 文件的内容导出为 shell 语句（P0-5）
 *
 * 背景：
 *  src/db/index.ts、drizzle.config.ts、scripts/seed.ts 等文件在加载 ENV_FILE
 *  时使用了 dotenv 的 `override: true` —— 这是上一轮修复 ENV_FILE 失效时
 *  加的（Next.js 会预先加载 .env.local 并占位 DATABASE_URL）。
 *
 *  但这带来一个副作用：一旦设置了 ENV_FILE，`.env.test` 里的 DATABASE_URL
 *  会**覆盖** shell 里显式设置的同名变量。于是 verify.sh 里
 * 「先算出验证库连接串、再 export DATABASE_URL」的做法会失效 ——
 * 迁移与 seed 又跑回了 .env.test 指向的库（可能是开发库）。
 *
 * 解法：
 *  verify.sh 先把 .env.test 的内容**导入当前 shell**，然后清空 ENV_FILE。
 *  这样后续所有工具（drizzle-kit / seed / next start / playwright）
 *  都从 shell 读变量，DATABASE_URL 指向验证库，不会被任何 override 抢走。
 *
 * 用法：
 *   eval "$(node scripts/env-dump.mjs .env.test)"
 *
 * 输出格式：每行 `export KEY='value'`，值经过单引号转义，
 * 因此含空格、$、反引号、分号的值也能安全传递。
 */
import { readFileSync, existsSync } from 'node:fs';

/** shell 单引号转义 */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const file = process.argv[2] ?? '.env.test';

if (!existsSync(file)) {
  // 文件不存在不是错误 —— 调用方自行决定如何处理
  process.exit(0);
}

const content = readFileSync(file, 'utf8');

for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  // 去掉行尾注释（仅当 # 前有空白且不在引号内时）
  let value = '';
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  let rest = line.slice(eq + 1).trim();

  // 去掉行尾注释
  const hashIdx = rest.indexOf(' #');
  if (hashIdx !== -1) rest = rest.slice(0, hashIdx).trim();

  // 去掉成对引号
  if (
    (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) ||
    (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2)
  ) {
    value = rest.slice(1, -1);
  } else {
    value = rest;
  }

  // 只导出合法的环境变量名
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

  console.log(`export ${key}=${shellQuote(value)}`);
}
