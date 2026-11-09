import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { count, eq } from 'drizzle-orm';
import { runDrizzleKit } from './helpers/local-bin';
import { provisionTestDatabase, dropTestDatabase } from './helpers/test-db-lifecycle';
import { adminUrlOf, dbUrlFor, logDbTarget } from './helpers/test-spec-base';
import { editTopic, ContentError } from '../src/lib/content-service';
import type { SessionUser } from '../src/lib/auth';

/**
 * `editTopic()` 空改动分支的**真库**回归（v0.0.14）
 *
 * ## 这个缺陷是怎么来的
 *
 * v0.0.14 允许 `PUT /api/topics/[id]` **只提交 `tags` / `removeTags`**
 * （标签增删是独立语义，用户不该为了删一个标签而重写正文）。
 * 但该路由必须先调 `editTopic()`，因为那是**唯一**的授权 + 编辑时限校验点
 * ——「先写标签再鉴权」会让 403 的请求也改掉标签（v0.0.14 已修的漏洞）。
 *
 * 两条约束叠加的结果是：**只删一个标签也会走一次 `editTopic`，而
 * `title` / `content` 都没变**。修复前 `editTopic` 无条件写入：
 *
 *   · `editCount + 1` —— 用户只是删了个标签，按钮却从「编辑」变成「编辑 (1)」；
 *   · 写一条 `previousTitle === newTitle && previousContent === newContent`
 *     的**空快照** —— 编辑历史（不可变审计表）里出现「一次什么都没改的编辑」；
 *   · `editedAt` / `updatedAt` 被刷新 —— 与「未编辑」的事实矛盾。
 *
 * 这不是权限问题（校验在前面），是**审计表说了假话**。编辑计数与编辑历史
 * 记的是**内容**变更，内容逐字未变就不该记。修复见
 * `src/lib/content-service.ts` 的 `editTopic()` 空改动分支。
 *
 * ## 为什么必须真库
 *
 * 分支的判据是「库内现值 === 请求值」，而 `editCount` / `edit_history` 行数
 * / `editedAt` 都是**库内状态**。纯函数测试只能证明"返回了什么"，
 * 证明不了"库有没有被写" —— 而后者才是缺陷本体。
 *
 * 数据库隔离：专用库 `v2ex_v014_editnoop`，不碰开发库（护栏见
 * `tests/helpers/test-db-guard.ts`）。
 */

const TEST_DB = process.env.V014_EDITNOOP_TEST_DB ?? 'v2ex_v014_editnoop';

process.env.ENV_FILE = '';
process.env.DATABASE_URL = dbUrlFor(TEST_DB);
{
  const g = globalThis as unknown as { __v2exSql?: unknown; __v2exDrizzle?: unknown };
  g.__v2exSql = undefined;
  g.__v2exDrizzle = undefined;
}

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

let nodeId = 0;
let authorId = 0;
/** 会话用户（与 `src/lib/auth.ts` 的 SessionUser 同形） */
let author: SessionUser;

/** 造一篇主题（标题/正文都确定，便于"逐字未变"的判定） */
async function makeTopic(): Promise<{ id: number; title: string; content: string }> {
  const title = `v014 空改动 ${Date.now().toString(36)}`;
  const content = '用于验证「内容没变就不该计数、不该留快照」的正文。';
  const [row] = await db
    .insert(schema.topics)
    .values({ title, content, nodeId, authorId })
    .returning({ id: schema.topics.id });
  return { id: row.id, title, content };
}

/** 读回主题的编辑相关字段（判据只看库，不看返回值） */
async function readEditState(topicId: number) {
  const rows = await db
    .select({
      editCount: schema.topics.editCount,
      editedAt: schema.topics.editedAt,
      updatedAt: schema.topics.updatedAt,
      title: schema.topics.title,
      content: schema.topics.content,
    })
    .from(schema.topics)
    .where(eq(schema.topics.id, topicId))
    .limit(1);
  const historyRows = await db
    .select({ n: count() })
    .from(schema.editHistory)
    .where(eq(schema.editHistory.targetId, topicId));
  return { topic: rows[0], historyCount: Number(historyRows[0]?.n ?? 0) };
}

