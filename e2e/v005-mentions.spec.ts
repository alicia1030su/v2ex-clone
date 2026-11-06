/**
 * v0.0.5 · @ 提及全链路 E2E
 *
 * 覆盖「回复里 @ 某人 ⇒ 被提及者收到 mention 通知」这条链路：
 *
 *   浏览器（真实 UI / 真实 API）
 *     → POST /api/replies（真实 CSRF + 真实限流）
 *       → 正文里的 @username 被解析
 *         → 查到真实存在的用户
 *           → 写入 notifications（type = 'mention'）
 *             → 被提及者 GET /api/notifications 看到「提及」
 *
 * ## ⚠️ 为什么全部用 `register()` 而不是 `login()` seed 账号
 *
 * 实测踩到（连踩 3 次）：seed 账号（lisi / wangwu）的口令取决于
 * **数据库被 seed 当时的** `SEED_DEMO_PASSWORD`，而测试进程读到的是
 * **当前**的同名环境变量 —— 两者一旦不一致，登录就必然 401
 * 「用户名或密码不正确」，而且**报错信息完全指不到真正的原因**。
 *
 * 用注册则口令完全由测试自己决定 ⇒ 不依赖任何外部状态。
 *
 * ## ⚠️ 为什么每个用户一个独立 context
 *
 * 提及验证需要「A 被 B 回复并提及」——
 * 若 A、B 共用同一个 context，就会共用同一份 Cookie ⇒ 变成自己 @ 自己。
 */

import { test, expect } from '@playwright/test';
import { register, uniqueName, clearRateLimits, apiPost } from './helpers';

/** 所有测试用户共用的口令（由测试自己决定，不依赖 seed） */
const PASSWORD = 'MentionTest-2026!';

/** 等页面可用于断言（页面有持续请求，networkidle 不可靠） */
async function waitForPage(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
}

/** 读当前用户的通知列表 */
async function notificationsOf(page: import('@playwright/test').Page): Promise<
  { type: string; message: string }[]
> {
  const res = await page.request.get('/api/notifications');
  expect(res.status()).toBe(200);
  const body = await res.json();
  // ⚠️ 通知 API 的字段是 `notifications`（不是 `items`）
  return (body.notifications ?? body.items ?? []) as {
    type: string;
    message: string;
  }[];
}

/** 发一个主题，返回主题 id */
async function createTopic(
  page: import('@playwright/test').Page,
  title: string,
): Promise<number> {
  const res = await apiPost(page, '/api/topics', {
    nodeId: 1,
    title,
    content: '这是一个用于测试提及功能的主题正文，内容足够长以满足校验。',
  });
  // 发帖成功返回 201（创建资源）；宽松接受 200 以防将来调整
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  // v0.0.5：发帖 API 已补 `topicId` 字段
  const id = Number(body.topicId ?? body.topic?.id ?? body.id);
  expect(Number.isFinite(id), `发帖响应里没有 topicId：${JSON.stringify(body)}`).toBe(true);
  return id;
}

/** 回复一个主题 */
async function replyTo(
  page: import('@playwright/test').Page,
  topicId: number,
  content: string,
): Promise<void> {
  const res = await apiPost(page, '/api/replies', { topicId, content });
  // ⚠️ 回复成功返回 **200**（不是 201）
  if (res.status() !== 200 && res.status() !== 201) {
    const errText = await res.text().catch(() => '(no body)');
    throw new Error(
      `回复失败（HTTP ${res.status()}）：${content.slice(0, 40)} —— ${errText.slice(0, 200)}`,
    );
  }
}

/**
 * 注册一个新用户并返回它所在的 context
 *
 * 每个用户一个独立 context ⇒ 独立的 Cookie ⇒ 独立的会话。
 */
async function newUser(
  browser: import('@playwright/test').Browser,
  prefix: string,
): Promise<{ ctx: import('@playwright/test').BrowserContext; page: import('@playwright/test').Page; username: string }> {
  const username = uniqueName(prefix);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ⚠️ **注册前后都要清限流**。
  //
  // 实测踩到：注册有 **IP 维度限流**（默认 20 次 / 300 秒，
  // 见 src/app/api/auth/signup/route.ts 的 `signup_ip`），
  // 而 `clearRateLimits` 是按 IP 清的 ——
  // 但只在注册**之前**清一次是不够的：
  // 本用例一次要造 12 个用户 ⇒ 必然在中途撞上 20 次的墙。
  //
  // 注册失败的表现极具迷惑性：`register()` 里的
  // `page.waitForURL(...)` 等满 30 秒才抛「TimeoutError」，
  // 报错完全指不到「限流」这个真正原因。
  await clearRateLimits(page);
  await register(page, username, PASSWORD);
  await clearRateLimits(page);
  return { ctx, page, username };
}

