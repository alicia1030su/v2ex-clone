import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  USER_A,
  apiPost,
  clearRateLimits,
  login,
  register,
  uniqueName,
} from './helpers';

test.describe.configure({ mode: 'serial' });

async function createTopic(page: Page, title: string): Promise<number> {
  const res = await apiPost(page, '/api/topics', {
    nodeId: 1,
    title,
    content: 'v0.0.19 回复体验验收主题正文，长度足够通过服务端校验。',
  });
  expect([200, 201], `发帖失败：${res.status()} ${await res.text().catch(() => '')}`).toContain(
    res.status(),
  );
  const body = (await res.json()) as { topicId?: number; id?: number; redirect?: string };
  const id = Number(body.topicId ?? body.id ?? String(body.redirect ?? '').replace('/t/', ''));
  expect(Number.isInteger(id) && id > 0).toBe(true);
  return id;
}

async function createReply(
  page: Page,
  topicId: number,
  content: string,
  parentReplyId?: number,
): Promise<number> {
  const res = await apiPost(page, '/api/replies', {
    topicId,
    content,
    ...(parentReplyId ? { parentReplyId } : {}),
    clientRequestId: `e2e-${uniqueName('reply')}`,
  });
  expect(res.status(), `回复失败：${res.status()} ${await res.text().catch(() => '')}`).toBe(200);
  const body = (await res.json()) as { replyId?: number };
  expect(Number.isInteger(body.replyId) && (body.replyId ?? 0) > 0).toBe(true);
  return Number(body.replyId);
}

async function newLoggedInUser(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearRateLimits(page);
  await login(page, USER_A.username, USER_A.password);
  await clearRateLimits(page);
  return { context, page, prefix };
}

