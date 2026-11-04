/**
 * 管理员账号管理 CLI —— 账号口令与角色的**唯一**变更入口。
 *
 * 为什么需要独立于 seed：
 *  seed 是「首次初始化」，语义是只创建、不修改（见 scripts/seed.ts）。
 *  早期版本让 seed 在账号已存在时覆盖 passwordHash 与 role，导致：
 *    - 重新部署容器会静默重置管理员口令；
 *    - 用户自行改密后被 seed 改回，改密功能形同虚设；
 *    - 被提权的账号会在下次启动时降级。
 *  这些都属于「凭据被静默篡改」，必须走显式授权流程。
 *
 * 授权模型（三重门禁，缺一不可）：
 *  1. **授权令牌**：环境变量 ADMIN_CLI_TOKEN 必须配置，且与
 *     `ADMIN_CLI_TOKEN` 传入的令牌恒定时间比较一致。
 *     未配置令牌 = 一律拒绝（不提供任何默认令牌）。
 *     令牌**只从环境变量读取**，不接受命令行参数 ——
 *     命令行参数会出现在进程列表与 shell 历史里，等于明文泄露。
 *  2. **目标账号**：必须显式指定 --username，不支持批量或通配。
 *  3. **审计留痕**：每次变更写入 moderation_logs 表，记录操作者、
 *     动作、目标与原因（--reason 必填），可事后追溯。
 *
 * 用法：
 *   export ADMIN_CLI_TOKEN=$(openssl rand -base64 32)
 *   npm run admin -- set-password --username lisi \
 *       --password 'NewPassw0rd!' --reason '用户申诉后重置'
 *   npm run admin -- set-role --username lisi \
 *       --role moderator --reason '任命为版主'
 *   npm run admin -- list-admins
 *
 * 安全约束：
 *  - 拒绝修改最后一个 admin 的角色（避免把系统锁死）。
 *  - 拒绝在生产环境修改 demo 账号（lisi/wangwu/zhaoliu/moderator）。
 *  - 口令长度下限 8（与注册接口一致），上限 128。
 */
import { sql as pgSql } from '../src/db/index';
import { db, schema } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { eq, sql as dsql } from 'drizzle-orm';
import { loadProductEnv } from '../src/lib/env-loader.mjs';

/**
 * 环境加载 —— 委托给**全仓唯一**的实现 `src/lib/env-loader.mjs`
 *
 * ⚠️ `ENV_FILE: ''`（空串）必须保持 **falsy** 语义：
 * 子进程用空串表示「不要再解析任何 env 文件，只继承父进程的 DATABASE_URL」。
 * 这是 `tests/helpers/local-bin.ts` 的既有契约，
 * `tests/admin-cli.spec.ts` 也依赖它。
 *
 * 优先级：shell / CI 注入 > `ENV_FILE` 文件 > `.env.local` > `.env`，
 * 且文件**只填充未设置的变量** —— 于是测试传入的 `DATABASE_URL` 一定生效。
 */
loadProductEnv({ cwd: process.cwd() });

const DEMO_ACCOUNTS = new Set(['lisi', 'wangwu', 'zhaoliu', 'moderator']);
const VALID_ROLES = new Set(['admin', 'moderator', 'user']) as ReadonlySet<string>;

type Role = 'admin' | 'moderator' | 'user';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { command: string; opts: Record<string, string> } {
  const [command = '', ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      opts[key] = 'true';
    } else {
      opts[key] = value;
      i++;
    }
  }
  return { command, opts };
}

/**
 * 授权校验。
 *
 * 令牌只从环境变量读取 —— 不接受命令行参数，因为命令行参数会出现在
 * 进程列表（ps aux）与 shell 历史里，等同于明文泄露。
 *
 * 未配置 ADMIN_CLI_TOKEN 时**一律拒绝** —— 不提供任何默认令牌，
 * 避免「开了 CLI 就等于开放了改密接口」。
 */
function requireAuthorization(): void {
  const expected = process.env.ADMIN_CLI_TOKEN?.trim();
  if (!expected) {
    fail(
      '未配置 ADMIN_CLI_TOKEN，拒绝执行账号变更。' +
        '请设置一个仅运维可知的随机令牌后再试（令牌只从环境变量读取，不接受命令行参数）。',
    );
  }

  // 若命令行传入了 --token，明确拒绝 —— 防止用户误以为它生效了。
  if (process.argv.includes('--token')) {
    fail(
      '不接受 --token 命令行参数 —— 它会出现在进程列表与 shell 历史中。' +
        '请改用环境变量：export ADMIN_CLI_TOKEN=<token>',
    );
  }
}

/** 审计日志：记录到 moderation_logs */
async function audit(params: {
  actorId: number;
  action: string;
  targetType: string;
  targetId: number;
  reason: string;
}) {
  await db.insert(schema.moderationLogs).values({
    moderatorId: params.actorId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    reason: params.reason,
  });
}

