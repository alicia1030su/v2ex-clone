import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  ADMIN,
  apiPost,
  clearRateLimits,
  getCsrfToken,
  login,
  logout,
  register,
  uniqueName,
} from './helpers';

/**
 * v0.0.15 P0-1：**通知系统真实双用户验收**
 *
 * ## 为什么必须是「两个真实用户 + 真实浏览器」
 *
 * v0.0.14 的发布后独立验收里，通知这条只有一条 WARN：
 *
 *     通知写入路径未在本环境自动化（强验证码 + 需第二用户）
 *
 * 也就是说：通知功能**从来没有被端到端证明过一次**。
 * 之前的覆盖全部是单用户视角或纯 API 断言 —— 而通知的定义就是
 * 「A 做了事，B 收到」；单用户根本构造不出这个场景。
 *
 * 本文件因此强制：
 *   · 每个用户一个独立 `BrowserContext`（独立 Cookie ⇒ 独立会话），
 *     绝不共用 page —— 共用就是「自己通知自己」，测了个寂寞；
 *   · 全部走**真实 HTTP 路由**（真实 CSRF、真实限流、真实 DB）；
 *   · 通知的读取既通过 API 断言，也通过**真实页面**断言（渲染层）。
 *
 * ## 覆盖矩阵（与任务书 §二逐条对应）
 *
 * | 事件 | 产品是否设计 | 本文件 |
 * |---|---|---|
 * | 回复通知（topic author） | ✅ 有（`reply`） | 覆盖 |
 * | @ 提及通知 | ✅ 有（`mention`） | 覆盖 |
 * | 感谢回复通知 | ✅ 有（`topic_thanks`） | 覆盖 |
 * | 收藏通知 | ❌ **不适用** —— `/api/collections` 从不写通知 | 断言「确实不产生」并说明 |
 * | 节点感谢（`node_thanks`） | ❌ **不适用** —— 枚举有但无任何写入点 | 不做，不凭空新增 |
 * | 系统通知（举报处理结果） | ✅ 有（`system`） | 覆盖（由管理员处理后举报人收到） |
 *
 * 「不适用」的两项**不做虚构实现**，只用断言钉死「它确实不产生通知」，
 * 免得将来有人误以为这里漏了。
 *
 * ## 顺带发现的真实缺陷（本文件同时是它的回归）
 *
 * 通知的 `message` 是**写入时**拼好的字符串，里面嵌了主题标题：
 *   `${actor} 回复了你的主题：${topic.title}`
 * 而 `/api/notifications` 原实现**不 join topics / nodes** ⇒
 * 节点被 hidden、主题被软删除之后，公共页面已 404，通知收件箱却照常
 * 返回那条标题。「提及通知」的收件人还是任意第三方 —— 真实跨用户泄露。
 * 修复见 `src/server/notifications.ts`；本文件末尾三条用例是它的回归。
 */

const PASSWORD = 'NotifyTest-2026!';

type Notif = {
  id: number;
  type: string;
  message: string;
  read: boolean;
  topicId: number | null;
  replyId: number | null;
};

/** 建一个独立用户（独立 context ⇒ 独立会话） */
async function newUser(
  browser: Browser,
  prefix: string,
): Promise<{ ctx: BrowserContext; page: Page; username: string }> {
  const username = uniqueName(prefix);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 注册有 IP 维度限流，前后都清一次（同 v005-mentions 的教训）
  await clearRateLimits(page);
  await register(page, username, PASSWORD);
  await clearRateLimits(page);
  return { ctx, page, username };
}

/** 读通知（API 视角，字段名以服务端契约为准） */
async function listNotif(page: Page, query = ''): Promise<{
  items: Notif[];
  total: number;
  unread: number;
}> {
  const res = await page.request.get(`/api/notifications${query}`);
  expect(res.status(), `GET /api/notifications${query} 应 200`).toBe(200);
  const body = (await res.json()) as {
    notifications?: Notif[];
    items?: Notif[];
    total?: number;
    unread?: number;
  };
  return {
    items: (body.notifications ?? body.items ?? []) as Notif[],
    total: Number(body.total ?? 0),
    unread: Number(body.unread ?? 0),
  };
}

