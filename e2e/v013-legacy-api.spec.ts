import { test, expect } from '@playwright/test';
import {
  ADMIN,
  register,
  login,
  logout,
  uniqueName,
  apiPost,
  pickNodeId,
  clearRateLimits,
  getCsrfToken,
} from './helpers';

/**
 * v0.0.13（V13-02/03/04/07）：**补齐端点 + 跨接口一致性 + 隐私**真实 HTTP 验收
 *
 * 静态护栏只能证明「代码长这样」，本文件证明「跑起来真的是这样」：
 *
 *   · 三个新端点的真实状态码、响应头、载荷形状与参数语义
 *   · 同一节点 / 用户 / 主题通过不同接口返回时公共字段**含义一致**
 *   · 同一主题在 `topics/show.json` 的 `replies` 与 `replies/show.json`
 *     的条目数一致（不是各查各的缓存计数）
 *   · 软删除主题 / 回复不泄露；邮箱、口令哈希、令牌、积分不出现在任何载荷
 *   · 排序稳定（hot 按 replies 降序、replies 按 id 升序）
 *
 * 原站逐项契约与「有意偏离」登记在 `docs/LEGACY_API_MATRIX_v0.0.13.md`。
 */

test.describe.configure({ mode: 'serial' });

type Json = Record<string, unknown>;

/** 递归收集所有键，用于隐私断言 */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) keysOf(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

const PRIVATE = [
  'email', 'password', 'passwordHash', 'password_hash',
  'session', 'sessionToken', 'session_token', 'token', 'balance', 'csrf',
];

async function assertNoPrivateFields(res: import('@playwright/test').APIResponse) {
  const body = await res.json();
  const keys = keysOf(body);
  for (const secret of PRIVATE) expect(keys, `不应泄露 ${secret}`).not.toContain(secret);
}

test.describe('v0.0.13 补齐的三个旧版端点', () => {
  test('hot.json：200 数组、replies 严格降序、参数被忽略、响应头同原站', async ({ page }) => {
    await clearRateLimits(page);
    const res = await page.request.get('/api/topics/hot.json');
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] ?? '';
    expect(ct.toLowerCase()).toContain('application/json');
    expect(ct.toLowerCase()).toContain('charset=utf-8');
    expect(res.headers()['cache-control']).toContain('max-age=120');
    expect(res.headers()['x-rate-limit-limit']).toBe('600');

    const body = (await res.json()) as Json[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(10);
    const replies = body.map((t) => Number(t.replies));
    for (let i = 1; i < replies.length; i++) {
      expect(replies[i - 1], `hot 排序应在第 ${i} 项降序`).toBeGreaterThanOrEqual(replies[i]);
    }

    // 原站实测：limit / node_name / id 全被忽略。
    // 用「条数不变」而不是逐字节比对 —— 并行分片可能在两次请求间新建主题，
    // 逐字节比对的假红灯与兼容性本身无关。
    const withParams = await page.request.get('/api/topics/hot.json?limit=1&node_name=python&id=1');
    expect(withParams.status()).toBe(200);
    const withParamsBody = (await withParams.json()) as Json[];
    expect(withParamsBody.length).toBe(body.length);
    if (body.length > 1) expect(withParamsBody.length).toBeGreaterThan(1);
  });

  test('replies/show.json：任何异常参数都是 200 []，分页参数被忽略', async ({ page }) => {
    await clearRateLimits(page);
    for (const path of [
      '/api/replies/show.json',
      '/api/replies/show.json?topic_id=0',
      '/api/replies/show.json?topic_id=abc',
      '/api/replies/show.json?topic_id=999999999',
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 200`).toBe(200);
      expect(await res.json(), `${path} 应空数组`).toEqual([]);
    }

    const res = await page.request.get('/api/replies/show.json?topic_id=1');
    expect(res.headers()['cache-control']).toContain('max-age=60');
    const bare = (await res.json()) as Json[];
    const paged = (await (
      await page.request.get('/api/replies/show.json?topic_id=1&page=2&page_size=1')
    ).json()) as Json[];
    // page / page_size 被忽略：仍返回同一主题的全部回复
    expect(paged.length).toBe(bare.length);
    expect(paged.every((r) => Number(r.topic_id) === 1)).toBe(true);
  });

  test('nodes/list.json：缺任一参数 ⇒ 400 HTML；带齐参数 ⇒ 200 投影', async ({ page }) => {
    await clearRateLimits(page);
    for (const path of [
      '/api/nodes/list.json',
      '/api/nodes/list.json?fields=id&sort_by=id',
      '/api/nodes/list.json?fields=id&reverse=0',
      '/api/nodes/list.json?sort_by=id&reverse=0',
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} 应 400`).toBe(400);
      expect(res.headers()['content-type']).toContain('text/html');
      expect(await res.text()).toContain('400: Bad Request');
    }

    const ok = await page.request.get(
      '/api/nodes/list.json?fields=id,name,title,stars&sort_by=id&reverse=0',
    );
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toContain('application/json');
    expect(ok.headers()['cache-control']).toContain('max-age=30');
    const body = (await ok.json()) as Json[];
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(Object.keys(body[0]).sort()).toEqual(['id', 'name', 'stars', 'title']);
      // sort_by=id ⇒ id 降序（原站实测）
      const ids = body.map((n) => Number(n.id));
      for (let i = 1; i < ids.length; i++) expect(ids[i - 1]).toBeGreaterThanOrEqual(ids[i]);
    }

    const unknown = await (
      await page.request.get('/api/nodes/list.json?fields=bogus&sort_by=id&reverse=0')
    ).json() as Json[];
    expect(unknown.length).toBe(body.length);
    if (unknown.length > 0) expect(unknown[0]).toEqual({ bogus: null });

    // reverse 实测不生效：0 / 1 / 2 结果一致
    const r1 = await (
      await page.request.get('/api/nodes/list.json?fields=id&sort_by=id&reverse=1')
    ).text();
    const r0 = await (
      await page.request.get('/api/nodes/list.json?fields=id&sort_by=id&reverse=0')
    ).text();
    expect(r1).toBe(r0);
  });
});

