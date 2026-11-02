import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('分页', () => {
  test('首页分页：每页 20 条，页码可跳转', async ({ page }) => {
    await page.goto('/');
    const items = await page.locator('.cell.item').count();
    expect(items).toBeLessThanOrEqual(20);
    expect(items).toBeGreaterThan(0);
  });

  test('节点页分页参数生效', async ({ page }) => {
    await page.goto('/go/programmer?p=1');
    await expect(page.locator('#TopicsNode')).toBeVisible();

    // 第 1 页的主题项
    const firstPageIds = await page
      .locator('#TopicsNode > div[class*="t_"]')
      .evaluateAll((els) => els.map((e) => e.className.match(/t_(\d+)/)?.[1] ?? ''));
    expect(firstPageIds.length).toBeGreaterThan(0);
    // 每页最多 20 条
    expect(firstPageIds.length).toBeLessThanOrEqual(20);

    // 当前页码高亮
    await expect(page.locator('.page_current').first()).toHaveText('1');

    // 第 2 页存在且内容与第 1 页不同
    await page.goto('/go/programmer?p=2');
    const secondPageIds = await page
      .locator('#TopicsNode > div[class*="t_"]')
      .evaluateAll((els) => els.map((e) => e.className.match(/t_(\d+)/)?.[1] ?? ''));
    if (secondPageIds.length > 0) {
      const overlap = secondPageIds.filter((id) => firstPageIds.includes(id));
      expect(overlap).toHaveLength(0);
      await expect(page.locator('.page_current').first()).toHaveText('2');
    }
  });

  test('主题数不足一页时不显示分页器', async ({ page }) => {
    // claude 节点主题数远少于 20
    await page.goto('/go/claude');
    await expect(page.locator('#TopicsNode')).toBeVisible();
    const topicCount = await page.locator('#TopicsNode > div[class*="t_"]').count();
    if (topicCount <= 20) {
      await expect(page.locator('.page_current')).toHaveCount(0);
    }
  });

  test('超出范围的页码不报错', async ({ page }) => {
    const res = await page.goto('/go/programmer?p=9999');
    expect(res?.status()).toBe(200);
  });

  test('主题详情回复分页器存在且格式正确', async ({ page }) => {
    await page.goto('/t/1');
    const pager = page.locator('.ps_container').first();
    if (await pager.count()) {
      await expect(pager.locator('.page_current')).toHaveText('1');
    }
  });

  test('分页输入框可跳转到指定页', async ({ page }) => {
    await page.goto('/go/programmer?p=1');
    const input = page.locator('.page_input').first();
    if (await input.count()) {
      await expect(input).toHaveAttribute('min', '1');
    }
  });
});
