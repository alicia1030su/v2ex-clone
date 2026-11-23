import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  ADMIN,
  MODERATOR,
  USER_A,
  apiPost,
  clearRateLimits,
  createTopicViaUi,
  login,
  logout,
  pickNodeId,
  register,
  uniqueName,
} from './helpers';

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'password123';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await clearRateLimits(page);
});

async function createTopic(page: Page, title: string): Promise<number> {
  const response = await apiPost(page, '/api/topics', {
    nodeId: 1,
    title,
    content: 'v0.0.21 交互契约验收正文，长度足够通过服务端校验。',
  });
  expect([200, 201], `create topic status: ${response.status()}`).toContain(response.status());
  const body = (await response.json()) as { topicId?: number; id?: number; redirect?: string };
  const topicId = Number(body.topicId ?? body.id ?? String(body.redirect ?? '').replace('/t/', ''));
  expect(Number.isInteger(topicId) && topicId > 0).toBe(true);
  return topicId;
}

async function createReply(page: Page, topicId: number, content: string, parentReplyId?: number): Promise<number> {
  const response = await apiPost(page, '/api/replies', {
    topicId,
    content,
    ...(parentReplyId ? { parentReplyId } : {}),
    clientRequestId: uniqueName('v021_reply'),
  });
  expect(response.status(), `create reply status: ${response.status()}`).toBe(200);
  const body = (await response.json()) as { replyId?: number };
  expect(Number.isInteger(body.replyId) && (body.replyId ?? 0) > 0).toBe(true);
  return Number(body.replyId);
}

async function newUser(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearRateLimits(page);
  const username = uniqueName(prefix);
  await register(page, username, PASSWORD);
  await clearRateLimits(page);
  return { context, page, username };
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, `${label} horizontal overflow`).toBe(false);
}

test('搜索建议可见并可用 Enter 提交', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('claude');
  await expect(page.locator('#search-result.show .cell').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('#search').press('Enter');
  await page.waitForURL(/\/go\/search\?q=claude/);
  await expect(page.locator('#Main')).toContainText('主题');
});

test('登录失败显示错误，正确账号可进入设置', async ({ page }) => {
  await page.goto('/signin');
  await page.locator('#username').fill(ADMIN.username);
  await page.locator('#password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: /登录|登 录/ }).click();
  await expect(page.locator('#problem')).toContainText(/密码|登录/);

  await login(page, USER_A.username, USER_A.password);
  await page.goto('/settings');
  await expect(page.locator('#Main')).toContainText(USER_A.username);
});

test('注册校验两次密码并可完成注册', async ({ page }) => {
  await page.goto('/signup');
  await page.locator('#username').fill(uniqueName('v021_mismatch'));
  await page.locator('#email').fill('v021-mismatch@e2e.local');
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(`${PASSWORD}-different`);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.locator('#problem')).toHaveText('两次输入的密码不一致');

  const username = uniqueName('v021_register');
  await register(page, username, PASSWORD);
  await page.goto('/settings');
  await expect(page.locator('#Main')).toContainText(username);
});

test('找回密码校验邮箱格式并返回防枚举提示', async ({ page }) => {
  await page.goto('/forgot');
  await page.locator('form').filter({ has: page.locator('#email') }).evaluate((form) => form.setAttribute('novalidate', ''));
  await page.locator('#email').fill('not-an-email');
  await page.getByRole('button', { name: '发送重置链接' }).click();
  await expect(page.locator('.problem')).toHaveText('邮箱格式不正确');

  await page.locator('#email').fill(`missing-${Date.now()}@e2e.local`);
  await page.getByRole('button', { name: '发送重置链接' }).click();
  await expect(page.locator('.toast')).toContainText('如果该邮箱已注册');
});