test.describe('v0.0.13 跨接口字段一致性与隐私', () => {
  test('同一节点在 all/show/list/主题内嵌 node 中字段一致', async ({ page }) => {
    await clearRateLimits(page);
    const allRes = await page.request.get('/api/nodes/all.json');
    expect(allRes.status()).toBe(200);
    const all = (await allRes.json()) as Json[];
    expect(all.length).toBeGreaterThan(0);
    const target = all[0];
    const name = String(target.name);

    const show = (await (
      await page.request.get(`/api/nodes/show.json?name=${encodeURIComponent(name)}`)
    ).json()) as Json;
    const list = (await (
      await page.request.get(
        `/api/nodes/list.json?fields=id,name,title,topics,stars,founder_id,parent_node_name&sort_by=id&reverse=0`,
      )
    ).json()) as Json[];
    const fromList = list.find((n) => Number(n.id) === Number(target.id));

    for (const field of ['id', 'name', 'title', 'topics', 'stars', 'founder_id', 'parent_node_name']) {
      expect(show[field], `show.${field}`).toEqual(target[field]);
      expect(fromList?.[field], `list.${field}`).toEqual(target[field]);
    }

    // 主题内嵌 node 与节点详情端点同构（取该节点的主题）
    const topicsRes = await page.request.get(
      `/api/topics/show.json?node_name=${encodeURIComponent(name)}`,
    );
    if (topicsRes.status() === 200) {
      const topics = (await topicsRes.json()) as Json[];
      if (topics.length > 0) {
        const embedded = topics[0].node as Json;
        for (const field of ['id', 'name', 'title', 'topics', 'stars']) {
          expect(embedded[field], `embedded.${field}`).toEqual(target[field]);
        }
      }
    }
  });

  test('同一主题：replies 计数与 replies/show.json 条目数一致；member 字段一致', async ({ page }) => {
    await clearRateLimits(page);
    const username = uniqueName('v13_api');
    const { email: _email } = await register(page, username);
    const nodeId = await pickNodeId(page);

    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title: `v0.0.13 一致性 ${Date.now()}`,
      content: '跨接口一致性验证正文，包含 **Markdown** 与中文。',
    });
    expect(created.status()).toBe(201);
    const topicId = Number(
      ((await created.json()) as { redirect: string }).redirect.replace('/t/', ''),
    );

    const r1 = await apiPost(page, '/api/replies', { topicId, content: '第一条回复' });
    const r2 = await apiPost(page, '/api/replies', { topicId, content: '第二条回复' });
    expect([200, 201]).toContain(r1.status());
    expect([200, 201]).toContain(r2.status());

    const topicRes = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    const topics = (await topicRes.json()) as Json[];
    expect(topics).toHaveLength(1);
    const topic = topics[0];

    const repliesRes = await page.request.get(`/api/replies/show.json?topic_id=${topicId}`);
    expect(repliesRes.status()).toBe(200);
    const replies = (await repliesRes.json()) as Json[];
    expect(replies).toHaveLength(2);

    // 回复数与主题 replies 字段一致（不能各查各的、出现两个数）
    expect(Number(topic.replies)).toBe(replies.length);

    // 回复按 id 升序；8 键形状；member_id === member.id
    const ids = replies.map((r) => Number(r.id));
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    for (const r of replies) {
      expect(Object.keys(r).sort()).toEqual(
        ['content', 'content_rendered', 'created', 'id', 'last_modified', 'member', 'member_id', 'topic_id'].sort(),
      );
      expect(r.member_id).toEqual((r.member as Json).id);
      expect(Number(r.topic_id)).toBe(topicId);
      // Markdown 正文不得形成可执行 HTML
      expect(String(r.content_rendered)).not.toContain('<script');
      expect(String(r.content_rendered)).not.toContain('javascript:');
    }

    // member 详情端点与主题内嵌 member 同构
    const memberRes = await page.request.get(
      `/api/members/show.json?username=${encodeURIComponent(username)}`,
    );
    expect(memberRes.status()).toBe(200);
    const member = (await memberRes.json()) as Json;
    const embedded = topic.member as Json;
    for (const field of ['id', 'username', 'created', 'avatar_mini', 'pro']) {
      expect(embedded[field], `embedded.member.${field}`).toEqual(member[field]);
    }
    expect(member.status).toBe('found');

    // 隐私：三类载荷都不含私有字段
    await assertNoPrivateFields(topicRes);
    await assertNoPrivateFields(repliesRes);
    await assertNoPrivateFields(memberRes);

    // ID 与时间戳类型统一
    expect(Number.isInteger(topic.id)).toBe(true);
    expect(Number.isInteger(topic.created)).toBe(true);
    expect(Number.isInteger(replies[0].created)).toBe(true);

    await logout(page);
  });

  test('软删除主题：主题端点 200 []，回复端点也不泄露其内容', async ({ page }) => {
    await clearRateLimits(page);
    const username = uniqueName('v13_del');
    await register(page, username);
    const nodeId = await pickNodeId(page);

    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title: `v0.0.13 软删除 ${Date.now()}`,
      content: '删除后不得出现在任何公共接口',
    });
    expect(created.status()).toBe(201);
    const topicId = Number(
      ((await created.json()) as { redirect: string }).redirect.replace('/t/', ''),
    );
    const reply = await apiPost(page, '/api/replies', { topicId, content: '删前回复' });
    expect([200, 201]).toContain(reply.status());

    const before = await page.request.get(`/api/replies/show.json?topic_id=${topicId}`);
    expect((await before.json()) as Json[]).toHaveLength(1);

    const del = await page.request.delete(`/api/topics/${topicId}`, {
      headers: { 'x-csrf-token': await getCsrfToken(page) },
    });
    expect([200, 204]).toContain(del.status());

    const topicAfter = await page.request.get(`/api/topics/show.json?id=${topicId}`);
    expect(await topicAfter.json()).toEqual([]);
    const repliesAfter = await page.request.get(`/api/replies/show.json?topic_id=${topicId}`);
    expect(await repliesAfter.json()).toEqual([]);
    // hot / latest 也不得出现
    for (const path of ['/api/topics/hot.json', '/api/topics/latest.json']) {
      const body = (await (await page.request.get(path)).json()) as Json[];
      expect(body.map((t) => Number(t.id))).not.toContain(topicId);
    }

    await logout(page);
  });
});