test.describe('v0.0.19 回复与主题体验', () => {
  test('无刷新回复：列表、计数、滚动定位与成功清空草稿', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const topicId = await createTopic(page, `无刷新回复 ${uniqueName('norefresh')}`);
    await page.goto(`/t/${topicId}`);
    await page.evaluate(() => {
      (window as unknown as { __v019PageMarker?: number }).__v019PageMarker = 1;
    });

    const content = `无刷新回复内容 ${uniqueName('body')}`;
    await page.locator('#reply-content').fill(content);
    await page.getByRole('button', { name: '提交回复' }).click();

    await expect(page.getByText(content, { exact: true })).toBeVisible();
    await expect(page.locator('#reply-content')).toHaveValue('');
    await expect(page.locator('#reply-total-count')).toHaveText('1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __v019PageMarker?: number }).__v019PageMarker))
      .toBe(1);
  });

  test('回复失败保留完整草稿并显示真实错误', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const topicId = await createTopic(page, `失败草稿 ${uniqueName('draft')}`);
    await page.goto(`/t/${topicId}`);

    const draft = `不能被失败清空的草稿 ${uniqueName('text')}`;
    await page.locator('#reply-content').fill(draft);
    await page.route('**/api/replies', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: '回复过于频繁，请 30 秒后再试' }),
        });
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: '提交回复' }).click();
    await expect(page.locator('.reply-composer-error')).toContainText('回复过于频繁');
    await expect(page.locator('#reply-content')).toHaveValue(draft);
    await page.unroute('**/api/replies');
  });

  test('父子关联：空输入可切换目标，输入后不覆盖原目标', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const topicId = await createTopic(page, `父子关联 ${uniqueName('parent')}`);
    const parentId = await createReply(page, topicId, '第一条父楼层内容');
    const secondId = await createReply(page, topicId, '第二条父楼层内容');
    await page.goto(`/t/${topicId}`);

    const firstCard = page.locator(`[data-reply-id="${parentId}"]`);
    const secondCard = page.locator(`[data-reply-id="${secondId}"]`);
    await firstCard.getByRole('button', { name: /回复 1 楼/ }).click();
    await expect(page.getByText(/正在回复/)).toContainText('#1');

    await secondCard.getByRole('button', { name: /回复 2 楼/ }).click();
    await expect(page.getByText(/正在回复/)).toContainText('#2');

    const draft = '已经输入的内容不能丢失';
    await page.locator('#reply-content').fill(draft);
    await firstCard.getByRole('button', { name: /回复 1 楼/ }).click();
    await expect(page.locator('.reply-mode-notice')).toContainText('保留原回复目标');
    await expect(page.getByText(/正在回复/)).toContainText('#2');
    await expect(page.locator('#reply-content')).toHaveValue(draft);

    await page.getByRole('button', { name: '取消关联' }).click();
    await expect(page.getByText(/正在回复/)).toHaveCount(0);
    await expect(page.locator('#reply-content')).toHaveValue(draft);
  });

  test('七种显示模式可即时切换且经典模式不显示父引用', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const topicId = await createTopic(page, `七模式 ${uniqueName('modes')}`);
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

  test('Light / Dark / System 即时生效并在刷新后保持', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    await page.goto('/');
    const theme = page.getByLabel('主题外观');

    const saved = page.waitForResponse((response) =>
      response.url().includes('/api/preferences') && response.request().method() === 'PUT');
    await theme.selectOption('dark');
    expect((await saved).status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark');
    await expect.poll(() => page.context().cookies().then((cookies) =>
      cookies.find((cookie) => cookie.name === 'v2_theme')?.value)).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'dark' });
    await theme.selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark');

    await theme.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'light');
  });

  test('选择图片后自动插入 Markdown，并可随回复无刷新发布', async ({ page }) => {
    await clearRateLimits(page);
    await register(page, uniqueName('image_picker'));
    const topicId = await createTopic(page, `回复图片 ${uniqueName('image')}`);
    await page.goto(`/t/${topicId}`);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const recentBefore = await page.locator('.reply-recent-thumb').count();
    await page.locator('input[type=file]').setInputFiles({
      name: 'tiny.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(page.locator('#reply-content')).toHaveValue(/!\[图片\]\(\/uploads\/replies\//);
    await expect(page.locator('.reply-recent-thumb')).toHaveCount(recentBefore + 1);

    await page.getByRole('button', { name: '提交回复' }).click();
    await expect(page.locator('.reply_content img[src^="/uploads/replies/"]')).toBeVisible();
  });

  test('粘贴截图与拖入回复框都会上传并插入 Markdown', async ({ page }) => {
    await clearRateLimits(page);
    await register(page, uniqueName('image_drop'));
    const topicId = await createTopic(page, `回复图片拖拽 ${uniqueName('drop')}`);
    await page.goto(`/t/${topicId}`);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const bytes = [...png];

    await page.locator('#reply-content').evaluate((el, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }));
    }, { bytes, name: 'paste.png' });
    await expect
      .poll(() => page.locator('#reply-content').inputValue().then((value) => (value.match(/!\[图片\]/g) ?? []).length))
      .toBe(1);

    await page.locator('.reply-composer-drop').evaluate((el, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }));
    }, { bytes, name: 'drop.png' });
    await expect
      .poll(() => page.locator('#reply-content').inputValue().then((value) => (value.match(/!\[图片\]/g) ?? []).length))
      .toBe(2);
    await expect(page.locator('.reply-recent-thumb')).toHaveCount(2);
  });

  test('101 条回复跨页：目标页父引用与按需上下文可用', async ({ page }) => {
    test.setTimeout(120_000);
    await clearRateLimits(page);
    await login(page, USER_A.username, USER_A.password);
    const topicId = await createTopic(page, `跨页楼中楼 ${uniqueName('crosspage')}`);
    const parentId = await createReply(page, topicId, '跨页父楼层内容');
    for (let i = 0; i < 99; i++) {
      if (i % 15 === 0) await clearRateLimits(page);
      await createReply(page, topicId, `中间楼层 ${i + 1}`);
    }
    await clearRateLimits(page);
    const childId = await createReply(page, topicId, '跨页父楼层的子回复', parentId);

    await page.goto(`/t/${topicId}?p=${Math.ceil(101 / 20)}`);
    await page.locator('#reply-display-mode').selectOption('quote');
    const childCard = page.locator(`[data-reply-id="${childId}"]`);
    await expect(childCard).toBeVisible();
    await expect(childCard.locator('.reply-parent-reference')).toContainText('#1');
    await childCard.getByRole('button', { name: '查看上下文' }).click();
    await expect(childCard.locator('.reply-context-panel')).toContainText('跨页父楼层内容');
  });
});