test.describe('v0.0.5 · @ 提及', () => {
  test('回复里 @ 他人 ⇒ 被提及者收到 mention 通知', async ({ page, browser }) => {
    await clearRateLimits(page);

    const a = await newUser(browser, 'ment_a');
    const b = await newUser(browser, 'ment_b');

    const topicId = await createTopic(a.page, `提及测试主题 ${uniqueName('mention')}`);

    await replyTo(b.page, topicId, `@${a.username} 请看一下这个问题`);

    const items = await notificationsOf(a.page);
    const mention = items.find((n) => n.type === 'mention');

    expect(
      mention,
      `${a.username} 应当收到 mention 通知，实际通知：${JSON.stringify(items.slice(0, 5))}`,
    ).toBeTruthy();
    // ⚠️ 通知文案是「XXX 在回复 #N中提及了你：<主题标题>」
    //    —— **不带 @ 前缀**（被提及者的名字由「你」指代）。
    //    原断言写成 `toContain('@' + a.username)` 是错的（实测踩到）。
    expect(mention!.message).toContain(b.username);
    expect(mention!.message).toContain('提及了你');
    expect(mention!.message).toMatch(/#\d+/);
    // 被提及者的用户名不出现在文案里（文案用「你」指代）
    expect(mention!.message).not.toContain(a.username);

    await a.ctx.close();
    await b.ctx.close();
  });

  test('不给自己发提及通知', async ({ page }) => {
    await clearRateLimits(page);
    const self = uniqueName('ment_self');
    await register(page, self, PASSWORD);
    await clearRateLimits(page);

    const before = (await notificationsOf(page)).filter((n) => n.type === 'mention').length;

    const topicId = await createTopic(page, `自提及测试 ${uniqueName('self')}`);
    await replyTo(page, topicId, `@${self} 我自己提我自己`);

    const after = (await notificationsOf(page)).filter((n) => n.type === 'mention').length;
    expect(after).toBe(before);

    await clearRateLimits(page);
  });

  test('邮箱地址不误判为提及', async ({ page }) => {
    await clearRateLimits(page);
    const author = uniqueName('ment_mail');
    await register(page, author, PASSWORD);
    await clearRateLimits(page);

    const before = (await notificationsOf(page)).filter((n) => n.type === 'mention').length;

    const topicId = await createTopic(page, `邮箱误判测试 ${uniqueName('mail')}`);
    // `foo@example.com` 里的 `example` **不是**提及
    await replyTo(page, topicId, `请发邮件到 foo@example.com 谢谢`);

    const after = (await notificationsOf(page)).filter((n) => n.type === 'mention').length;
    expect(after, '邮箱地址不应被解析成提及').toBe(before);

    await clearRateLimits(page);
  });

  test('同一条回复里重复提及同一人 ⇒ 只产生 1 条通知', async ({ page, browser }) => {
    await clearRateLimits(page);

    const a = await newUser(browser, 'dup_a');
    const b = await newUser(browser, 'dup_b');

    const topicId = await createTopic(a.page, `去重测试 ${uniqueName('dup')}`);
    await replyTo(
      b.page,
      topicId,
      `@${a.username} 第一次 @${a.username} 第二次 @${a.username} 第三次`,
    );

    const mentions = (await notificationsOf(a.page)).filter((n) => n.type === 'mention');
    expect(mentions.length, '同一条回复里的重复提及只应产生 1 条通知').toBe(1);

    await a.ctx.close();
    await b.ctx.close();
  });

  test('单条内容最多触发 10 个提及通知', async ({ page, browser }) => {
    await clearRateLimits(page);

    // 造 12 个真实存在的用户
    const usernames: string[] = [];
    const contexts: import('@playwright/test').BrowserContext[] = [];
    for (let i = 0; i < 12; i++) {
      const u = uniqueName(`ment${i}`);
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      // ⚠️ 每注册一个就清一次限流（IP 维度 20 次 / 300 秒）
      await clearRateLimits(p);
      await register(p, u, PASSWORD);
      await clearRateLimits(p);
      usernames.push(u);
      contexts.push(ctx);
    }

    const author = await newUser(browser, 'cap_author');
    const topicId = await createTopic(author.page, `上限测试 ${uniqueName('cap')}`);

    const replier = await newUser(browser, 'cap_replier');
    const mentions = usernames.map((u) => `@${u}`).join(' ');
    await replyTo(replier.page, topicId, `${mentions} 一次性提及很多人`);

    // 统计所有被提及用户各自收到的通知数
    let total = 0;
    for (let i = 0; i < usernames.length; i++) {
      const p = await contexts[i].newPage();
      // ⚠️ 新 page 不带登录态 —— 直接查数据库不方便，
      //    这里改用「以该用户身份重新进通知页」的方式：
      //    注册时的会话在**同一个 context** 里，换 page 会丢 Cookie。
      await p.close();

      const orig = await contexts[i].pages();
      const op = orig[0];
      if (!op) continue;
      const items = await notificationsOf(op);
      total += items.filter((n) => n.type === 'mention').length;
    }

    expect(total, `提及通知总数应被限制在 10 以内，实际 ${total}`).toBeLessThanOrEqual(10);

    await author.ctx.close();
    await replier.ctx.close();
    for (const c of contexts) await c.close();
  });

  test('提及通知页显示「提及」标签', async ({ page, browser }) => {
    await clearRateLimits(page);

    const a = await newUser(browser, 'ui_a');
    const b = await newUser(browser, 'ui_b');

    const topicId = await createTopic(a.page, `提及 UI 测试 ${uniqueName('ui')}`);
    await replyTo(b.page, topicId, `@${a.username} 看一下这个`);

    // 打开通知页
    await a.page.goto('/notifications');
    await waitForPage(a.page);

    // 页面上应出现「提及」字样
    const bodyText = await a.page.locator('body').innerText();
    expect(bodyText, '通知页应显示「提及」标签').toContain('提及');
    // 应包含提及者的名字
    expect(bodyText).toContain(b.username);

    await a.ctx.close();
    await b.ctx.close();
  });
});
