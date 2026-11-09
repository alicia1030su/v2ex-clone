/**
 * Seed 脚本：写入初始节点分类、节点、用户与主题数据。
 * 使用真实数据库插入，不是内存假数据。
 *
 * 运行: npm run db:seed
 *
 * 语义（P0-1 / P0-2）：
 *  - **只初始化，不修改**。已存在的账号不会被覆盖口令与角色；
 *    口令与角色的变更只能走 scripts/admin-cli.ts（需授权令牌 + 审计）。
 *  - **首次初始化标记**。脚本会在 kv_store 表写入 initialized 标记，
 *    供容器入口脚本判断「这个库是否已经初始化过」，
 *    从而保证重新部署不会再次写入演示数据、污染用户数据。
 */
import { sql as pgSql } from '../src/db/index';
import { db, schema } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { loadProductEnv } from '../src/lib/env-loader.mjs';

/**
 * 环境加载 —— 委托给**全仓唯一**的实现 `src/lib/env-loader.mjs`
 *
 * ⚠️ 这里**故意不再** `import 'dotenv/config'`：
 * 那条语句会在本模块之前加载仓库根的 `.env`，把 `DATABASE_URL` 抢先占位，
 * 导致 `ENV_FILE` 永远赢不了（这是修复前 `ENV_FILE` 失效的根因之一）。
 *
 * ⚠️ `ENV_FILE: ''`（空串）必须保持 **falsy** 语义：
 * 子进程用空串表示「不要再解析任何 env 文件，只继承父进程的 DATABASE_URL」。
 * 这是 `tests/helpers/local-bin.ts` 的既有契约，
 * `tests/seed-idempotency.spec.ts` 也依赖它。
 *
 * 优先级：shell / CI 注入 > `ENV_FILE` 文件 > `.env.local` > `.env`，
 * 且文件**只填充未设置的变量** —— 于是测试传入的 `DATABASE_URL` 一定生效。
 *
 * 注：本文件同时 `import { ... } from '../src/db/index'`，而那个模块也会调用
 * 同一个加载器 —— 加载器是**幂等**的（进程内只解析一次），重复调用无副作用。
 */
loadProductEnv({ cwd: process.cwd() });

/**
 * v0.0.6：确定性伪随机数（mulberry32）
 *
 * **为什么必须确定性**：任务书 §四.2 要求视觉回归「自动加载**统一**测试数据」。
 * 原先用 `Math.random()` 生成每主题回复数（1~6）、回复作者与内容 ——
 * 实测后果（2026-11-06 首轮 63 组合回归）：
 *   同一主题 /t/1 两次全新 seed 分别得到 **1 条**与 **4 条**回复
 *   ⇒ 页面高度差 ~300px ⇒ **基线对比完全失去意义**
 *   （把「数据变了」误判成「视觉回归」，或反之漏掉真回归）。
 *
 * 改用固定种子的 PRNG 后：同样的库状态 ⇒ 同样的数据 ⇒ 可复现的视觉基线。
 * 口令仍用 `randomBytes`（安全敏感，且由 reset-test-credentials.ts 统一接管）。
 */
const SEED_PRNG_SEED = 0x56455841; // "VEXA"
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED_PRNG_SEED);

/** 首次初始化标记的 key（存放在 kv_store 表） */
export const INIT_MARKER_KEY = 'seed:initialized';

/**
 * 节点树 —— [name, title, categoryName, parentName?]
 * parentName 非空表示是某个节点的子节点
 * （对应原站的节点层级，例如 tech → ev / energy）
 */
const NODES: [string, string, string, string?][] = [
  // [name, title, categoryName, parentName?]
  ['programmer', '程序员', 'tech'],
  ['python', 'Python', 'tech', 'programmer'],
  ['idev', 'iDev', 'tech', 'apple'],
  ['claude', 'Claude', 'tech', 'programmer'],
  ['openai', 'OpenAI', 'tech', 'programmer'],
  ['localllm', 'Local LLM', 'tech', 'programmer'],
  ['cloud', '云计算', 'tech'],
  ['bb', '宽带症候群', 'tech'],
  ['create', '创意', 'create'],
  ['design', '设计', 'create', 'create'],
  ['life', '生活', 'life'],
  ['play', '好玩', 'play'],
  ['apple', 'Apple', 'apple'],
  ['jobs', '酷工作', 'jobs'],
  ['deals', '交易', 'deals'],
  ['city', '城市', 'city'],
  ['qna', '问与答', 'qna'],
  ['tech', '技术', 'tech'],
  ['games', '游戏', 'play'],
  ['hardware', '硬件', 'tech', 'tech'],
  // 子节点（对应原站 tech 节点的 ev / energy 子树）
  ['ev', '电动汽车', 'tech', 'tech'],
  ['energy', '能源', 'tech', 'tech'],
  ['gaming', '游戏硬件', 'tech', 'tech'],
];