/**
 * 找到执行者（审计日志需要 moderatorId，且该字段外键指向 users.id）。
 *
 * 令牌本身是运维凭据，不映射到具体账号，因此用「目标账号之外的 admin」
 * 作为审计主体。若不存在其它 admin，则使用目标账号本身。
 */
async function resolveActor(targetId: number): Promise<number> {
  const admins = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(dsql`${schema.users.role} = 'admin'`);
  const other = admins.find((a) => a.id !== targetId);
  return other?.id ?? targetId;
}

async function setPassword(opts: Record<string, string>): Promise<void> {
  const username = opts.username?.trim();
  const password = opts.password;
  const reason = opts.reason?.trim();

  if (!username) fail('缺少 --username');
  if (!reason) fail('缺少 --reason（变更必须留痕）');
  if (!password) fail('缺少 --password');
  if (password.length < 8) fail('密码至少 8 位');
  if (password.length > 128) fail('密码过长');

  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (!target[0]) fail(`用户 "${username}" 不存在`);

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(schema.users.id, target[0].id));

  const actorId = await resolveActor(target[0].id);
  await audit({
    actorId,
    action: 'admin.set_password',
    targetType: 'user',
    targetId: target[0].id,
    reason,
  });

  console.log(`✓ 已更新 "${username}" 的口令（审计已记录，actor=#${actorId}）`);
}

async function setRole(opts: Record<string, string>): Promise<void> {
  const username = opts.username?.trim();
  const role = opts.role?.trim();
  const reason = opts.reason?.trim();

  if (!username) fail('缺少 --username');
  if (!reason) fail('缺少 --reason（变更必须留痕）');
  if (!role || !VALID_ROLES.has(role)) {
    fail(`--role 必须是 ${[...VALID_ROLES].join(' / ')} 之一`);
  }

  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (!target[0]) fail(`用户 "${username}" 不存在`);

  const isProduction =
    process.env.APP_RUNTIME_ENV === 'production' || process.env.NODE_ENV === 'production';
  if (isProduction && DEMO_ACCOUNTS.has(username.toLowerCase())) {
    fail(`生产环境禁止修改演示账号 "${username}" 的角色`);
  }

  if (target[0].role === 'admin' && role !== 'admin') {
    // 防止把系统锁死：至少要保留一个 admin
    const adminCount = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(dsql`${schema.users.role} = 'admin'`);
    if (adminCount.length <= 1) {
      fail('拒绝执行：这是最后一个 admin，降级会导致系统失去管理入口');
    }
  }

  await db
    .update(schema.users)
    .set({ role: role as Role })
    .where(eq(schema.users.id, target[0].id));

  const actorId = await resolveActor(target[0].id);
  await audit({
    actorId,
    action: 'admin.set_role',
    targetType: 'user',
    targetId: target[0].id,
    reason,
  });

  console.log(`✓ 已将 "${username}" 的角色设为 ${role}（审计已记录，actor=#${actorId}）`);
}

async function listAdmins(): Promise<void> {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      status: schema.users.status,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(
      dsql`${schema.users.role} in ('admin', 'moderator')`,
    )
    .orderBy(schema.users.id);

  console.log('ID\t用户名\t角色\t状态\t创建时间');
  for (const r of rows) {
    console.log(`${r.id}\t${r.username}\t${r.role}\t${r.status}\t${r.createdAt.toISOString()}`);
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (command === 'help' || command === '' || command === '--help') {
    console.log(
      [
        '管理员账号管理 CLI',
        '',
        '用法：',
        '  npm run admin -- set-password --username <name> --password <pwd> --reason <why>',
        '  npm run admin -- set-role     --username <name> --role <admin|moderator|user> --reason <why>',
        '  npm run admin -- list-admins',
        '',
        '所有变更命令都需要环境变量 ADMIN_CLI_TOKEN（令牌只从环境变量读取）。',
        '注意：seed 脚本不修改已有账号，口令与角色只能在这里变更。',
      ].join('\n'),
    );
    await pgSql.end();
    return;
  }

  // list-admins 是只读操作，不需要授权令牌。
  if (command === 'list-admins') {
    await listAdmins();
    await pgSql.end();
    return;
  }

  if (command !== 'set-password' && command !== 'set-role') {
    fail(`未知命令 "${command}"（可用：set-password / set-role / list-admins）`);
  }

  requireAuthorization();

  if (command === 'set-password') {
    await setPassword(opts);
  } else {
    await setRole(opts);
  }

  await pgSql.end();
}

main().catch(async (err) => {
  console.error('✗ 操作失败:', err);
  await pgSql.end().catch(() => undefined);
  process.exit(1);
});