test('七种回复模式均可即时切换', async ({ page }) => {
  await login(page, USER_A.username, USER_A.password);
  const topicId = await createTopic(page, `七模式 ${uniqueName('v021_modes')}`);
  const parentId = await createReply(page, topicId, '父楼层模式内容');
  await createReply(page, topicId, '子楼层模式内容', parentId);
  await page.goto(`/t/${topicId}`);

  const select = page.locator('#reply-display-mode');
  await select.selectOption('classic');
  await expect(page.locator('.reply-list-classic')).toBeVisible();
  await expect(page.locator('.reply-parent-reference')).toHaveCount(0);
  await select.selectOption('quote');
  await expect(page.locator('.reply-list-quote .reply-parent-reference')).toBeVisible();
  await select.selectOption('badge');
  await expect(page.locator('.reply-list-badge .reply-parent-badge')).toBeVisible();
  await select.selectOption('nested');
  await expect(page.locator('.reply-list-nested .is-nested-reply')).toHaveCount(1);
  await select.selectOption('tree');
  await expect(page.locator('.reply-list-tree .has-tree-depth')).toHaveCount(1);
  await select.selectOption('lines');
  await expect(page.locator('.reply-list-lines .has-reply-parent')).toHaveCount(1);
  await select.selectOption('excerpt');
  await expect(page.locator('.reply-list-excerpt .reply-parent-excerpt')).toBeVisible();
});

test('主题发布、编辑与删除入口形成真实闭环', async ({ page }) => {
  const username = uniqueName('v021_topic');
  await register(page, username, PASSWORD);
  await clearRateLimits(page);
  const nodeId = await pickNodeId(page);
  const title = `主题生命周期 ${username}`;
  const topicId = await createTopicViaUi(page, nodeId, title, '原始正文内容，用于验证发布与编辑闭环。');
  await page.goto(`/t/${topicId}`);
  await page.getByRole('button', { name: '编辑主题' }).click();
  const editor = page.locator('.topic_edit_modal textarea[name="content"]');
  await expect(editor).toBeVisible();
  const updated = '编辑后的正文内容，用于验证删除前的真实保存。';
  await editor.fill(updated);
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/topics/${topicId}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存修改' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#Main')).toContainText(updated, { timeout: 30_000 });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除主题' }).click();
  await expect.poll(async () => (await page.request.get(`/t/${topicId}`)).status()).toBe(404);
});

test('赞同、收藏与书签页面联动', async ({ page }) => {
  await login(page, USER_A.username, USER_A.password);
  const title = `投票收藏 ${uniqueName('v021_vote')}`;
  const topicId = await createTopic(page, title);
  await page.goto(`/t/${topicId}`);
  const vote = page.getByRole('button', { name: '赞同' });
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'true');

  const collect = page.getByRole('button', { name: '收藏', exact: true }).first();
  await collect.click();
  await expect(page.getByRole('button', { name: '已收藏', exact: true }).first()).toBeVisible();
  await page.goto('/bookmarks');
  await expect(page.locator('#Main')).toContainText(title);
});

test('感谢与举报均有真实提交反馈', async ({ page, browser }) => {
  const author = await newUser(browser, 'v021_author');
  const actor = await newUser(browser, 'v021_actor');
  try {
    const topicId = await createTopic(author.page, `感谢举报 ${uniqueName('v021_social')}`);
    await createReply(author.page, topicId, '这条回复将被另一位用户感谢。');
    await actor.page.goto(`/t/${topicId}`);
    await actor.page.getByRole('button', { name: '感谢这条回复' }).click();
    await expect(actor.page.getByRole('button', { name: '取消感谢' })).toBeVisible();

    await actor.page.locator('.cell_ops button', { hasText: '举报' }).first().click();
    const dialog = actor.page.getByRole('dialog', { name: '举报' });
    await dialog.getByPlaceholder('补充说明（选填，最多 500 字）').fill('v0.0.21 交互契约举报验收');
    await dialog.getByRole('button', { name: '提交举报' }).click();
    await expect(actor.page.locator('.cell_ops').getByText('已举报')).toBeVisible();
  } finally {
    await author.context.close();
    await actor.context.close();
  }
});