const CATEGORIES: [string, string, number][] = [
  ['tech', '技术', 1],
  ['create', '创意', 2],
  ['life', '生活', 3],
  ['play', '好玩', 4],
  ['apple', 'Apple', 5],
  ['jobs', '酷工作', 6],
  ['deals', '交易', 7],
  ['city', '城市', 8],
  ['qna', '问与答', 9],
];

type SeedUser = {
  username: string;
  email: string;
  role: 'admin' | 'moderator' | 'user';
  /**
   * 仅在**需要创建**该账号时才解析口令。
   *
   * 惰性求值是必需的：seed 采用「只初始化、不修改」语义，
   * 已存在的账号不应因为缺少 SEED_ADMIN_PASSWORD 而让脚本失败 ——
   * 生产环境重新部署时通常不会再注入初始口令。
   */
  resolvePassword: () => string;
};

/**
 * 管理员账号的身份来自环境变量；口令只在**创建时**才需要。
 *
 * 安全要求：
 *  - 生产环境（APP_RUNTIME_ENV=production 或 NODE_ENV=production）创建管理员时
 *    必须显式提供 SEED_ADMIN_PASSWORD，否则直接报错退出，绝不使用弱默认口令。
 *  - 非生产环境若未提供，则生成一次性随机口令并打印到控制台（仅本次运行可见）。
 *  - **已存在的管理员不会被修改**，因此不触发口令解析。
 */
function resolveAdminUser(): SeedUser {
  const username = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@example.com';

  return {
    username,
    email,
    role: 'admin',
    resolvePassword: () => {
      const explicit = process.env.SEED_ADMIN_PASSWORD;

      const isProduction =
        process.env.APP_RUNTIME_ENV === 'production' || process.env.NODE_ENV === 'production';

      if (explicit && explicit.length >= 12) {
        return explicit;
      }

      if (explicit && explicit.length > 0) {
        throw new Error(
          'SEED_ADMIN_PASSWORD 长度不足 12 位。请设置一个足够强的管理员密码，或删除该变量让脚本生成随机口令。',
        );
      }

      if (isProduction) {
        throw new Error(
          '生产环境必须显式设置 SEED_ADMIN_PASSWORD（≥12 位）。拒绝使用弱默认口令创建管理员。',
        );
      }

      // 非生产环境：生成一次性随机口令
      const generated = `A9!${randomBytes(12).toString('base64url')}`;
      console.warn(
        `\n⚠ 未设置 SEED_ADMIN_PASSWORD，已为管理员 "${username}" 生成一次性随机口令：\n   ${generated}\n   该口令仅本次运行显示，请立即保存。\n`,
      );
      return generated;
    },
  };
}

/**
 * 演示账号（lisi / wangwu / zhaoliu / moderator）仅在非生产环境创建，
 * 且可用 SEED_DEMO_USERS=0 关闭。所有演示账号使用统一随机口令。
 */
function resolveDemoUsers(): SeedUser[] {
  if (process.env.SEED_DEMO_USERS === '0') return [];

  const isProduction =
    process.env.APP_RUNTIME_ENV === 'production' || process.env.NODE_ENV === 'production';
  if (isProduction) return [];

  const resolvePassword = () => {
    const password = process.env.SEED_DEMO_PASSWORD || `demo-${randomBytes(6).toString('base64url')}`;
    if (!process.env.SEED_DEMO_PASSWORD) {
      console.warn(`\n⚠ 演示账号统一口令：${password}（仅本次运行显示）\n`);
    }
    return password;
  };

  return [
    { username: 'lisi', email: 'lisi@example.com', role: 'user', resolvePassword },
    { username: 'wangwu', email: 'wangwu@example.com', role: 'user', resolvePassword },
    { username: 'zhaoliu', email: 'zhaoliu@example.com', role: 'user', resolvePassword },
    { username: 'moderator', email: 'mod@example.com', role: 'moderator', resolvePassword },
  ];
}