beforeAll(async () => {
  logDbTarget('tests/v014-edit-noop.spec.ts', TEST_DB);

  await provisionTestDatabase({
    file: 'tests/v014-edit-noop.spec.ts',
    db: TEST_DB,
    adminUrl: adminUrlOf(TEST_DB),
    migrate: () =>
      runDrizzleKit(['migrate'], {
        ...process.env,
        ENV_FILE: '',
        DATABASE_URL: dbUrlFor(TEST_DB),
      }),
  });

  client = postgres(dbUrlFor(TEST_DB), { prepare: false, max: 10 });
  db = drizzle(client, { schema });

  const [cat] = await db
    .insert(schema.categories)
    .values({ name: 'v014noopcat', title: 'V014 空改动分类' })
    .returning({ id: schema.categories.id });

  const [node] = await db
    .insert(schema.nodes)
    .values({ name: 'v014noopnode', title: 'V014 空改动节点', categoryId: cat.id })
    .returning({ id: schema.nodes.id });
  nodeId = node.id;

  const [user] = await db
    .insert(schema.users)
    .values({ username: 'v014noopauthor', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  authorId = user.id;
  author = {
    id: user.id,
    username: 'v014noopauthor',
    role: 'user',
    status: 'active',
    balance: 0,
    avatar: null,
  };
}, 300_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  // 签名是（adminUrl, dbName）—— 顺序写反会得到 `Invalid URL` 而不是护栏报错
  await dropTestDatabase(adminUrlOf(TEST_DB), TEST_DB).catch(() => undefined);
}, 60_000);

beforeEach(() => {
  // 每个用例都从「可编辑窗口内」开始：时限相关行为不在本文件验证
  process.env.TOPIC_EDIT_WINDOW_MINUTES = '60';
});

describe('editTopic：内容逐字未变 ⇒ 不写库、不计数、不留快照', () => {
  it('只改标签（title/content 都不传）后，库里 editCount / edit_history 完全不变', async () => {
    const topic = await makeTopic();
    const before = await readEditState(topic.id);
    expect(before.topic.editCount, '新建主题的初始编辑次数应为 0').toBe(0);
    expect(before.historyCount, '新建主题不应有编辑历史').toBe(0);

    const result = await editTopic(author, topic.id, {});

    const after = await readEditState(topic.id);
    expect(after.topic.editCount, '空改动不得让 editCount 递增').toBe(
      before.topic.editCount,
    );
    expect(after.historyCount, '空改动不得写入 edit_history（审计里不能有假编辑）').toBe(
      before.historyCount,
    );
    expect(after.topic.editedAt, '空改动不得写 editedAt').toEqual(before.topic.editedAt);
    expect(after.topic.updatedAt, '空改动不得刷新 updatedAt（与「未编辑」的事实不符）').toEqual(
      before.topic.updatedAt,
    );

    // 返回值必须是**库内现值**，不能是空字符串之类
    expect(result.title).toBe(topic.title);
    expect(result.content).toBe(topic.content);
    expect(result.editCount).toBe(before.topic.editCount);
  });

  it('把 title/content 原样传回（前端总会带上正文）同样视为空改动', async () => {
    // 真实链路：`TopicEditForm` 每次都提交 `content`（即使只删标签），
    // 且 `title` 只有 staff 才可改。所以"原样传回"是最常见的情形。
    const topic = await makeTopic();
    const result = await editTopic(author, topic.id, {
      title: `  ${topic.title}  `, // 前后空白应被 trim 掉
      content: topic.content,
    });

    const after = await readEditState(topic.id);
    expect(after.topic.editCount, '原样传回不得计数').toBe(0);
    expect(after.historyCount, '原样传回不得留快照').toBe(0);
    expect(result.title, '返回值应已 trim').toBe(topic.title);
  });

  it('真的改了正文 ⇒ 正常计数 + 写一条快照（证明上面的"不写"不是把功能关掉）', async () => {
    const topic = await makeTopic();
    const before = await readEditState(topic.id);

    const result = await editTopic(author, topic.id, { content: `${topic.content}（已补充）` });

    const after = await readEditState(topic.id);
    expect(after.topic.editCount, '真实编辑必须计数').toBe(before.topic.editCount + 1);
    expect(result.editCount).toBe(before.topic.editCount + 1);
    expect(after.historyCount, '真实编辑必须留快照').toBe(before.historyCount + 1);

    const [snapshot] = await db
      .select({
        previousContent: schema.editHistory.previousContent,
        newContent: schema.editHistory.newContent,
      })
      .from(schema.editHistory)
      .where(eq(schema.editHistory.targetId, topic.id))
      .limit(1);
    expect(snapshot.previousContent, '快照必须记录改前内容').toBe(topic.content);
    expect(snapshot.newContent, '快照必须记录改后内容').toBe(`${topic.content}（已补充）`);
  });

  it('只改标题（正文不传）也必须计数并留快照', async () => {
    const topic = await makeTopic();
    const result = await editTopic(author, topic.id, { title: `${topic.title} v2` });

    const after = await readEditState(topic.id);
    expect(after.topic.editCount, '改标题是真实编辑').toBe(1);
    expect(after.historyCount).toBe(1);
    expect(result.title).toBe(`${topic.title} v2`);
    expect(result.content, '未传正文时应保持原值').toBe(topic.content);
  });

  it('空改动分支**不得**绕过授权：他人提交空改动仍必须 403', async () => {
    // 这是本分支最危险的错误实现方式：把"空改动提前返回"写在鉴权**之前**，
    // 于是任何人都能拿 200 探测「主题存在 / 未删除」，且绕过 403。
    const topic = await makeTopic();
    const other: SessionUser = {
      id: authorId + 999, // 一个不存在的 id 也足够触发「不是作者」
      username: 'v014noopother',
      role: 'user',
      status: 'active',
      balance: 0,
      avatar: null,
    };

    await expect(editTopic(other, topic.id, {})).rejects.toBeInstanceOf(ContentError);
    await expect(editTopic(other, topic.id, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('空改动分支**不得**绕过编辑时限：超时后作者提交空改动仍必须 403', async () => {
    const topic = await makeTopic();
    // 把创建时间推到窗口之外（只改这一行，不依赖 sleep）
    await db
      .update(schema.topics)
      .set({ createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000) })
      .where(eq(schema.topics.id, topic.id));

    await expect(editTopic(author, topic.id, {})).rejects.toMatchObject({
      code: 'EDIT_WINDOW_EXCEEDED',
      status: 403,
    });
  });

  it('已软删除的主题仍然 404（空改动分支不能让它"复活"）', async () => {
    const topic = await makeTopic();
    await db
      .update(schema.topics)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(schema.topics.id, topic.id));

    await expect(editTopic(author, topic.id, {})).rejects.toMatchObject({
      code: 'TOPIC_DELETED',
      status: 404,
    });
  });

  it('非法长度仍先于空改动判定（不会被"内容没变"吞掉校验）', async () => {
    const topic = await makeTopic();
    await expect(editTopic(author, topic.id, { title: 'x' })).rejects.toMatchObject({
      code: 'INVALID_TITLE',
      status: 400,
    });
    await expect(editTopic(author, topic.id, { content: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CONTENT',
      status: 400,
    });
  });
});
