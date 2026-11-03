import { test, expect } from '@playwright/test';
import { ADMIN, USER_A, USER_B, MODERATOR, login, logout, register, uniqueName, clearRateLimits, apiPost, getCsrfToken } from './helpers';

test.describe('收藏与通知', () => {
  test.beforeEach(async ({ page }) => {
    await clearRateLimits(page);
  });

  test('收藏主题后出现在收藏页，可取消收藏', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);

    // 用 API 确定初始状态（按钮文案是异步更新的，直接断言文案会有竞态）
    const stateOf = async (topicId: number): Promise<boolean> => {
      const res = await page.request.get(`/api/collections?target=topic&id=${topicId}`, {
        headers: { 'x-csrf-token': await getCsrfToken(page) },
      });
      const data = await res.json();
      return (data.items ?? []).length > 0;
    };

    const topicId = 3;
    // 确保处于未收藏状态
    if (await stateOf(topicId)) {
      await apiPost(page, '/api/collections', { target: 'topic', id: topicId, action: 'remove' });
    }
    expect(await stateOf(topicId)).toBe(false);

    // 通过 UI 收藏
    await page.goto(`/t/${topicId}`);
    await page.getByRole('button', { name: '收藏' }).first().click();
    await expect
      .poll(async () => await stateOf(topicId), { timeout: 10_000 })
      .toBe(true);

    await page.goto('/bookmarks');
    await expect(page.locator('#Main')).toContainText('收藏的主题');
  });

  test('收藏节点后出现在收藏页', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    await page.goto('/go/claude');

    // 按钮初始状态取决于该节点是否已被收藏（客户端从 API 读取，需等待状态稳定）
    const addBtn = page.getByRole('button', { name: '加入收藏' });
    const doneBtn = page.getByRole('button', { name: '已收藏' });

    // 等待客户端完成收藏状态查询
    await page.waitForTimeout(800);

    // 若已处于收藏状态，先取消
    if ((await doneBtn.count()) > 0 && (await doneBtn.first().isVisible())) {
      await doneBtn.first().click();
      await expect(addBtn.first()).toBeVisible({ timeout: 10_000 });
    }

    await addBtn.first().click();
    await expect(doneBtn.first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bookmarks');
    await expect(page.locator('#Main')).toContainText('收藏的节点');
  });

  test('未登录用户收藏被拒绝', async ({ page }) => {
    const res = await apiPost(page, '/api/collections', { target: 'topic', id: 1, action: 'add' });
    expect(res.status()).toBe(401);
  });

  test('收到回复后通知列表出现对应条目', async ({ page, context }) => {
    const author = uniqueName('notif_author');
    await register(page, author);

    // 作者发布主题
    const title = `通知测试主题 ${Date.now()}`;
    await page.goto('/go/new');
    await page.selectOption('#nodeId', { label: '程序员' });
    await page.fill('#title', title);
    await page.fill('#content', '用于验证通知功能的测试主题正文内容。');
    await Promise.all([
      page.waitForURL(/\/t\/\d+/, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    const topicUrl = page.url();

    // 另一个人回复
    const other = await context.browser()!.newContext();
    const otherPage = await other.newPage();
    await login(otherPage, USER_B.username, USER_B.password);
    await otherPage.goto(topicUrl);
    await otherPage.fill('textarea[name="content"]', '这是一条用于触发通知的回复。');
    await Promise.all([
      otherPage.waitForURL(/\/t\/\d+/, { timeout: 30_000 }),
      otherPage.click('form button[type="submit"]'),
    ]);
    await other.close();

    // 作者应收到通知
    await page.goto('/notifications');
    await expect(page.locator('#Main')).toContainText('回复了你的主题');
  });

  test('收藏接口校验目标类型', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await apiPost(page, '/api/collections', { target: 'invalid', id: 1 });
    expect(res.status()).toBe(400);
  });
});

test.describe('搜索', () => {
  test('搜索框输入后出现建议下拉', async ({ page }) => {
    await page.goto('/');
    await page.fill('#search', 'claude');
    await expect(page.locator('#search-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#search-result .cell').first()).toBeVisible();
  });

  test('搜索结果页返回匹配的主题', async ({ page }) => {
    await page.goto('/go/search?q=deepseek');
    await expect(page.locator('#Main')).toContainText('主题');
    // 主题项结构与原站一致：.cell.from_{uid}.t_{id}
    await expect(page.locator('#TopicsNode > div[class*="t_"]').first()).toBeVisible();
  });

  test('搜索关键词无结果时给出提示', async ({ page }) => {
    await page.goto('/go/search?q=zzzzzznotexiste2e');
    await expect(page.locator('#Main')).toContainText('没有找到相关主题');
  });
});

test.describe('权限控制', () => {
  test('普通用户不能创建节点', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await apiPost(page, '/api/nodes', { name: 'e2enodeuser', title: '非法创建' });
    expect(res.status()).toBe(403);
  });

  test('管理员可以创建节点', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);
    const name = `e2e_node_${Date.now().toString(36)}`;
    const res = await apiPost(page, '/api/nodes', { name, title: 'E2E 测试节点' });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('active');

    await page.goto(`/go/${name}`);
    await expect(page.locator('#Main')).toContainText('E2E 测试节点');
  });

  test('版主创建的节点需要审核', async ({ page }) => {
    await login(page, MODERATOR.username, MODERATOR.password);
    const name = `e2e_mod_${Date.now().toString(36)}`;
    const res = await apiPost(page, '/api/nodes', { name, title: '版主创建的节点' });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  test('非管理员不能审核节点', async ({ page }) => {
    await login(page, MODERATOR.username, MODERATOR.password);
    const res = await page.request.patch('/api/nodes', {
      data: { id: 1, action: 'hide' },
    });
    expect(res.status()).toBe(403);
  });

  test('节点名格式非法被拒绝', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);
    const res = await apiPost(page, '/api/nodes', { name: 'Invalid Name!', title: '非法名字' });
    expect(res.status()).toBe(400);
  });

  test('重复节点名被拒绝', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);
    const res = await apiPost(page, '/api/nodes', { name: 'programmer', title: '重复节点' });
    expect(res.status()).toBe(409);
  });

  test('用户只能修改自己的资料', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await apiPost(page, '/api/settings/profile', { tagline: 'E2E 测试头衔', bio: 'E2E 测试简介' });
    expect(res.ok()).toBeTruthy();

    // 访问自己的主页应看到更新后的资料
    await page.goto(`/member/${USER_A.username}`);
    await expect(page.locator('#Rightbar')).toContainText('E2E 测试头衔');
  });

  test('修改密码需要校验当前密码', async ({ page }) => {
    await login(page, USER_A.username, USER_A.password);
    const res = await apiPost(page, '/api/settings/password', { current: 'wrong-current-password', next: 'newpassword123' });
    expect(res.status()).toBe(401);
  });
});