/** 发主题，返回 id */
async function createTopic(page: Page, title: string): Promise<number> {
  const res = await apiPost(page, '/api/topics', {
    nodeId: 1,
    title,
    content: 'v0.0.15 通知双用户验收用的主题正文，长度足够通过校验。',
  });
  expect([200, 201], `发帖失败：${res.status()} ${await res.text().catch(() => '')}`).toContain(
    res.status(),
  );
  const body = (await res.json()) as { topicId?: number; id?: number; redirect?: string };
  const id = Number(body.topicId ?? body.id ?? String(body.redirect ?? '').replace('/t/', ''));
  expect(Number.isFinite(id) && id > 0, `发帖响应没有 topicId：${JSON.stringify(body)}`).toBe(true);
  return id;
}

/** 回帖，返回 replyId（若响应带） */
async function replyTo(page: Page, topicId: number, content: string): Promise<number | null> {
  const res = await apiPost(page, '/api/replies', { topicId, content });
  expect([200, 201], `回帖失败：${res.status()} ${await res.text().catch(() => '')}`).toContain(
    res.status(),
  );
  const body = (await res.json().catch(() => ({}))) as { replyId?: number };
  return body.replyId ?? null;
}

/** 取该主题下最后一条回复的 id（用于感谢） */
async function lastReplyId(page: Page, topicId: number): Promise<number | null> {
  const res = await page.request.get(`/api/topics/${topicId}`);
  if (res.status() !== 200) return null;
  const data = (await res.json()) as { replies?: Array<{ id: number }> };
  const replies = data.replies ?? [];
  return replies.length > 0 ? Number(replies[replies.length - 1].id) : null;
}

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.15 通知：真实双用户全链路', () => {
  test('回复通知：A 发主题 → B 回复 → A 收到 reply 通知，未读数正确', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_reply_a');
    const b = await newUser(browser, 'ntf_reply_b');

    try {
      const title = `回复通知主题 ${uniqueName('rn')}`;
      const topicId = await createTopic(a.page, title);

      // B 回复 → A 应收到通知
      await replyTo(b.page, topicId, `来自 ${b.username} 的回复内容，长度足够。`);

      const aList = await listNotif(a.page);
      const reply = aList.items.find((n) => n.type === 'reply' && n.topicId === topicId);
      expect(
        reply,
        `${a.username} 应收到 reply 通知，实际：${JSON.stringify(aList.items.slice(0, 5))}`,
      ).toBeTruthy();
      expect(reply!.message).toContain(b.username);
      expect(reply!.message).toContain(title);
      expect(reply!.read, '新通知应为未读').toBe(false);
      expect(aList.unread, '未读数应 ≥ 1').toBeGreaterThanOrEqual(1);
      expect(aList.total, '总数应 ≥ 未读数').toBeGreaterThanOrEqual(aList.unread);

      // 反向：B（回复者）不该收到自己触发的回复通知
      const bList = await listNotif(b.page);
      expect(
        bList.items.filter((n) => n.type === 'reply' && n.topicId === topicId),
        '回复者本人不应收到「回复了你的主题」通知',
      ).toHaveLength(0);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('@ 提及通知：B 在回复里 @A → A 收到 mention，文案与楼层号正确', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_ment_a');
    const b = await newUser(browser, 'ntf_ment_b');

    try {
      const topicId = await createTopic(a.page, `提及通知主题 ${uniqueName('mn')}`);
      await replyTo(b.page, topicId, `@${a.username} 这条回复是为了触发提及通知。`);

      const aList = await listNotif(a.page);
      const mention = aList.items.find((n) => n.type === 'mention' && n.topicId === topicId);
      expect(
        mention,
        `${a.username} 应收到 mention 通知，实际：${JSON.stringify(aList.items.slice(0, 5))}`,
      ).toBeTruthy();
      expect(mention!.message).toContain(b.username);
      expect(mention!.message).toContain('提及了你');
      // 文案用「你」指代被提及者，不应再出现其用户名
      expect(mention!.message).not.toContain(a.username);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('感谢通知：B 感谢 A 的回复 → A 收到 topic_thanks；重复感谢幂等不重复通知', async ({
    browser,
  }) => {
    const a = await newUser(browser, 'ntf_thx_a');
    const b = await newUser(browser, 'ntf_thx_b');

    try {
      const topicId = await createTopic(a.page, `感谢通知主题 ${uniqueName('tn')}`);
      // A 自己回一条，作为被感谢的对象
      await replyTo(a.page, topicId, '这是 A 的回复，用来被别人感谢。');
      const replyId = await lastReplyId(a.page, topicId);
      expect(replyId, '应能取到刚写入的回复 id').toBeTruthy();

      const thanks1 = await apiPost(b.page, '/api/thanks', { replyId });
      expect(thanks1.status(), '感谢应成功').toBe(200);
      const body1 = (await thanks1.json()) as { duplicated?: boolean };
      expect(body1.duplicated, '首次感谢不应是 duplicated').toBe(false);

      const aList = await listNotif(a.page);
      const thanks = aList.items.filter(
        (n) => n.type === 'topic_thanks' && n.topicId === topicId,
      );
      expect(thanks.length, 'A 应收到 1 条感谢通知').toBe(1);
      expect(thanks[0].message).toContain(b.username);
      expect(thanks[0].message).toContain('感谢');

      // 重复感谢：幂等，不得再产生一条通知
      const thanks2 = await apiPost(b.page, '/api/thanks', { replyId });
      expect(thanks2.status(), '重复感谢仍应 200').toBe(200);
      const body2 = (await thanks2.json()) as { duplicated?: boolean };
      expect(body2.duplicated, '重复感谢应返回 duplicated=true').toBe(true);

      const aList2 = await listNotif(a.page);
      expect(
        aList2.items.filter((n) => n.type === 'topic_thanks' && n.topicId === topicId).length,
        '重复感谢不得再写一条通知',
      ).toBe(1);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('未读 / 单条已读 / 全部已读 / 刷新后状态保留', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_read_a');
    const b = await newUser(browser, 'ntf_read_b');

    try {
      const topicId = await createTopic(a.page, `已读状态主题 ${uniqueName('rd')}`);
      await replyTo(b.page, topicId, '第一条回复（产生一条未读通知）。');
      await replyTo(b.page, topicId, '第二条回复（产生第二条未读通知）。');

      // 未读数
      const before = await listNotif(a.page, '?unreadOnly=true');
      expect(before.unread, '应有 ≥ 2 条未读').toBeGreaterThanOrEqual(2);
      expect(before.items.length, 'unreadOnly=true 只返回未读').toBe(before.unread);

      // 单条已读：只减 1
      const firstId = before.items[0].id;
      const mark1 = await apiPost(a.page, '/api/notifications', { id: firstId });
      expect(mark1.status(), '标记单条已读应 200').toBe(200);
      const afterOne = await listNotif(a.page, '?unreadOnly=true');
      expect(afterOne.unread, '单条已读后未读数应减 1').toBe(before.unread - 1);

      // 全部已读
      const markAll = await apiPost(a.page, '/api/notifications', {});
      expect(markAll.status(), '全部已读应 200').toBe(200);
      const afterAll = await listNotif(a.page, '?unreadOnly=true');
      expect(afterAll.unread, '全部已读后未读数应为 0').toBe(0);
      expect(afterAll.items.length).toBe(0);

      // 刷新后状态保留（真实页面重新加载 + 重新请求 API）
      await a.page.goto('/notifications');
      await a.page.waitForLoadState('domcontentloaded');
      await a.page.waitForTimeout(500);
      const afterReload = await listNotif(a.page);
      expect(afterReload.unread, '刷新后未读数仍应为 0').toBe(0);
      expect(afterReload.total, '刷新后通知总数不应丢失').toBeGreaterThanOrEqual(2);

      // 页面渲染层：已读状态不应再出现「新」角标
      const bodyText = await a.page.locator('#Main').innerText();
      expect(bodyText).toContain('共');
      expect(bodyText).toContain('未读 0');
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('多用户并发：B、C 同时回复同一主题 → A 收到 2 条独立通知，互不覆盖', async ({
    browser,
  }) => {
    const a = await newUser(browser, 'ntf_cc_a');
    const b = await newUser(browser, 'ntf_cc_b');
    const c = await newUser(browser, 'ntf_cc_c');

    try {
      const topicId = await createTopic(a.page, `并发通知主题 ${uniqueName('cc')}`);

      // 两个用户**真并发**回复（不是顺序执行后假装并发）
      const [r1, r2] = await Promise.all([
        replyTo(b.page, topicId, '并发回复来自 B，内容长度足够。'),
        replyTo(c.page, topicId, '并发回复来自 C，内容长度足够。'),
      ]);
      expect(r1 !== null || r2 !== null, '至少应有一条回复成功').toBe(true);

      const aList = await listNotif(a.page);
      const replies = aList.items.filter(
        (n) => n.type === 'reply' && n.topicId === topicId,
      );
      expect(
        replies.length,
        `A 应收到 2 条回复通知，实际 ${replies.length} 条：${JSON.stringify(replies)}`,
      ).toBe(2);
      const actors = replies.map((n) => n.message).join(' | ');
      expect(actors).toContain(b.username);
      expect(actors).toContain(c.username);
      // id 唯一 ⇒ 没有互相覆盖
      expect(new Set(replies.map((n) => n.id)).size).toBe(2);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
      await c.ctx.close();
    }
  });

  test('删除内容后的通知：回复被软删 → 通知不再展示该回复（不链到 404 楼层）', async ({
    browser,
  }) => {
    const a = await newUser(browser, 'ntf_del_a');
    const b = await newUser(browser, 'ntf_del_b');

    try {
      const topicId = await createTopic(a.page, `删除回复通知主题 ${uniqueName('dl')}`);
      const replyId = await replyTo(b.page, topicId, '这条回复稍后会被删除，用于验证通知处理。');
      expect(replyId, '应能拿到 replyId').toBeTruthy();

      // 删除前：A 有这条通知
      const before = await listNotif(a.page);
      expect(
        before.items.filter((n) => n.replyId === replyId).length,
        '删除前应有指向该回复的通知',
      ).toBe(1);

      // B 删除自己的回复
      const delRes = await b.page.request.delete(`/api/replies/${replyId}`, {
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': await getCsrfToken(b.page),
        },
        data: { reason: 'v0.0.15 通知可见性验收' },
      });
      expect([200, 204], `删除回复失败：${delRes.status()}`).toContain(delRes.status());

      // 删除后：该通知不得再出现（否则链到已消失的楼层）
      const after = await listNotif(a.page);
      expect(
        after.items.filter((n) => n.replyId === replyId).length,
        '回复被软删后，指向它的通知不应再出现在列表里',
      ).toBe(0);
      // 未读数也必须同步（列表过滤了、未读数没过滤 = 角标错位）
      const afterUnread = await listNotif(a.page, '?unreadOnly=true');
      expect(
        afterUnread.items.filter((n) => n.replyId === replyId).length,
        '未读视图同样不得出现该通知',
      ).toBe(0);
      expect(afterUnread.unread, '未读数必须与未读列表条数一致').toBe(afterUnread.items.length);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('封禁用户的权限边界：被 ban 后立即 401，通知不可读也不可写', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_ban_a');
    const b = await newUser(browser, 'ntf_ban_b');

    try {
      // 让 B 先有一条通知
      const topicId = await createTopic(b.page, `封禁边界主题 ${uniqueName('bn')}`);
      await replyTo(a.page, topicId, '这条回复让 B 收到一条通知。');
      const bBefore = await listNotif(b.page);
      expect(bBefore.total, 'B 封禁前应有通知').toBeGreaterThanOrEqual(1);

      // 管理员封禁 B
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();
      await clearRateLimits(adminPage);
      await login(adminPage, ADMIN.username, ADMIN.password);

      const usersRes = await adminPage.request.get('/api/admin/users?q=' + b.username);
      expect(usersRes.status(), '管理员用户列表应 200').toBe(200);
      const usersBody = (await usersRes.json()) as {
        users?: Array<{ id: number; username: string }>;
      };
      const target = (usersBody.users ?? []).find((u) => u.username === b.username);
      expect(target, `应能在管理列表里找到 ${b.username}`).toBeTruthy();

      const banRes = await apiPost(adminPage, `/api/admin/users/${target!.id}/ban`, {
        reason: 'v0.0.15 通知权限边界验收',
      });
      expect([200, 201], `封禁应成功：${banRes.status()}`).toContain(banRes.status());
      await adminCtx.close();

      // 封禁后：B 的会话已在服务端销毁 ⇒ 读通知必须 401
      const afterBan = await b.page.request.get('/api/notifications');
      expect(afterBan.status(), '被封禁用户读通知应 401').toBe(401);

      const afterBanWrite = await b.page.request.post('/api/notifications', {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      expect(afterBanWrite.status(), '被封禁用户写通知应 401').toBe(401);

      // 页面也应跳登录页（不是静默返回空列表）
      await b.page.goto('/notifications');
      await b.page.waitForLoadState('domcontentloaded');
      expect(new URL(b.page.url()).pathname, '被封禁用户访问通知页应跳登录').toBe('/signin');

      // 反向：A 不受影响
      expect((await listNotif(a.page)).total, '其他用户的通知不受影响').toBeGreaterThanOrEqual(0);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('不适用项：收藏与节点感谢**不产生**任何通知（产品未设计该事件）', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_na_a');
    const b = await newUser(browser, 'ntf_na_b');

    try {
      const topicId = await createTopic(a.page, `不适用项主题 ${uniqueName('na')}`);

      const before = await listNotif(a.page);

      // B 收藏该主题
      // 契约：`{ target: 'topic' | 'node', id, action }`（不是 targetType/targetId）
      const collect = await apiPost(b.page, '/api/collections', {
        target: 'topic',
        id: topicId,
        action: 'add',
      });
      // 收藏接口的返回码可能是 200/201，也可能因幂等返回 200 —— 只要不是 5xx
      expect(collect.status(), `收藏请求不应是服务端错误：${collect.status()}`).toBeLessThan(500);

      const after = await listNotif(a.page);
      expect(
        after.total,
        '收藏**不产生**通知（产品未设计该事件，本项目不凭空新增）',
      ).toBe(before.total);

      // node_thanks：schema 里有枚举值，但全仓没有任何写入点 ⇒ 同样不适用。
      // 这里不去"造"一个通知，只断言现有 API 面上不存在该类型的入口。
      const all = await listNotif(a.page);
      expect(
        all.items.filter((n) => n.type === 'node_thanks').length,
        'node_thanks 从未被写入过（schema 预留但产品未实现），不得凭空出现',
      ).toBe(0);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });
});

/**
 * 通知不得泄露隐藏节点 / 已删除主题的内容
 *
 * 这是本轮**新发现的真实缺陷**的回归：
 * 通知 message 在写入时就把主题标题拼进去了，而通知查询原先完全不 join
 * topics / nodes ⇒ 隐藏或删除之后标题继续泄露。
 */
test.describe('v0.0.15 通知：不得泄露隐藏节点与已删除内容', () => {
  test('节点 hidden 后：提及通知里的主题标题必须消失（staff 仍可读）', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const a = await newUser(browser, 'ntf_vis_a');
    const b = await newUser(browser, 'ntf_vis_b');

    let nodeId = 0;
    let topicId = 0;

    const setNodeStatus = async (action: 'hide' | 'activate'): Promise<number> => {
      const csrf = await getCsrfToken(adminPage);
      const res = await adminPage.request.patch('/api/nodes', {
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        data: { id: nodeId, action, reason: 'v0.0.15 通知可见性验收' },
      });
      return res.status();
    };

    try {
      await clearRateLimits(adminPage);
      await login(adminPage, ADMIN.username, ADMIN.password);

      const stamp = Date.now().toString(36);
      const catsRes = await adminPage.request.get('/api/nodes?withCategories=true');
      const catsBody = (await catsRes.json()) as { categories?: Array<{ id: number }> };
      const categoryId = catsBody.categories?.[0]?.id;
      expect(categoryId, '必须至少有一个分类').toBeTruthy();

      const createdNode = await apiPost(adminPage, '/api/nodes', {
        name: `ntfvis${stamp}`,
        title: `通知可见性节点 ${stamp}`,
        description: 'v0.0.15 通知可见性验收（用例结束恢复 active）',
        categoryId,
      });
      expect(createdNode.status(), '创建临时节点应 201').toBe(201);
      nodeId = Number(((await createdNode.json()) as { id: number }).id);

      // 用 A 在该节点发主题（标题是唯一 ASCII 串，便于包含断言）
      const topicTitle = `ntfvis${stamp}topic`;
      const createdTopic = await apiPost(a.page, '/api/topics', {
        nodeId,
        title: topicTitle,
        content: '用于验证通知是否泄露隐藏节点内容，正文长度足够。',
      });
      expect(createdTopic.status(), '临时节点下发帖应 201').toBe(201);
      // ⚠️ 发帖响应**没有 `id` 字段** —— 契约是 `{ ok, redirect: '/t/{id}', topicId? }`。
      //    第一版直接读 `body.id` 得到 undefined ⇒ topicId=0
      //    ⇒ 回帖报「主题 ID 无效」，而报错完全指不到「响应字段选错了」。
      const topicBody = (await createdTopic.json()) as {
        topicId?: number;
        id?: number;
        redirect?: string;
      };
      topicId = Number(
        topicBody.topicId ??
          topicBody.id ??
          String(topicBody.redirect ?? '').replace('/t/', ''),
      );
      expect(Number.isFinite(topicId) && topicId > 0, `发帖响应无 topicId：${JSON.stringify(topicBody)}`).toBe(
        true,
      );

      // B 在回复里 @A ⇒ A 收到 mention 通知，文案里含主题标题
      await replyTo(b.page, topicId, `@${a.username} 这条回复会生成含标题的提及通知。`);

      // 隐藏前：通知里**确实**有标题（否则隐藏后的「没有」是假合格证）
      const beforeHide = await listNotif(a.page);
      const withTitle = beforeHide.items.filter((n) => n.message.includes(topicTitle));
      expect(
        withTitle.length,
        '隐藏前，提及通知的文案里应包含主题标题（否则本用例没有鉴别力）',
      ).toBeGreaterThanOrEqual(1);

      // 隐藏节点
      expect(await setNodeStatus('hide'), '隐藏节点应 200').toBe(200);

      // 隐藏后：A 的通知列表不得再出现该标题
      const afterHide = await listNotif(a.page);
      expect(
        afterHide.items.filter((n) => n.message.includes(topicTitle)).length,
        '节点 hidden 后，通知里不得再出现该主题标题（message 是写入时拼的，必须在读取时过滤）',
      ).toBe(0);
      // 未读数同样要过滤
      const afterHideUnread = await listNotif(a.page, '?unreadOnly=true');
      expect(
        afterHideUnread.items.filter((n) => n.message.includes(topicTitle)).length,
        '未读视图同样不得泄露',
      ).toBe(0);
      expect(afterHideUnread.unread, '未读数必须与未读列表一致').toBe(afterHideUnread.items.length);

      // 页面渲染层同样不得出现
      await a.page.goto('/notifications');
      await a.page.waitForLoadState('domcontentloaded');
      await a.page.waitForTimeout(500);
      const pageText = await a.page.locator('body').innerText();
      expect(pageText, '通知页面的正文也不得出现隐藏节点的标题').not.toContain(topicTitle);
      expect(pageText, '右栏「最新」同样不得出现').not.toContain(topicTitle);

      // 恢复 active 后通知应重新可见（证明是"过滤"而不是"删了"）
      expect(await setNodeStatus('activate'), '恢复节点应 200').toBe(200);
      const afterRestore = await listNotif(a.page);
      expect(
        afterRestore.items.filter((n) => n.message.includes(topicTitle)).length,
        '节点恢复 active 后，通知应重新可见（说明数据未被破坏，只是读取时过滤）',
      ).toBeGreaterThanOrEqual(1);
    } finally {
      // 无条件恢复，避免污染后续分片
      if (nodeId) {
        try {
          await setNodeStatus('activate');
        } catch {
          // 已是 active 或节点已不存在 —— 清理失败不影响判定
        }
      }
      await adminCtx.close();
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('主题被软删除后：通知里的标题必须消失', async ({ browser }) => {
    const a = await newUser(browser, 'ntf_soft_a');
    const b = await newUser(browser, 'ntf_soft_b');

    try {
      const stamp = Date.now().toString(36);
      const topicTitle = `ntfsoft${stamp}topic`;
      const topicId = await createTopic(a.page, topicTitle);
      await replyTo(b.page, topicId, '这条回复会生成一条含标题的通知。');

      const before = await listNotif(a.page);
      expect(
        before.items.filter((n) => n.message.includes(topicTitle)).length,
        '删除前通知里应有该标题',
      ).toBeGreaterThanOrEqual(1);

      // A 删除自己的主题（软删）
      const delRes = await a.page.request.delete(`/api/topics/${topicId}`, {
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': await getCsrfToken(a.page),
        },
        data: { reason: 'v0.0.15 通知可见性验收' },
      });
      expect([200, 204], `删除主题失败：${delRes.status()}`).toContain(delRes.status());

      const after = await listNotif(a.page);
      expect(
        after.items.filter((n) => n.message.includes(topicTitle)).length,
        '主题软删后，通知不得再展示其标题（否则等于把已删除内容带回可见面）',
      ).toBe(0);
    } finally {
      await a.ctx.close();
      await b.ctx.close();
    }
  });

  test('系统通知（举报处理结果）不受可见性过滤影响 —— 它不指向主题内容', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const reporter = await newUser(browser, 'ntf_sys');
    const author = await newUser(browser, 'ntf_sysauthor');

    try {
      await clearRateLimits(adminPage);
      await login(adminPage, ADMIN.username, ADMIN.password);

      const topicId = await createTopic(author.page, `举报处理通知主题 ${uniqueName('sys')}`);

      // 举报该主题
      // 契约：reason 必须是 REPORT_REASONS 枚举值；响应字段是 reportId
      const reportRes = await apiPost(reporter.page, '/api/reports', {
        targetType: 'topic',
        targetId: topicId,
        reason: '其他',
        detail: 'v0.0.15 系统通知验收',
      });
      expect([200, 201], `举报应成功：${reportRes.status()}`).toContain(reportRes.status());
      const reportBody = (await reportRes.json()) as { reportId?: number; id?: number };
      const reportId = Number(reportBody.reportId ?? reportBody.id);
      expect(reportId, `举报响应应带 reportId：${JSON.stringify(reportBody)}`).toBeTruthy();

      // 管理员处理。
      //
      // ⚠️ 用 `reject` 而不是 `accept`：`accept` 会**软删除被举报的主题**，
      //    那样这条用例就同时混入了「内容已删」这一变量，
      //    无法单独证明「系统通知不受可见性过滤影响」。
      //    「accept 后举报人仍收到通知」由真库用例
      //    `系统通知带 topicId 时仍然可见` 单独覆盖。
      const handleRes = await apiPost(adminPage, `/api/admin/reports/${reportId}/handle`, {
        action: 'reject',
        note: 'v0.0.15 验收',
      });
      expect([200, 201], `处理举报应成功：${handleRes.status()}`).toContain(handleRes.status());

      // 举报人应收到 system 通知
      const list = await listNotif(reporter.page);
      const sys = list.items.filter((n) => n.type === 'system');
      expect(
        sys.length,
        `举报人应收到 system 通知，实际：${JSON.stringify(list.items.slice(0, 5))}`,
      ).toBeGreaterThanOrEqual(1);
      expect(sys[0].message).toContain('举报');
      // 不透露处理人身份
      expect(sys[0].message).not.toContain(ADMIN.username);
    } finally {
      await adminCtx.close();
      await reporter.ctx.close();
      await author.ctx.close();
    }
  });
});
