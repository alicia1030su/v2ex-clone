import { test, expect } from '@playwright/test';
import {
  register,
  logout,
  uniqueName,
  apiPost,
  pickNodeId,
  clearRateLimits,
  getCsrfToken,
} from './helpers';

/**
 * v0.0.14：**标签链路真实可触达**验收
 *
 * ## 为什么这条 E2E 是必要的
 *
 * 加标签功能前，`tags` / `topic_tags` 表、主题页标签渲染、`/tag/[name]` 路由
 * **三者都存在**，但生产代码从不写入 ⇒ 标签页永远为空。
 * 这种「代码齐全、链路不通」的缺口，静态护栏和单元测试都发现不了：
 *
 *   · 单元测试可以证明 `normalizeTag('React') === 'react'`；
 *   · 静态护栏可以证明路由文件引用了 `attachTags`；
 *   · **只有真实 HTTP + 真实浏览器**能证明「用户发帖带标签 → 主题页显示 →
 *     点进去能到标签页 → 标签页里能看到这篇主题」这条链是通的。
 *
 * 本文件走完整链路，且断言**正反两面**（标签页能查到 / 无标签时不会凭空出现）。
 */

test.describe.configure({ mode: 'serial' });

test.describe('v0.0.14 标签链路', () => {
  test('发帖带标签 → 主题页可见 → 标签页可检索 → 大小写归一', async ({ page }) => {
    await clearRateLimits(page);
    const username = uniqueName('v14_tag');
    await register(page, username);
    const nodeId = await pickNodeId(page);

    // 用带时间戳的后缀避免与并行分片 / 历史数据串味
    const suffix = Date.now().toString(36);
    const tagA = `v14tag${suffix}`;
    // 故意用大小写混合 + 前后空白 + 井号，验证服务端规范化真的生效
    const rawTagB = `  #V14Case${suffix}  `;
    const normalizedB = `v14case${suffix}`;

    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title: `v0.0.14 标签链路 ${suffix}`,
      content: '验证标签从发布到展示到检索的完整链路。',
      tags: [tagA, rawTagB, '🔥', tagA],
    });
    expect(created.status(), '发帖应 201').toBe(201);

    const body = (await created.json()) as { topicId?: number; tags?: string[] };
    const topicId = Number(body.topicId);
    expect(Number.isInteger(topicId) && topicId > 0, '响应必须含结构化 topicId').toBe(true);

    // 响应里回显的标签就是规范化后的结果（去重 + 小写 + 去井号 + 丢弃非法）
    expect(body.tags, '响应应回显规范化后的标签').toEqual([tagA, normalizedB]);

    // 1) 主题页真实渲染标签链接
    await page.goto(`/t/${topicId}`);
    const tagLink = page.locator(`a.tag[href="/tag/${tagA}"]`);
    await expect(tagLink, '主题页应渲染标签链接').toBeVisible({ timeout: 15_000 });

    // 2) 点进标签页，能看到这篇主题（证明 topic_tags 关联真的写进去了）
    await tagLink.click();
    await expect(page).toHaveURL(new RegExp(`/tag/${tagA}$`));
    // ⚠️ TopicItem 渲染的是 `/t/{id}#reply{n}`（锚到最后一楼），
    //    用精确 `a[href="/t/11"]` 永远匹配不到 —— 第一版就是这么假红的。
    // `.first()` 是必须的：TopicItem 里标题与回复数**两个**链接都指向
    // `/t/11#reply0`，严格模式会因 2 个匹配而报「strict mode violation」。
    await expect(
      page.locator(`a[href^="/t/${topicId}#"], a[href="/t/${topicId}"]`).first(),
      '标签页应能检索到该主题',
    ).toBeVisible({ timeout: 15_000 });

    // 3) 大小写归一：用大写访问同一标签页仍应命中的是同一个标签
    //    （标签名已小写化，直接访问大写形式应 404 —— 这是「归一化」的可见证据）
    const upper = await page.request.get(`/tag/${normalizedB.toUpperCase()}`);
    expect(
      upper.status(),
      '标签名统一小写后，大写路径不应命中（否则说明库里存了两种写法）',
    ).toBe(404);

    // 4) 编辑追加标签：历史标签必须保留（最容易写错的语义）
    const extraTag = `v14extra${suffix}`;
    const edited = await page.request.put(`/api/topics/${topicId}`, {
      headers: {
        'Content-Type': 'application/json',
        // ⚠️ 必须用 helper 而不是手写 cookies().find()：
        //    localhost 与 127.0.0.1 会被浏览器视为两个站点，
        //    手写读取可能取到另一条同名 Cookie ⇒ 403（本仓已踩过）。
        'x-csrf-token': await getCsrfToken(page),
      },
      data: { tags: [extraTag] },
    });
    expect([200, 201]).toContain(edited.status());

    await page.goto(`/t/${topicId}`);
    await expect(page.locator(`a.tag[href="/tag/${tagA}"]`), '编辑后旧标签必须保留').toBeVisible();
    await expect(
      page.locator(`a.tag[href="/tag/${extraTag}"]`),
      '编辑后新标签应出现',
    ).toBeVisible();

    await logout(page);
  });

  test('不存在的标签页返回 404（不会凭空造标签）', async ({ page }) => {
    const res = await page.request.get(`/tag/${uniqueName('nosuchtag')}`);
    expect(res.status()).toBe(404);
  });

  test('【判别实验】中文标签的百分号编码路径必须能命中（决定是否需要 decodeURIComponent）', async ({ page }) => {
    // 这条用例是**判别实验**，不是普通的回归断言：
    // 若 Next.js 的 App Router **已经**解码动态段参数，则 `/tag/%E5%89%8D%E7%AB%AF`
    // 进来时 name 已是「前端」，页面里再 decode 一次是无害的幂等操作；
    // 若 Next **不**解码，则 name 是「%E5%89%8D%E7%AB%AF」，页面**必须** decode 才能命中。
    // 两种情况只能靠实测区分 — 上一版我凭猜测删掉了 decode，必须用数据说话。
    await clearRateLimits(page);
    const username = uniqueName('v14_cjk');
    await register(page, username);
    const nodeId = await pickNodeId(page);

    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title: `v0.0.14 中文标签判别 ${Date.now()}`,
      content: '用于验证百分号编码路径是否能命中中文标签。',
      tags: ['前端'],
    });
    expect(created.status()).toBe(201);

    const encoded = `/tag/${encodeURIComponent('前端')}`;
    const res = await page.request.get(encoded);
    expect(
      res.status(),
      `若此断言失败，说明页面缺少 decodeURIComponent（Next 未预解码）：${encoded}`,
    ).toBe(200);

    await logout(page);
  });

  test('标签名含 % 时不得 500（二次解码的边界）', async ({ page }) => {
    // 缺陷：Next.js 的 App Router 已经解码过动态段参数，页面里再
    // `decodeURIComponent(name)` 就是**二次解码** —— 遇到字面量 `%`
    // 会抛 `URIError: URI malformed`，整页 500。
    // 注意：`%25` 是 `%` 的编码，Next 解一次得到 `100%`，若页面再解一次就炸。
    const res = await page.request.get('/tag/100%25');
    expect(
      res.status(),
      '二次解码会让该路径 500；正确行为是「查不到这个标签」⇒ 404',
    ).toBe(404);
  });

  test('编辑模态点 × 移除标签：保存后该标签消失、未被移除的标签保留', async ({ page }) => {
    // 这条用例包含 **4 次整页导航 + 2 次组件内 `window.location.reload()`**，
    // 单次「保存 → 等 reload 完成」在本机实测就要 3~8s。
    // 全局 60s 是给单页用例定的，不够用；这里只放宽这一条的预算，
    // **不改任何断言的 expect 超时**（断言本身仍各有 10~30s 的显式上限）。
    test.setTimeout(180_000);
    /*
     * ## 这条用例补的是什么缺口
     *
     * 标签「移除」链路此前有**三段覆盖、一段空白**：
     *   · 服务层 `detachTags()` —— 真库测试覆盖（额度释放 / 幂等 / 不删本体）；
     *   · 路由转发 `removeTags` —— 静态护栏覆盖；
     *   · 页面接线 `initialTags` —— 静态护栏覆盖；
     *   · **「用户在浏览器里点 × → 保存 → 标签从页面上消失」** —— **零覆盖**。
     *
     * 前三段全绿也挡不住最后一段的缺陷（本仓 V4-04「编辑按钮点了没反应」
     * 就是「后端全对、界面够不着」）。而这段只有真浏览器能证明：
     * 静态断言只能证明"字符串存在"，证明不了 React 事件真的绑上了、
     * `removeTags` 真的进了请求体、保存后页面真的刷新成新状态。
     *
     * ## 为什么必须同时断言「保留的那个标签还在」
     *
     * 只断言"被移除的消失"时，一个把标签**全部**删掉的实现同样能通过
     * （`detachTags` 传了超过用户所选的范围、或表单把整组标签都提交了）。
     * 必须有一条**没被移除**的标签作为负向对照，才能证明"只删了该删的"。
     */
    await clearRateLimits(page);
    const username = uniqueName('v14_rmtag');
    await register(page, username);
    const nodeId = await pickNodeId(page);

    // 时间戳后缀：避免与并行分片 / 历史数据串味
    const suffix = Date.now().toString(36);
    const keepTag = `v14keep${suffix}`;
    const dropTag = `v14drop${suffix}`;

    const created = await apiPost(page, '/api/topics', {
      nodeId,
      title: `v0.0.14 移除标签 ${suffix}`,
      content: '用于验证「点 × 移除标签」这条纯前端链路的正文内容。',
      tags: [keepTag, dropTag],
    });
    expect(created.status(), '发帖应 201').toBe(201);
    const topicId = Number(((await created.json()) as { topicId?: number }).topicId);
    expect(Number.isInteger(topicId) && topicId > 0).toBe(true);

    await page.goto(`/t/${topicId}`);
    // 前置：两个标签都在页面上（否则下面的"消失"断言没有意义）
    await expect(
      page.locator(`a.tag[href="/tag/${keepTag}"]`),
      '前置条件：保留的标签应先出现',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`a.tag[href="/tag/${dropTag}"]`),
      '前置条件：待移除的标签应先出现',
    ).toBeVisible({ timeout: 15_000 });

    // 打开编辑模态（此按钮在 v0.0.3 曾是假按钮 —— 见 V4-04）
    await page.getByRole('button', { name: '编辑主题' }).first().click();
    const modal = page.locator('.topic_edit_modal');
    await expect(modal, '编辑模态必须真的出现').toBeVisible({ timeout: 15_000 });

    // chip 渲染本身就是 `initialTags` 接线成功的**运行时证据**
    // （静态护栏只能证明"源码里有 initialTags"，证明不了它真的到了 DOM）
    const dropChip = modal.locator(`[data-tag="${dropTag}"]`);
    await expect(
      dropChip,
      '当前标签必须以 chip 形式渲染出来（initialTags 接线失败就看不到）',
    ).toBeVisible({ timeout: 15_000 });
    await expect(modal.locator(`[data-tag="${keepTag}"]`)).toBeVisible();

    // 点 × 标记为待移除（视觉标灰，仍可撤销 —— 误点不该直接生效）
    // [NEG] 只点不保存

    await page.getByRole('button', { name: '保存修改' }).click();

    // 保存成功后组件会 `window.location.reload()`（见 TopicEditForm.submit）——
    // 不能同时调用 page.reload()，会与组件的导航竞争（本仓踩过）。
    await page.waitForLoadState('domcontentloaded');

    // 结果 1：被移除的标签从页面上消失
    await expect(
      page.locator(`a.tag[href="/tag/${dropTag}"]`),
      '保存后该标签必须消失（否则「移除」是假控件）',
    ).toHaveCount(0, { timeout: 30_000 });

    // 结果 2（负向对照）：没被移除的标签必须仍在
    await expect(
      page.locator(`a.tag[href="/tag/${keepTag}"]`),
      '未被移除的标签必须保留（防止实现把整组标签一起删掉）',
    ).toBeVisible({ timeout: 15_000 });

    // 结果 3：标签页语义 —— 移除只删「关联」，不删标签本体。
    //
    // `detachTags()` 刻意**不删 `tags` 行**（同名标签可能被其它主题使用），
    // 而 `/tag/[name]` 的判据是「`schema.tags` 里有没有这个名字」：
    //   `if (!tagRows[0]) notFound();`
    // ⇒ 移除关联后标签本体仍在 ⇒ 标签页 **200 + 空列表**，**不是 404**。
    //   404 只留给「库里根本没有这个标签名」。
    //
    // ⚠️ 若这里得到 404，说明实现把 `tags` 行也删了 —— 那会影响其它主题
    //    对同名标签的使用（「删自己的关联」变成「替别人删标签」）。
    //
    // ⚠️ 断言必须用**精确 href 正则**，不能用 `toContain('/t/' + topicId)`：
    //    `toContain('/t/12')` 会被 `/t/123` 命中 ⇒ 「主题其实还在」也能过（假绿）。
    const topicHref = new RegExp(`href="/t/${topicId}(#[^"]*)?"`);

    const dropPage = await page.request.get(`/tag/${encodeURIComponent(dropTag)}`);
    expect(dropPage.status(), '移除关联后标签本体仍在 ⇒ 标签页应 200').toBe(200);
    expect(
      topicHref.test(await dropPage.text()),
      '该主题不得再出现在被移除标签的列表里（精确匹配 /t/{id}，不是前缀）',
    ).toBe(false);

    const keepPage = await page.request.get(`/tag/${encodeURIComponent(keepTag)}`);
    expect(keepPage.status(), '保留标签的标签页应 200').toBe(200);
    expect(
      topicHref.test(await keepPage.text()),
      '保留标签仍能检索到该主题（同一正则，正向对照）',
    ).toBe(true);

    // 结果 4：移除不是单向破坏 —— 编辑里能再加回来。
    //
    // ⚠️ 选择器必须用 `name`，不能用 `#topic_tags_add`：
    //    该 input 的 id 是模板串 `topic-tags-add-${topicId}`（连字符），
    //    name 才是 `topic_tags_add`（下划线）。写 `#topic_tags_add` 会匹配不到
    //    ⇒ fill 一直等到超时，报错只写「Timeout」，指不到真正原因。
    await page.goto(`/t/${topicId}`);
    await page.getByRole('button', { name: '编辑主题' }).first().click();
    await expect(page.locator('.topic_edit_modal')).toBeVisible({ timeout: 15_000 });
    // 前置：此时 chips 里只剩 keepTag（证明上一次移除真的落库了）
    await expect(page.locator(`.topic_edit_modal [data-tag="${keepTag}"]`)).toBeVisible();
    await expect(page.locator(`.topic_edit_modal [data-tag="${dropTag}"]`)).toHaveCount(0);

    await page
      .locator('.topic_edit_modal input[name="topic_tags_add"]')
      .fill(dropTag);
    await page.getByRole('button', { name: '保存修改' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.locator(`a.tag[href="/tag/${dropTag}"]`),
      '移除后必须还能加回来（否则「移除」是不可逆的破坏）',
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(`a.tag[href="/tag/${keepTag}"]`),
      '往返之后原有的 keepTag 也不能丢',
    ).toBeVisible({ timeout: 15_000 });

    await logout(page);
  });
});
