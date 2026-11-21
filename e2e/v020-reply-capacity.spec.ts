import { expect, test } from '@playwright/test';
import postgres from 'postgres';

// 10000 回复夹具只在 core 全量 E2E 跑一次；跨浏览器矩阵跳过，避免重复灌库。
test.skip(process.env.E2E_CROSS === '1', 'v020 capacity runs in core E2E only');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required for v020 capacity E2E');

const client = postgres(DATABASE_URL, { prepare: false, max: 2 });
let topicId = 0;

test.beforeAll(async () => {
  const [author] = await client`
    SELECT id FROM users ORDER BY id LIMIT 1
  `;
  const [node] = await client`
    SELECT id FROM nodes WHERE status = 'active' ORDER BY id LIMIT 1
  `;
  if (!author || !node) throw new Error('capacity E2E requires seeded author and active node');

  const [topic] = await client`
    INSERT INTO topics (title, content, node_id, author_id, replies_count)
    VALUES ('v020 capacity 10000', 'capacity probe', ${node.id}, ${author.id}, 10000)
    RETURNING id
  `;
  topicId = topic.id;

  await client`
    INSERT INTO replies (topic_id, author_id, content, floor, parent_reply_id)
    VALUES (${topicId}, ${author.id}, 'v020 capacity reply 1', 1, NULL)
  `;
  await client`
    INSERT INTO replies (topic_id, author_id, content, floor, parent_reply_id)
    SELECT ${topicId}, ${author.id}, 'v020 capacity reply ' || g, g,
      CASE WHEN g = 5001 THEN (SELECT id FROM replies WHERE topic_id = ${topicId} AND floor = 1) ELSE NULL END
    FROM generate_series(2, 10000) AS g
  `;
});

test.afterAll(async () => {
  if (topicId > 0) {
    await client`DELETE FROM topics WHERE id = ${topicId}`;
  }
  await client.end({ timeout: 5 });
});

test.describe('v0.0.20 10000 回复七种展示模式容量', () => {
  test('首屏、末页与七种模式均保持有界 DOM', async ({ page }) => {
    test.setTimeout(120_000);
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto(`/t/${topicId}`);
    await expect(page.locator('.reply-card')).toHaveCount(20);
    await expect(page.locator('#reply-total-count')).toHaveText('10000');

    for (const mode of ['classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt']) {
      await page.locator('#reply-display-mode').selectOption(mode);
      await expect(page.locator('.reply-list')).toHaveClass(new RegExp(`reply-list-${mode}`));
      expect(await page.locator('.reply-card').count()).toBeLessThanOrEqual(20);
    }

    await page.goto(`/t/${topicId}?p=500`);
    await expect(page.locator('.reply-card')).toHaveCount(20);
    await expect(page.locator('#reply-total-count')).toHaveText('10000');
    expect(runtimeErrors).toEqual([]);
  });
});