test('通知可单条与全部标记已读', async ({ page, browser }) => {
  const author = await newUser(browser, 'v021_notif_author');
  const actor = await newUser(browser, 'v021_notif_actor');
  try {
    const topicId = await createTopic(author.page, `通知已读 ${uniqueName('v021_notif')}`);
    await createReply(actor.page, topicId, '第一条回复用于产生通知。');
    await clearRateLimits(actor.page);
    await createReply(actor.page, topicId, '第二条回复用于验证全部已读。');
    await author.page.goto('/notifications');
    await expect(author.page.locator('#Main')).toContainText('回复了你的主题');
    const unreadBefore = await author.page.request.get('/api/notifications?unreadOnly=true').then(async (response) =>
      Number(((await response.json()) as { unread?: number }).unread ?? 0));
    expect(unreadBefore).toBeGreaterThan(0);
    await author.page.getByRole('button', { name: '标记为已读' }).first().click();
    await expect.poll(async () => {
      const response = await author.page.request.get('/api/notifications?unreadOnly=true');
      return Number(((await response.json()) as { unread?: number }).unread ?? 0);
    }).toBe(unreadBefore - 1);
    await author.page.getByRole('button', { name: '全部标记为已读' }).click();
    await expect(author.page.locator('#Main')).toContainText('未读 0');
  } finally {
    await author.context.close();
    await actor.context.close();
  }
});

test('设置保存成功且密码不一致有可见校验', async ({ page }) => {
  const username = uniqueName('v021_settings');
  await register(page, username, PASSWORD);
  await clearRateLimits(page);
  await page.goto('/settings');
  await page.getByLabel('头衔').fill('v0.0.21 交互验收头衔');
  await page.getByLabel('简介').fill('这是设置保存与校验的真实浏览器证据。');
  await page.getByRole('button', { name: '保存资料' }).click();
  await expect(page.getByText('资料已保存', { exact: true })).toBeVisible();

  await page.getByLabel('当前密码', { exact: true }).fill(PASSWORD);
  await page.getByLabel('新密码', { exact: true }).fill(`${PASSWORD}-new`);
  await page.getByLabel('确认新密码', { exact: true }).fill(`${PASSWORD}-different`);
  await page.getByRole('button', { name: '修改密码' }).click();
  await expect(page.locator('.problem')).toHaveText('两次输入的新密码不一致');
  await page.reload();
  await expect(page.getByLabel('头衔')).toHaveValue('v0.0.21 交互验收头衔');
});

test('管理员与版主入口及角色可见性正确', async ({ page }) => {
  await login(page, ADMIN.username, ADMIN.password);
  await expect(page.getByRole('link', { name: '管理后台' })).toBeVisible();
  await page.goto('/admin');
  await expect(page.locator('#Main')).toContainText('用户');
  await expect(page.locator('#Main')).toContainText('举报');

  await logout(page);
  await login(page, MODERATOR.username, MODERATOR.password);
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: /^举报/ })).toBeVisible();
});

test('明暗主题即时切换并在刷新后保持', async ({ page }) => {
  await page.goto('/');
  const theme = page.getByLabel('主题外观');
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'light');
});

test('Tab/Enter 与 Space 可完成真实键盘操作', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('#search').fill('claude');
  await page.locator('#search').press('Enter');
  await page.waitForURL(/\/go\/search\?q=claude/);

  await login(page, USER_A.username, USER_A.password);
  const topicId = await createTopic(page, `键盘投票 ${uniqueName('v021_keyboard')}`);
  await page.goto(`/t/${topicId}`);
  const vote = page.getByRole('button', { name: '赞同' });
  await vote.focus();
  await page.keyboard.press('Space');
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
});

test('CDP 200% page scale 下关键页面无横向溢出', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  for (const route of ['/', '/signin', '/t/1']) {
    await page.goto(route);
    await expectNoOverflow(page, `${route} at 200%`);
  }
  await session.detach();
});

test.describe('窄屏触摸交互', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('触摸搜索与主题切换可用且页面无溢出', async ({ page }) => {
    await page.goto('/');
    await page.locator('#search').tap();
    await page.locator('#search').fill('claude');
    await expect(page.locator('#search-result.show .cell').first()).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('主题外观').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark');
    await expectNoOverflow(page, '375px touch home');
    await page.goto('/t/1');
    await expectNoOverflow(page, '375px touch topic');
  });
});
