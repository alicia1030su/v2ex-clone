import { test, expect } from '@playwright/test';
import {
  ADMIN,
  login,
  uniqueName,
  apiPost,
  clearRateLimits,
  getCsrfToken,
} from './helpers';

/**
 * v0.0.14（P0-1）：**站内**公共面在节点 hidden 后必须全部不可见
 *
 * 与 `e2e/v013-legacy-api.spec.ts` 的旧版端点负向验收互补：
 * 那一轮只覆盖 `/api/topics/show.json`、节点目录与 Feed；
 * 本轮覆盖 **站内页面与站内 API**：
 *
 *   · 首页 `/`、`/recent`、`/hot`、`/nodes`、`/go/{node}`、`/tag/{tag}`
 *   · 主题详情 `/t/{id}` 与 `/api/topics/{id}`
 *   · `/api/search`、`/api/search/suggest`
 *   · `/api/feed`（站内订阅）
 *
 * ## 为什么每条断言都要「前后对照」
 *
 * 只断言「hidden 之后页面里没有标题」是**假合格证**：
 * 如果这条主题本来就没出现在首页（排序靠后 / 分页在第一页之外），
 * 那么无论过滤是否生效，断言都会通过。
 *
 * 所以每条都先证明「active 时确实能看到」，再证明「hidden 后看不到」，
 * 最后改回 active 证明「恢复可见」—— 三态闭环。
 *
 * 用例结束（finally）无条件把节点改回 active，避免污染并行分片。
 */

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.14 hidden 节点在站内公共面全链路不可见', () => {
  test('active 可见 → hidden 全不可见 → active 恢复可见', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, ADMIN.username, ADMIN.password);

    const stamp = Date.now().toString(36);
    const nodeName = `v14vis${stamp}`;
    const nodeTitle = `V14 可见性节点 ${stamp}`;
    // 标题用纯 ASCII 唯一串：既便于在 HTML 里做包含断言，也不会被转义干扰
    const topicTitle = `v14vis${stamp}topic`;
    const tagName = `v14vistag${stamp}`;

    const createdNode = await apiPost(page, '/api/nodes', {
      name: nodeName,
      title: nodeTitle,
      description: 'v0.0.14 P0-1 站内可见性负向验收（用例结束恢复 active）',
    });
    expect(createdNode.status(), '创建临时节点应 201').toBe(201);
    const nodeId = Number(((await createdNode.json()) as { id: number }).id);

    const createdTopic = await apiPost(page, '/api/topics', {
      nodeId,
      title: topicTitle,
      content: '用于验证 hidden 节点内容不从站内公共页面与站内 API 泄露。',
      tags: [tagName],
    });
    expect(createdTopic.status(), '临时节点下发帖应 201').toBe(201);
    const topicId = Number(
      ((await createdTopic.json()) as { redirect: string }).redirect.replace('/t/', ''),
    );

    const csrf = await getCsrfToken(page);
    const setNodeStatus = (action: 'hide' | 'activate') =>
      page.request.patch('/api/nodes', {
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        data: { id: nodeId, action, reason: 'v0.0.14 站内可见性负向验收' },
      });

    /** 取页面 HTML（用 request 而不是 page.goto：不受客户端水合影响） */
    const html = async (path: string): Promise<string> => {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 200`).toBe(200);
      return res.text();
    };

    try {
      // ── 上半段：active 时每条路径都必须能看到，否则后面的「看不到」没有鉴别力
      expect(await html('/'), 'active 时首页应能看到该主题').toContain(topicTitle);
      expect(await html('/recent'), 'active 时 /recent 应能看到该主题').toContain(topicTitle);
      expect(await html('/nodes'), 'active 时 /nodes 应列出该节点').toContain(nodeTitle);
      expect(await html(`/go/${nodeName}`), 'active 时节点页应能看到该主题').toContain(
        topicTitle,
      );
      expect(
        await html(`/tag/${encodeURIComponent(tagName)}`),
        'active 时标签页应能看到该主题',
      ).toContain(topicTitle);

      const topicPageActive = await page.request.get(`/t/${topicId}`);
      expect(topicPageActive.status(), 'active 时主题页应 200').toBe(200);

      const apiTopicActive = await page.request.get(`/api/topics/${topicId}`);
      expect(apiTopicActive.status(), 'active 时主题 API 应 200').toBe(200);

      const searchActive = await page.request.get(
        `/api/search?q=${encodeURIComponent(topicTitle)}`,
      );
      expect(searchActive.status()).toBe(200);
      expect(
        ((await searchActive.json()) as { total: number }).total,
        'active 时搜索必须有命中，否则 hidden 后的 0 是假合格证',
      ).toBeGreaterThan(0);

      const suggestActive = await page.request.get(
        `/api/search/suggest?q=${encodeURIComponent(topicTitle)}`,
      );
      expect(suggestActive.status()).toBe(200);
      expect(
        JSON.stringify(await suggestActive.json()),
        'active 时搜索联想应包含该主题',
      ).toContain(topicTitle);

      expect(await html('/api/feed'), 'active 时站内 Feed 应包含该主题').toContain(
        `/t/${topicId}`,
      );

      // ── 下半段：hidden 后同一条路径必须全部消失
      const hidden = await setNodeStatus('hide');
      expect(hidden.status(), '隐藏节点应 200').toBe(200);

      expect(await html('/'), 'hidden 后首页不得出现该主题').not.toContain(topicTitle);
      expect(await html('/recent'), 'hidden 后 /recent 不得出现该主题').not.toContain(
        topicTitle,
      );
      expect(await html('/hot'), 'hidden 后 /hot 不得出现该主题').not.toContain(topicTitle);
      expect(await html('/nodes'), 'hidden 后 /nodes 不得列出该节点').not.toContain(nodeTitle);

      const goAfter = await page.request.get(`/go/${nodeName}`);
      expect(goAfter.status(), 'hidden 节点页应 404（不是渲染空列表）').toBe(404);

      const tagAfter = await page.request.get(`/tag/${encodeURIComponent(tagName)}`);
      expect(tagAfter.status(), '标签页本身仍可访问（标签是全局的）').toBe(200);
      expect(await tagAfter.text(), 'hidden 后标签页不得列出该主题').not.toContain(topicTitle);

      const topicPageAfter = await page.request.get(`/t/${topicId}`);
      expect(topicPageAfter.status(), 'hidden 节点主题页应对普通访问者 404').toBe(404);

      const apiTopicAfter = await page.request.get(`/api/topics/${topicId}`);
      expect(apiTopicAfter.status(), 'hidden 节点主题 API 应 404').toBe(404);

      const searchAfter = await page.request.get(
        `/api/search?q=${encodeURIComponent(topicTitle)}`,
      );
      expect(searchAfter.status()).toBe(200);
      expect(
        ((await searchAfter.json()) as { total: number }).total,
        'hidden 后搜索命中必须为 0',
      ).toBe(0);

      const suggestAfter = await page.request.get(
        `/api/search/suggest?q=${encodeURIComponent(topicTitle)}`,
      );
      expect(suggestAfter.status()).toBe(200);
      expect(
        JSON.stringify(await suggestAfter.json()),
        'hidden 后搜索联想不得出现该主题',
      ).not.toContain(topicTitle);

      expect(await html('/api/feed'), 'hidden 后站内 Feed 不得包含该主题').not.toContain(
        `/t/${topicId}`,
      );

      // ── 第三段：恢复 active 后必须回到可见（证明不是被别的原因挡住）
      const restored = await setNodeStatus('activate');
      expect(restored.status(), '恢复节点应 200').toBe(200);

      expect(await html('/'), '恢复后首页应重新出现该主题').toContain(topicTitle);
      const topicPageRestored = await page.request.get(`/t/${topicId}`);
      expect(topicPageRestored.status(), '恢复后主题页应 200').toBe(200);
      const searchRestored = await page.request.get(
        `/api/search?q=${encodeURIComponent(topicTitle)}`,
      );
      expect(
        ((await searchRestored.json()) as { total: number }).total,
        '恢复后搜索命中应恢复',
      ).toBeGreaterThan(0);
    } finally {
      const back = await setNodeStatus('activate').catch(() => null);
      // 失败也要尽力恢复；不把恢复失败吞掉（否则会污染后续分片）
      expect(back?.status(), '用例结束必须把节点恢复为 active').toBe(200);
    }
  });
});
