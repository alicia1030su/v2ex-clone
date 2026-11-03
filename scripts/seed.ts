/**
 * Seed 脚本：写入初始节点分类、节点、用户与主题数据。
 * 使用真实数据库插入，不是内存假数据。
 *
 * 运行: npm run db:seed
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { sql as pgSql } from '../src/db/index';
import { db, schema } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true, override: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

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
  password: string;
  role: 'admin' | 'moderator' | 'user';
};

/**
 * 管理员账号来自环境变量，不再硬编码默认口令。
 *
 * 安全要求：
 *  - 生产环境（APP_RUNTIME_ENV=production 或 NODE_ENV=production）必须显式提供
 *    SEED_ADMIN_PASSWORD，否则直接报错退出，绝不使用弱默认口令。
 *  - 非生产环境若未提供，则生成一次性随机口令并打印到控制台（仅本次运行可见）。
 */
function resolveAdminUser(): SeedUser {
  const username = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@example.com';
  const explicit = process.env.SEED_ADMIN_PASSWORD;

  const isProduction =
    process.env.APP_RUNTIME_ENV === 'production' || process.env.NODE_ENV === 'production';

  if (explicit && explicit.length >= 12) {
    return { username, email, password: explicit, role: 'admin' };
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
  return { username, email, password: generated, role: 'admin' };
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

  const password = process.env.SEED_DEMO_PASSWORD || `demo-${randomBytes(6).toString('base64url')}`;
  if (!process.env.SEED_DEMO_PASSWORD) {
    console.warn(`\n⚠ 演示账号统一口令：${password}（仅本次运行显示）\n`);
  }

  return [
    { username: 'lisi', email: 'lisi@example.com', password, role: 'user' },
    { username: 'wangwu', email: 'wangwu@example.com', password, role: 'user' },
    { username: 'zhaoliu', email: 'zhaoliu@example.com', password, role: 'user' },
    { username: 'moderator', email: 'mod@example.com', password, role: 'moderator' },
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

  // 1. 分类
  const categoryIds = new Map<string, number>();
  for (const [name, title, sort] of CATEGORIES) {
    const existing = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, name))
      .limit(1);
    if (existing[0]) {
      categoryIds.set(name, existing[0].id);
      continue;
    }
    const [row] = await db
      .insert(schema.categories)
      .values({ name, title, sort })
      .returning({ id: schema.categories.id });
    categoryIds.set(name, row.id);
  }
  console.log(`  分类: ${categoryIds.size}`);

  // 2. 用户
  const userIds = new Map<string, number>();
  const seedUsers: SeedUser[] = [resolveAdminUser(), ...resolveDemoUsers()];
  for (const u of seedUsers) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, u.username))
      .limit(1);
    if (existing[0]) {
      // 已存在的账号：同步口令与角色。
      // 否则「改了 SEED_*_PASSWORD 后重跑 seed」不会生效，
      // 环境变量与数据库状态会长期不一致（E2E 登录必然失败）。
      await db
        .update(schema.users)
        .set({ passwordHash: hashPassword(u.password), role: u.role })
        .where(eq(schema.users.id, existing[0].id));
      userIds.set(u.username, existing[0].id);
      continue;
    }
    const [row] = await db
      .insert(schema.users)
      .values({
        username: u.username,
        email: u.email,
        passwordHash: hashPassword(u.password),
        role: u.role,
        balance: 1000,
      })
      .returning({ id: schema.users.id });
    userIds.set(u.username, row.id);
  }
  console.log(`  用户: ${userIds.size}`);

  // 演示账号可能未创建（SEED_DEMO_USERS=0 或生产环境），作者回退到管理员
  const fallbackAuthor = userIds.get('admin')!;
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

    const now = new Date(Date.now() - Math.random() * 6 * 3600 * 1000);
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
    const replyCount = Math.floor(Math.random() * 6) + 1;
    const replyIds: number[] = [];
    for (let i = 0; i < replyCount; i++) {
      const authorName = seedUsers[Math.floor(Math.random() * seedUsers.length)].username;
      const [r] = await db
        .insert(schema.replies)
        .values({
          topicId: topic.id,
          authorId: userIds.get(authorName) ?? fallbackAuthor,
          content: REPLY_SEEDS[Math.floor(Math.random() * REPLY_SEEDS.length)],
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

  console.log('✓ seed 完成');
  await pgSql.end();
}

main().catch(async (err) => {
  console.error('✗ seed 失败:', err);
  await pgSql.end().catch(() => undefined);
  process.exit(1);
});