const TOPIC_SEEDS = [
  {
    title: '用 deepseek 的 api+ccswitch 效果怎么样？',
    node: 'claude',
    author: 'lisi',
    content:
      '最近在折腾用 deepseek 的 API 配合 ccswitch 做 Claude Code 的后端，想问下大家实际用下来的效果如何？\n\n主要关心：\n\n- 工具调用是否稳定\n- 长上下文会不会截断\n- 代码补全质量跟官方 Claude 差多少\n\n目前我的体验是工具调用偶尔会有格式问题，补全质量尚可但复杂重构明显吃力。',
  },
  {
    title: '我刚做了两个播客，欢迎大家收听',
    node: 'create',
    author: 'wangwu',
    content:
      '折腾了大半年，终于把两个播客做出来了。\n\n一个是聊独立开发的，一个是聊城市漫步的。\n\n欢迎大家在评论里告诉我你们的想法，或者指出哪里做得不好。',
  },
  {
    title: '有没有 claude 至今没跳 kyc 没封的 V 友，来讲讲做法？',
    node: 'claude',
    author: 'zhaoliu',
    content: '最近看到好多人被封了，想请教一下还有哪些稳定的使用方式？包括账号来源和支付渠道。',
  },
  {
    title: '看到最近群晖被黑，想给 NAS 里的数据做个备份，大家用的什么方案？',
    node: 'life',
    author: 'wangwu',
    content:
      '最近 NAS 被黑的消息不少，想给数据做个备份。\n\n目前考虑的方案：\n\n1. 本地 + 异地双盘\n2. restic 加密备份到对象存储\n3. 快照服务\n\n大家实际用的是什么方案？有没有踩过坑？',
  },
  {
    title: '压缩的尽头是自指？从 LZMA2、PAQ8PX 到 zstd/ZIP/RAR Quine，我折腾了一遍',
    node: 'programmer',
    author: 'lisi',
    content:
      '最近对"自解压"这个方向产生了兴趣，花了些时间研究压缩格式的自指性质。\n\n从 LZMA2 的窗口回绕，到 PAQ8PX 的上下文建模，再到 zstd 的块结构……最后我尝试构造了一个能够自我展开的归档格式。\n\n结论是：理论上可行，但工程上没什么意义。',
  },
  {
    title: '周六/周日还会有重置吗？',
    node: 'openai',
    author: 'zhaoliu',
    content: '今天额度用完了，想确认一下周末是否重置。',
  },
  {
    title: '升级 opencode V2 以后，发现 opencode 已经移除了添加自定义提供商界面',
    node: 'openai',
    author: 'wangwu',
    content:
      '升级之后想添加自定义 provider，发现界面里已经没有了。\n\n翻了 issue 好像是说改用配置文件了？有人知道具体怎么配吗？',
  },
  {
    title: 'Runner 0.19.0 发布：分屏采用 island 布局，提供 Linux 支持',
    node: 'programmer',
    author: 'lisi',
    content:
      '新版本主要变化：\n\n- 分屏布局改为 island 风格\n- 正式支持 Linux\n- 性能优化\n\n欢迎大家试用反馈。',
  },
  {
    title: '_lockSticky 喜提大陆 App Store 下架',
    node: 'apple',
    author: 'zhaoliu',
    content: '今天打开 App Store 发现已经搜不到了，可惜。',
  },
  {
    title: '群晖 NAS 如何防止中勒索软件？',
    node: 'life',
    author: 'lisi',
    content: '除了不直接暴露公网，还有什么实践推荐？快照是不是就够了？',
  },
];

const REPLY_SEEDS = [
  '同问，蹲一个答案。',
  '我自己是用了一段时间的，工具调用确实偶尔不稳定，加个重试就好了。',
  '这个方案我试过，配置在项目根目录的 opencode.json 里，provider 字段改成 openai compatible 就行。',
  '感觉主要看场景，简单任务差别不大，复杂重构确实差不少。',
  '建议先在测试项目里跑跑，看看日志再决定。',
  '感谢分享，正好在找这个。',
  '遇到过类似问题，最后是清缓存重装解决的。',
  '已经加到我的清单里了。',
];