/**
 * V13 收尾：非 active 节点不得从**任何**旧版 / Feed 公共路径泄露。
 *
 * 静态护栏只能证明「6 处查询都引用了 PUBLIC_NODE_CONDITION」，
 * 这里用真实 HTTP 证明「跑起来确实取不到」。
 *
 * 用现有管理员 API（`POST`/`PATCH /api/nodes`）建专用节点并隐藏，
 * 不新增任何对外 debug 后门，也不改动 seed 节点；
 * `finally` 无条件恢复为 active，避免污染并行分片。
 */
test.describe('v0.0.13 非 active 节点跨接口不泄露（真实 HTTP 负向验收）', () => {
  test('hidden 节点在目录 / 主题 / Feed 全部不可见，且用例结束恢复状态', async ({ page }) => {
    await clearRateLimits(page);
    await login(page, ADMIN.username, ADMIN.password);

    const nodeName = `v13hidden${Date.now().toString(36)}`;
    const created = await apiPost(page, '/api/nodes', {
      name: nodeName,
      title: `V13 节点可见性临时节点 ${nodeName}`,
      description: '用于验证非 active 节点不从公共端点泄露；用例结束恢复为 active',
    });
    expect(created.status(), '创建临时节点应 201').toBe(201);
    const createdBody = (await created.json()) as { id: number; status: string };
    const nodeId = Number(createdBody.id);
    expect(createdBody.status).toBe('active');

    // 在该节点下建一条主题，用于验证「按 id 查主题」这条路径也不泄露
    const topic = await apiPost(page, '/api/topics', {
      nodeId,
      title: `V13 隐藏节点主题 ${Date.now()}`,
      content: '验证 hidden 节点下的主题不进入旧版公共接口。',
    });
    expect(topic.status(), '临时节点下发帖应 201').toBe(201);
    const topicId = Number(
      ((await topic.json()) as { redirect: string }).redirect.replace('/t/', ''),
    );

    const csrf = await getCsrfToken(page);
    const setNodeStatus = (action: 'hide' | 'activate') =>
      page.request.patch('/api/nodes', {
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        data: { id: nodeId, action, reason: 'v0.0.13 节点可见性负向验收' },
      });

    try {
      // 前后对照（防「空数组假绿」）：节点仍 active 时先放一条探针回复，
      // 并证明它此刻确实可见；否则 hidden 之后断言 [] 说明不了任何事。
      const probe = await apiPost(page, '/api/replies', {
        topicId,
        content: 'V13 hidden 节点回复可见性探针',
      });
      expect([200, 201]).toContain(probe.status());
      const beforeHide = await page.request.get(`/api/replies/show.json?topic_id=${topicId}`);
      expect(beforeHide.status()).toBe(200);
      expect(
        (await beforeHide.json()) as Json[],
        'active 时探针回复必须可见，否则 hidden 后的 [] 是假合格证',
      ).toHaveLength(1);

      // 站内订阅的上半段对照：active 时该主题必须出现在 /api/feed 里，
      // 否则 hidden 后「不出现」同样是假合格证。
      const feedBeforeHide = await page.request.get('/api/feed');
      expect(feedBeforeHide.status()).toBe(200);
      expect(
        await feedBeforeHide.text(),
        'active 时主题必须出现在站内 Feed，否则后续断言无鉴别力',
      ).toContain(`/t/${topicId}`);

      const hidden = await setNodeStatus('hide');
      expect(hidden.status(), '隐藏节点应 200').toBe(200);

      // 1) 节点目录类端点
      const all = (await (await page.request.get('/api/nodes/all.json')).json()) as Json[];
      expect(all.map((n) => String(n.name)), 'all.json 不应列出 hidden 节点').not.toContain(
        nodeName,
      );

      const showRes = await page.request.get(`/api/nodes/show.json?name=${nodeName}`);
      expect(showRes.status(), 'show.json 对 hidden 节点应 404').toBe(404);

      const list = (await (
        await page.request.get('/api/nodes/list.json?fields=id,name&sort_by=id&reverse=0')
      ).json()) as Json[];
      expect(list.map((n) => String(n.name)), 'list.json 不应列出 hidden 节点').not.toContain(
        nodeName,
      );

      // 2) 主题端点：?node_name= 不认非 active 节点；按 id 查也不返回该主题
      const byName = await page.request.get(
        `/api/topics/show.json?node_name=${encodeURIComponent(nodeName)}`,
      );
      if (byName.status() === 200) {
        expect(await byName.json(), '?node_name= 命中 hidden 节点时应为空数组').toEqual([]);
      } else {
        expect(byName.status(), '?node_name= 对 hidden 节点应 404').toBe(404);
      }
      const byId = await page.request.get(`/api/topics/show.json?id=${topicId}`);
      expect(byId.status()).toBe(200);
      expect(await byId.json(), 'hidden 节点下的主题不得按 id 泄露').toEqual([]);

      // 前后对照下半段：同一条探针回复在节点 hidden 之后必须消失
      const repliesAfterHide = await page.request.get(
        `/api/replies/show.json?topic_id=${topicId}`,
      );
      expect(repliesAfterHide.status()).toBe(200);
      expect(await repliesAfterHide.json(), 'hidden 后探针回复必须不可见').toEqual([]);

      // 3) Feed：旧版节点 Feed 与站内节点 Feed 都不解析 hidden 节点
      for (const path of [
        `/feed/${nodeName}.xml`,
        `/feed/${nodeName}.json`,
        `/api/nodes/${nodeName}/feed`,
        `/api/nodes/${nodeName}/feed?format=json`,
      ]) {
        const res = await page.request.get(path);
        expect(res.status(), `${path} 对 hidden 节点应 404`).toBe(404);
      }

      // 4) 大小写不敏感：同一 hidden 节点用大写访问也不得绕过过滤
      const upperFeed = await page.request.get(`/feed/${nodeName.toUpperCase()}.xml`);
      expect(upperFeed.status(), '大写节点名同样不得绕过过滤').toBe(404);

      // 5) 站内订阅同样收敛：/api/feed、/api/feed/atom、/api/feed/json 都经
      //    buildFeedEntries()，hidden 之后不得再吐该节点下的主题。
      //    按 topic id 断言而不是标题（标题里带时间戳，正则不可靠）。
      const siteFeeds: Array<[string, (body: string) => boolean]> = [
        ['/api/feed', (body) => body.includes(`/t/${topicId}`)],
        ['/api/feed/atom', (body) => body.includes(`/t/${topicId}`)],
        ['/api/feed/json', (body) => body.includes(`/t/${topicId}`)],
      ];
      for (const [path, mentionsTopic] of siteFeeds) {
        const res = await page.request.get(path);
        expect(res.status(), `${path} 应 200`).toBe(200);
        const body = await res.text();
        expect(
          mentionsTopic(body),
          `${path} 仍含 hidden 节点下的主题 /t/${topicId}（站内订阅未收敛）`,
        ).toBe(false);
      }

      // 6) 全站 Feed 大小写一致：两者都走全站 Feed，不得一个 200 一个 404
      for (const path of ['/feed/all.xml', '/feed/ALL.xml']) {
        const res = await page.request.get(path);
        expect(res.status(), `${path} 应为 200`).toBe(200);
        expect(res.headers()['content-type'] ?? '', `${path} 应为 Atom`).toContain('atom+xml');
        expect((await res.text()).length, `${path} body 不得为空`).toBeGreaterThan(0);
      }
    } finally {
      // 无论断言成功与否都必须恢复，避免污染并行分片
      const restored = await setNodeStatus('activate');
      expect(restored.status(), '恢复节点为 active 应 200').toBe(200);
      await logout(page);
    }
  });
});