async function main() {
  console.log('▶ 开始 seed');

  // 0. 首次初始化标记检查
  //    若已初始化过，说明这是「重新部署」而非「首次部署」，
  //    此时应当完全跳过，避免写入演示数据污染用户数据。
  const marker = await db
    .select()
    .from(schema.kvStore)
    .where(eq(schema.kvStore.key, INIT_MARKER_KEY))
    .limit(1);
  if (marker[0]?.value === 'true') {
    console.log('  该数据库已完成初始化 —— 跳过 seed（不触碰任何已有数据）');
    console.log('✓ seed 完成（跳过）');
    await pgSql.end();
    return;
  }

  // 1. 分类
  const categoryIds = new Map<string, number>();
  for (const [name, title, sort] of CATEGORIES) {
    // ⚠️ 必须**显式投影**，不能用 `select()` 取全列。
    //
    // `schema.categories` 会随迁移新增列（v0.0.14 加了 `hidden` / `updated_at`），
    // 而本脚本会被 `scripts/release/verify-upgrade-v0010.sh` 用来给**基线库**
    // （v0.0.4 / v0.0.12）灌种子数据 —— 那时 0004 迁移还没跑，基线表里
    // 根本没有这两列。取全列会直接 `42703 column "hidden" does not exist`，
    // 于是「升级验证」在灌数据阶段就红，看起来像升级坏了，实际是种子脚本
    // 用了比基线更新的 schema。
    //
    // 这里只需要 id，按需投影即可与基线 + 当前两套 schema 同时兼容。
    const existing = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.name, name))
      .limit(1);
    if (existing[0]) {
      categoryIds.set(name, existing[0].id);
      continue;
    }
    // ⚠️ 用**原生 SQL 只写基线就有的列**，不要走 drizzle 的 insert。
    //
    // drizzle 会把带 `.default()` 的列（`hidden` / `updated_at`）一起写进
    // INSERT 的列清单，于是对**基线库**（还没跑 0004）执行时直接
    // `42703 column "hidden" of relation "categories" does not exist`。
    // 显式列出 name/title/sort 三列，对基线与当前两套 schema 都成立；
    // `hidden` / `updated_at` 由列默认值补齐（false / now()）。
    await db.execute(
      sql`insert into categories (name, title, sort) values (${name}, ${title}, ${sort})`,
    );
    const [row] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.name, name))
      .limit(1);
    if (!row) throw new Error(`seed: 分类 ${name} 写入后回查失败`);
    categoryIds.set(name, row.id);
  }
  console.log(`  分类: ${categoryIds.size}`);

  // 2. 用户
  const userIds = new Map<string, number>();
  /** 已存在、因而**未被修改**的账号名 */
  const skippedUsers: string[] = [];
  const seedUsers: SeedUser[] = [resolveAdminUser(), ...resolveDemoUsers()];
  for (const u of seedUsers) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, u.username))
      .limit(1);
    if (existing[0]) {
      // 已存在的账号：**只读取，不修改**。
      //
      // 安全要求：seed 是「首次初始化」，不是「状态同步」。
      // 早期版本会在此处覆盖 passwordHash 与 role，导致：
      //   1. 重新部署容器时管理员口令被环境变量重置 —— 属于凭据被静默篡改；
      //   2. 用户自行改密后被 seed 改回 —— 改密功能形同虚设；
      //   3. 任何被提权为 admin 的账号会在下次启动时降级回 user。
      //
      // 口令与角色的变更只能走独立的授权流程：scripts/admin-cli.ts
      // （需要显式授权令牌 + 审计日志）。
      userIds.set(u.username, existing[0].id);
      skippedUsers.push(u.username);
      continue;
    }
    const [row] = await db
      .insert(schema.users)
      .values({
        username: u.username,
        email: u.email,
        passwordHash: hashPassword(u.resolvePassword()),
        role: u.role,
        balance: 1000,
      })
      .returning({ id: schema.users.id });
    userIds.set(u.username, row.id);
  }
  console.log(`  用户: ${userIds.size}`);
  if (skippedUsers.length > 0) {
    console.log(`  已存在未修改: ${skippedUsers.join(', ')}`);
    console.log(
      '  （seed 不会覆盖已有账号的口令与角色；变更请用 npm run admin -- <子命令>）',
    );
  }

  // 演示账号可能未创建（SEED_DEMO_USERS=0 或生产环境），作者回退到管理员。
  //
  // 注意：必须用**实际的管理员用户名**，不能写死 'admin'。
  // 管理员名来自 SEED_ADMIN_USERNAME，写死会导致管理员改名后
  // fallbackAuthor 变成 undefined，进而触发 topics.author_id 的 NOT NULL 违约。
  const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const fallbackAuthor = userIds.get(adminUsername);
  if (fallbackAuthor === undefined) {
    throw new Error(
      `管理员账号 "${adminUsername}" 未能解析到 user id —— ` +
        'seed 无法确定主题作者。请确认该账号是否已存在，以及 SEED_ADMIN_USERNAME 是否与实际一致。',
    );
  }
  const authorIdOf = (name: string): number => userIds.get(name) ?? fallbackAuthor;

  // 3. 节点
  const nodeIds = new Map<string, number>();
  for (const [name, title, categoryName, parentName] of NODES) {
    const existing = await db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.name, name))
      .limit(1);
    if (existing[0]) {
      nodeIds.set(name, existing[0].id);
      continue;
    }
    const [row] = await db
      .insert(schema.nodes)
      .values({
        name,
        title,
        categoryId: categoryIds.get(categoryName),
        parentId: parentName ? (nodeIds.get(parentName) ?? null) : null,
        createdBy: fallbackAuthor,
      })
      .returning({ id: schema.nodes.id });
    nodeIds.set(name, row.id);
  }
  console.log(`  节点: ${nodeIds.size}`);

  // 4. 主题
  let topicCount = 0;
  for (const t of TOPIC_SEEDS) {
    const exists = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.title, t.title))
      .limit(1);
    if (exists[0]) continue;

    // v0.0.6：时间锚点固定为「seed 运行时刻」——
    // 用 Date.now() 本身没问题（相对时间文本「N 分钟前」在同一次运行内自洽），
    // 但为了让**两次全新 seed 的视觉基线可逐像素复现**，
    // 这里把基准锚定到一个**固定时刻**（可被 SEED_TIME_ANCHOR 覆盖）。
    const anchor = process.env.SEED_TIME_ANCHOR
      ? new Date(process.env.SEED_TIME_ANCHOR).getTime()
      : Date.now();
    const now = new Date(anchor - rand() * 6 * 3600 * 1000);
    const [topic] = await db
      .insert(schema.topics)
      .values({
        title: t.title,
        content: t.content,
        nodeId: nodeIds.get(t.node)!,
        authorId: authorIdOf(t.author),
        createdAt: now,
        lastReplyAt: now,
      })
      .returning({ id: schema.topics.id });
    topicCount++;

    // 回复
    const replyCount = Math.floor(rand() * 6) + 1;
    const replyIds: number[] = [];
    for (let i = 0; i < replyCount; i++) {
      const authorName = seedUsers[Math.floor(rand() * seedUsers.length)].username;
      const [r] = await db
        .insert(schema.replies)
        .values({
          topicId: topic.id,
          authorId: userIds.get(authorName) ?? fallbackAuthor,
          content: REPLY_SEEDS[Math.floor(rand() * REPLY_SEEDS.length)],
          floor: i + 1,
          createdAt: new Date(now.getTime() + (i + 1) * 60000),
        })
        .returning({ id: schema.replies.id });
      replyIds.push(r.id);
    }

    await db
      .update(schema.topics)
      .set({ repliesCount: replyCount, lastReplyAt: new Date(now.getTime() + replyCount * 60000) })
      .where(eq(schema.topics.id, topic.id));

    // 同步楼层计数表 —— seed 写的是固定楼层（1..N），
    // 不同步的话计数表会停留在 0，后续回复分配到的楼层号
    // 会与已存在的回复撞上（replies_topic_floor_uidx 唯一索引冲突 → 500）。
    await db
      .insert(schema.floorCounters)
      .values({ topicId: topic.id, lastFloor: replyCount })
      .onConflictDoUpdate({
        target: schema.floorCounters.topicId,
        set: { lastFloor: replyCount },
      });

    await db
      .update(schema.nodes)
      .set({ topicsCount: 1 })
      .where(eq(schema.nodes.id, nodeIds.get(t.node)!));
  }
  console.log(`  主题: ${topicCount}`);

  // 5. 收藏关系（便于测试收藏功能）
  const lisiId = userIds.get('lisi') ?? fallbackAuthor;
  const firstTopic = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .limit(3);
  for (const t of firstTopic) {
    await db
      .insert(schema.collections)
      .values({ userId: lisiId, target: 'topic', topicId: t.id })
      .onConflictDoNothing();
  }

  // 6. 节点收藏
  await db
    .insert(schema.collections)
    .values({ userId: lisiId, target: 'node', nodeId: nodeIds.get('programmer')! })
    .onConflictDoNothing();

  // 7. 写入首次初始化标记
  //    放在最后：只有前面的数据都成功写入后才打标记。
  //    若中途失败，下次启动会重新执行 seed；因所有写入都是幂等的，
  //    重跑不会产生重复数据。
  await db
    .insert(schema.kvStore)
    .values({ key: INIT_MARKER_KEY, value: 'true' })
    .onConflictDoUpdate({
      target: schema.kvStore.key,
      set: { value: 'true' },
    });

  console.log('✓ seed 完成');
  await pgSql.end();
}

main().catch(async (err) => {
  console.error('✗ seed 失败:', err);
  await pgSql.end().catch(() => undefined);
  process.exit(1);
});
