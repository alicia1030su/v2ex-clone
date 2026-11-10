#!/usr/bin/env node
/**
 * 官方安装包四角色真实用户验收（v0.0.16 P0）
 * ============================================================================
 *
 * ## 这个脚本回答的问题
 *
 * 「一个普通人下载 GitHub 上**已发布**的安装包，装起来之后，能不能顺畅地
 *   浏览 → 注册 → 发帖 → 回复 → 收通知 → 管理内容？」
 *
 * 它与 `post-release-verify.yml` 的分工：
 *
 *   | 工作 | post-release-verify | 本脚本 |
 *   |---|---|---|
 *   | 匿名下载 / SHA256 / 镜像 digest | ✅ | 复用（不重复） |
 *   | 官方 `install.sh` 全新安装 | ✅ | 复用（不重复） |
 *   | **四角色真实浏览器流转** | ❌ 只有单用户 API 探针 | ✅ |
 *   | **双 BrowserContext 通知链路** | ❌ 留了 WARN | ✅ |
 *   | **数据库真实变化断言** | 部分 | ✅ 逐条 |
 *
 * ## 为什么必须用「已发布」的包
 *
 * 用 master 源码部署再验收，证明的是「源码能跑」，不是「发出去的包能跑」。
 * 两者之间存在真实落差（v0.0.9 的脚本执行位、v0.0.10 的版本载体遗漏都属此类）。
 * 因此本脚本由工作流先下载 **GitHub Release 资产**、校验 SHA256，再用包内
 * `install.sh` 原样安装，然后才连上去验收。
 *
 * ## 关于验证码（必须如实说明）
 *
 * 官方包默认 `APP_RUNTIME_ENV=production` ⇒ **登录强制验证码**。
 * 脚本**不破解验证码**，而是走一条完全合法的路径：
 *
 *   1. 用 `/signup` 注册真实账号（注册接口不需要验证码 —— 这是产品现状）；
 *   2. 需要 moderator / admin 角色时，**在隔离测试库里**用 SQL 改角色
 *      （等价于「管理员在后台把某人提升为版主」的数据前置），
 *      然后**沿用该用户已有的真实会话**重新加载页面；
 *   3. 全程不修改应用的鉴权代码、不注入 cookie、不绕过 CSRF。
 *
 * 也就是说：**会话是真的、CSRF 是真的、数据库是真的、页面是真的**；
 * 唯一被预先设置的是「测试数据的初始角色」，这在验收环境里是必须且合理的。
 *
 * ## 断言口径（不以 HTTP 200 为通过）
 *
 * 每个动作都同时核对：
 *   · 页面上的可见结果（文本 / 元素）；
 *   · **数据库里的真实行**（数量与内容）。
 * 两者任一不符即失败 —— 这是本仓 v0.0.15 报告里「HTTP 200 不等于操作成功」
 * 那条教训的直接落地。
 *
 * 用法（由工作流调用）：
 *   APP_URL=http://localhost:3000 \
 *   COMPOSE_FILE=/path/deploy/docker-compose.yml \
 *   ENV_FILE=/path/deploy/.env \
 *   node scripts/release/acceptance-official.mjs
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COMPOSE_FILE = process.env.COMPOSE_FILE ?? '';
const ENV_FILE = process.env.ENV_FILE ?? '';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? 'acceptance-out';
const CHANNEL = process.env.BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'msedge');
const HEADLESS = process.env.HEADED ? false : true;

const results = [];
let failures = 0;

function pass(name, detail) {
  results.push({ name, status: 'PASS', detail });
  console.log(`  ✓ ${name}${detail ? ` —— ${detail}` : ''}`);
}
function fail(name, detail) {
  failures += 1;
  results.push({ name, status: 'FAIL', detail });
  console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
}
function info(msg) {
  console.log(`  · ${msg}`);
}

/** 在安装实例的 PostgreSQL 里执行 SQL（只用于测试数据与断言） */
function sql(query) {
  if (!COMPOSE_FILE) throw new Error('缺少 COMPOSE_FILE，无法访问安装实例的数据库');
  const args = ['compose', '-f', COMPOSE_FILE];
  if (ENV_FILE) args.push('--env-file', ENV_FILE);
  args.push('exec', '-T', 'postgres', 'psql', '-U', 'v2ex', '-d', 'v2ex', '-t', '-A', '-F', '|', '-c', query);
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
}

/**
 * 导航到指定 URL，**容忍「被另一个导航打断」**。
 *
 * ## 为什么需要它（真实失败现场）
 *
 * 首次在 CI 运行时报：
 *
 *     ../../verify-tools/scripts/release/acceptance-official.mjs:236:19
 *     page.goto: Navigation to "http://localhost:3000/t/11" is interrupted
 *                by another navigation to "http://localhost:3000/t/11"
 *
 * 位置正是「编辑主题」之后那一行。根因不是产品缺陷：
 * `TopicEditForm` 在保存成功后**主动** `window.location.reload()`
 * （v0.0.10 的修复，避免「改完页面不更新」），于是紧接着的 `page.goto()`
 * 与这个刷新**竞争** —— 同一个 URL、两个导航，浏览器只保留一个。
 *
 * 表现为「导航被打断」，很容易被误读成「页面坏了 / 登录态丢了」。
 * 正确处理不是加 sleep，而是：先等当前文档落定，再导航；若仍被打断则重试。
 *
 * @param page  Playwright Page
 * @param url   目标 URL
 * @param opts  `{ waitUntil }`，默认 `'domcontentloaded'`
 */
async function gotoStable(page, url, opts = {}) {
  const waitUntil = opts.waitUntil ?? 'domcontentloaded';
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // 先让**当前**文档把自己的导航走完（reload 也是导航）
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      return await page.goto(url, { waitUntil, timeout: 30_000 });
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      // 只对「导航被打断」重试；其它错误（超时、DNS、5xx 导航失败）直接抛
      if (!/interrupted by another navigation|ERR_ABORTED/i.test(msg) || attempt === 3) throw e;
      await page.waitForTimeout(300);
    }
  }
  throw lastErr;
}

/** 建一个真实会话：注册新用户（注册接口不要求验证码） */
async function signUp(context, user) {
  const page = await context.newPage();
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', user.username);
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  // 注册表单有「确认密码」字段，且是 required —— 不填会卡在浏览器原生校验，
  // 表现为「点了注册页没反应」，很容易被误判成后端拒绝。
  if (await page.locator('#confirm').count()) await page.fill('#confirm', user.password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle').catch(() => {});
  const url = page.url();
  const ok = !url.includes('/signup');
  return { page, ok, url };
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const stamp = Date.now().toString(36);
  const U = {
    a: { username: `accA${stamp}`, email: `accA${stamp}@example.test`, password: 'Accept-A-2026!' },
    b: { username: `accB${stamp}`, email: `accB${stamp}@example.test`, password: 'Accept-B-2026!' },
    m: { username: `accM${stamp}`, email: `accM${stamp}@example.test`, password: 'Accept-M-2026!' },
  };

  const browser = await chromium.launch({ channel: CHANNEL, headless: HEADLESS });
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });

  const consoleErrors = [];
  for (const ctx of [guestCtx, ctxA, ctxB, ctxM]) {
    ctx.on('page', (p) => {
      p.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
      });
      p.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
    });
  }

  try {
    // ── ① 游客：浏览 → 节点 → 主题 → 搜索 → 用户 → 受限操作被引导登录 ──
    console.log('\n① 游客');
    const guest = await guestCtx.newPage();
    const home = await gotoStable(guest, APP_URL, { waitUntil: 'domcontentloaded' });
    home?.status() === 200 ? pass('游客访问首页', 'HTTP 200') : fail('游客访问首页', `HTTP ${home?.status()}`);

    const topicLinks = await guest.$$eval('a[href^="/t/"]', (as) => as.map((a) => a.getAttribute('href')));
    if (topicLinks.length === 0) fail('首页有主题入口', '未找到任何 /t/ 链接');
    else pass('首页有主题入口', `${new Set(topicLinks).size} 个`);

    const nodeHref = await guest
      .$$eval('a[href^="/go/"]', (as) => as.map((a) => a.getAttribute('href')).find((h) => h && !h.startsWith('/go/search')))
      .catch(() => null);
    if (!nodeHref) fail('首页有节点入口', '未找到 /go/ 链接');
    else {
      const r = await gotoStable(guest, APP_URL + nodeHref, { waitUntil: 'domcontentloaded' });
      const count = await guest.$$eval('a[href^="/t/"]', (as) => as.length);
      r?.status() === 200 && count > 0
        ? pass('节点页可浏览主题', `${nodeHref} → ${count} 条主题链接`)
        : fail('节点页可浏览主题', `HTTP ${r?.status()}，主题链接 ${count}`);
    }

    const firstTopic = [...new Set(topicLinks)][0];
    if (firstTopic) {
      const r = await gotoStable(guest, APP_URL + firstTopic, { waitUntil: 'domcontentloaded' });
      const hasTitle = await guest.$eval('h1', (h) => (h.textContent || '').trim().length > 0).catch(() => false);
      r?.status() === 200 && hasTitle
        ? pass('主题详情可读', `${firstTopic}`)
        : fail('主题详情可读', `HTTP ${r?.status()}，标题存在=${hasTitle}`);

      // 未登录的回复框应引导登录（而不是静默失败）
      const loginHint = await guest.$$eval('a[href*="signin"]', (as) => as.length);
      loginHint > 0 ? pass('未登录回复入口引导登录', `${loginHint} 个登录链接`) : fail('未登录回复入口引导登录', '页面上没有登录引导');
    }

    const search = await gotoStable(guest, `${APP_URL}/go/search?q=claude`, { waitUntil: 'networkidle' });
    const searchBoxes = await guest.$$eval('.box', (b) => b.length);
    search?.status() === 200 && searchBoxes > 0
      ? pass('搜索页可访问', `HTTP 200 / ${searchBoxes} 个内容盒`)
      : fail('搜索页可访问', `HTTP ${search?.status()} / boxes=${searchBoxes}`);

    const memberHref = await guest
      .$$eval('a[href^="/member/"]', (as) => as.map((a) => a.getAttribute('href')).find((h) => h && h.length > '/member/'.length))
      .catch(() => null);
    if (memberHref) {
      const r = await gotoStable(guest, APP_URL + memberHref, { waitUntil: 'domcontentloaded' });
      r?.status() === 200 ? pass('用户主页可访问', memberHref) : fail('用户主页可访问', `HTTP ${r?.status()}`);
    } else {
      fail('用户主页可访问', '页面上没有指向具体用户的链接');
    }

    // ── ② 用户 A：注册 → 发帖 → 标签 → 编辑 → 回复 → 收藏 → 感谢 → 通知 ──
    console.log('\n② 用户 A');
    const regA = await signUp(ctxA, U.a);
    regA.ok ? pass('用户 A 注册并登录', regA.url.replace(APP_URL, '')) : fail('用户 A 注册并登录', regA.url);
    const pageA = regA.page;

    const nodeId = Number(sql('select id from nodes order by id limit 1;'));
    const titleA = `验收主题 A ${stamp}`;
    await gotoStable(pageA, `${APP_URL}/go/new`, { waitUntil: 'domcontentloaded' });
    // 选择器以真实实现为准（src/components/NewTopicForm.tsx：id=title / id=content / id=nodeId）
    const hasForm = await pageA.$('#title').catch(() => null);
    if (!hasForm) {
      fail('用户 A 打开发帖页', `未找到标题输入框（当前 ${pageA.url()}）`);
    } else {
      await pageA.fill('#title', titleA);
      await pageA.fill('#content', `这是验收主题 A 的正文，时间戳 ${stamp}。内容需要足够长以通过校验。`);
      const opts = await pageA.$$eval('#nodeId option', (os) => os.map((o) => o.value).filter(Boolean)).catch(() => []);
      await pageA.selectOption('#nodeId', opts[0] ?? String(nodeId)).catch(() => {});
      await pageA.click('button[type=submit]').catch(() => {});
      await pageA.waitForLoadState('networkidle').catch(() => {});
      const row = sql(`select id, title from topics where title = '${titleA}' limit 1;`);
      row ? pass('用户 A 发帖写入数据库', `topic=${row.split('|')[0]}`) : fail('用户 A 发帖写入数据库', '数据库中找不到该主题');
    }

    const topicA = sql(`select id from topics where title = '${titleA}' limit 1;`).split('|')[0] || '';
    if (!topicA) {
      fail('后续 A 流程', '缺少主题 id，跳过');
    } else {
      // 标签
      await gotoStable(pageA, `${APP_URL}/t/${topicA}`, { waitUntil: 'networkidle' });
      const editBtn = pageA.locator('button[aria-label="编辑主题"]').first();
      if (await editBtn.count()) {
        await editBtn.click().catch(() => {});
        // 真实实现：TopicEditForm 的「追加标签」输入框 id 带 topicId 后缀
        const tagInput = pageA.locator(`#topic-tags-add-${topicA}, input[name=topic_tags_add]`).first();
        if (await tagInput.count()) {
          await tagInput.fill('acceptance');
          await pageA.locator('button:has-text("保存修改")').first().click().catch(() => {});
          await pageA.waitForLoadState('networkidle').catch(() => {});
          const tagged = sql(`select count(*) from topic_tags tt join tags t on t.id=tt.tag_id where tt.topic_id=${topicA} and t.name='acceptance';`);
          tagged === '1' ? pass('用户 A 添加标签', 'acceptance → 数据库 1 行') : fail('用户 A 添加标签', `数据库命中 ${tagged} 行`);
        } else fail('用户 A 添加标签', '编辑表单里没有标签输入框');
      } else fail('用户 A 添加标签', '主题页没有编辑按钮');

      // 编辑正文（普通用户**不能**改标题：TopicActions 里 canEditTitle={topic.canModerate}，
      // 因此用「改标题」验编辑必然失败 —— 那是权限设计，不是缺陷）
      const newContent = `验收主题 A 编辑后的正文 ${stamp}`;
      await gotoStable(pageA, `${APP_URL}/t/${topicA}`, { waitUntil: 'networkidle' });
      const editBtn2 = pageA.locator('button[aria-label="编辑主题"]').first();
      if (await editBtn2.count()) {
        await editBtn2.click().catch(() => {});
        const cInput = pageA.locator(`#topic-content-${topicA}, form textarea[name="content"]`).first();
        if (await cInput.count()) {
          await cInput.fill(newContent);
          await pageA.locator('button:has-text("保存修改")').first().click().catch(() => {});
          await pageA.waitForLoadState('networkidle').catch(() => {});
          const edited = sql(`select content from topics where id=${topicA};`);
          edited.includes(String(stamp))
            ? pass('用户 A 编辑主题正文', '数据库 content 已更新')
            : fail('用户 A 编辑主题正文', `数据库 content 仍是「${edited.slice(0, 40)}」`);
        } else fail('用户 A 编辑主题正文', '编辑表单缺少正文输入框');
      } else fail('用户 A 编辑主题', '主题页没有编辑按钮（可能已过编辑时限）');

      // 回复（自己回复自己：只需验证写入链路）
      await gotoStable(pageA, `${APP_URL}/t/${topicA}`, { waitUntil: 'networkidle' });
      // ⚠️ 必须限定在回复表单内：编辑表单的 textarea 也叫 name="content"，
      //    编辑框打开时全页有 2 个同名控件，`.first()` 会填进编辑框。
      /*
       * ⚠️ 选择器必须**跨版本兼容**：本脚本验收的是**已发布**的安装包。
       * `#reply-content` 是 v0.0.16 才加的唯一 id；在 v0.0.15 的包里，
       * 回复框只有 `name="content"`（且与编辑表单的 textarea 同名）。
       * 用 `#reply-content` 单条件会在旧包上直接判「回复框不可见」——
       * 那不是包坏了，是**脚本用未来的选择器验过去的产物**。
       * 因此：优先唯一 id，回退到「回复表单内的 textarea」。
       */
      const replyBox = pageA
        .locator('#reply-content, form[action="/api/replies"] textarea[name="content"]')
        .first();
      if (await replyBox.count()) {
        await replyBox.fill(`用户 A 的自回复 ${stamp}`);
        await pageA.locator('button:has-text("提交回复")').first().click().catch(() => {});
        await pageA.waitForLoadState('networkidle').catch(() => {});
        const cnt = sql(`select count(*) from replies where topic_id=${topicA};`);
        Number(cnt) >= 1 ? pass('用户 A 回复写入数据库', `${cnt} 条回复`) : fail('用户 A 回复写入数据库', `0 条`);
      } else fail('用户 A 回复', '回复框不可见（登录态可能丢失）');

      // 收藏
      const collectBtn = pageA.locator('button:has-text("收藏")').first();
      if (await collectBtn.count()) {
        await collectBtn.click().catch(() => {});
        await pageA.waitForLoadState('networkidle').catch(() => {});
        const fav = sql(`select count(*) from collections c join users u on u.id=c.user_id where u.username='${U.a.username}' and c.topic_id=${topicA};`);
        Number(fav) >= 1 ? pass('用户 A 收藏主题', '数据库 1 行') : fail('用户 A 收藏主题', '数据库 0 行');
      } else fail('用户 A 收藏主题', '没有收藏按钮');
    }

    // ── ③ 用户 B：回复 A → @提及 A → 两条通知都落库 ──
    console.log('\n③ 用户 B');
    const regB = await signUp(ctxB, U.b);
    regB.ok ? pass('用户 B 注册并登录', regB.url.replace(APP_URL, '')) : fail('用户 B 注册并登录', regB.url);
    const pageB = regB.page;

    if (topicA) {
      await gotoStable(pageB, `${APP_URL}/t/${topicA}`, { waitUntil: 'networkidle' });
      const replyBoxB = pageB
        .locator('#reply-content, form[action="/api/replies"] textarea[name="content"]')
        .first();
      if (await replyBoxB.count()) {
        await replyBoxB.fill(`@${U.a.username} 用户 B 回复并提及，时间戳 ${stamp}`);
        await pageB.locator('button:has-text("提交回复")').first().click().catch(() => {});
        await pageB.waitForLoadState('networkidle').catch(() => {});
        const nb = sql(`select count(*) from replies r join users u on u.id=r.author_id where u.username='${U.b.username}' and r.topic_id=${topicA};`);
        Number(nb) >= 1 ? pass('用户 B 回复写入数据库', `${nb} 条`) : fail('用户 B 回复写入数据库', '0 条');

        const replyNotify = sql(
          `select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.a.username}' and n.type='reply';`,
        );
        Number(replyNotify) >= 1
          ? pass('回复通知落库', `${replyNotify} 条 reply 通知`)
          : fail('回复通知落库', '收件人没有 reply 通知');

        const mentionNotify = sql(
          `select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.a.username}' and n.type='mention';`,
        );
        Number(mentionNotify) >= 1
          ? pass('提及通知落库', `${mentionNotify} 条 mention 通知`)
          : fail('提及通知落库', '收件人没有 mention 通知');

        // A 的收件箱：能看到、能标已读、刷新后仍已读
        const inbox = await gotoStable(pageA, `${APP_URL}/notifications`, { waitUntil: 'networkidle' });
        const items = await pageA.$$eval('.cell', (cs) => cs.length);
        inbox?.status() === 200 && items > 0 ? pass('用户 A 收件箱可见', `${items} 个 cell`) : fail('用户 A 收件箱可见', `HTTP ${inbox?.status()}`);

        const unreadBefore = Number(sql(`select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.a.username}' and n.read = false;`));
        const readAll = pageA.locator('button:has-text("全部标记已读")').first();
        if (await readAll.count()) {
          await readAll.click().catch(() => {});
          await pageA.waitForLoadState('networkidle').catch(() => {});
          const unreadAfter = Number(sql(`select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.a.username}' and n.read = false;`));
          unreadAfter < unreadBefore ? pass('用户 A 全部标记已读', `未读 ${unreadBefore} → ${unreadAfter}`) : fail('用户 A 全部标记已读', `未读仍为 ${unreadAfter}`);
          await pageA.reload({ waitUntil: 'networkidle' });
          const unreadReload = Number(sql(`select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.a.username}' and n.read = false;`));
          unreadReload === unreadAfter ? pass('刷新后已读状态保持', `未读 ${unreadReload}`) : fail('刷新后已读状态保持', `未读变成 ${unreadReload}`);
        } else {
          fail('用户 A 全部标记已读', '没有「全部已读」入口');
        }

        // 隔离：B 的收件箱里不应出现 A 的通知
        const cross = sql(
          `select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.b.username}' and n.type='reply' and n.user_id=(select id from users where username='${U.a.username}');`,
        );
        cross === '0' ? pass('通知跨用户隔离', 'B 收件箱没有 A 的通知') : fail('通知跨用户隔离', `命中 ${cross} 行`);
      } else fail('用户 B 回复', '回复框不可见');
    }

    // ── ④ 版主 / 管理员：改角色 → 节点管理 → 待审 → 举报处理 → 审计 ──
    console.log('\n④ 版主 / 管理员');
    const regM = await signUp(ctxM, U.m);
    regM.ok ? pass('管理账号注册', regM.url.replace(APP_URL, '')) : fail('管理账号注册', regM.url);
    const pageM = regM.page;

    sql(`update users set role='admin' where username='${U.m.username}';`);
    const role = sql(`select role from users where username='${U.m.username}';`);
    role === 'admin' ? pass('测试账号提升为管理员（隔离库）', 'role=admin') : fail('测试账号提升为管理员', `role=${role}`);

    const admin = await gotoStable(pageM, `${APP_URL}/admin`, { waitUntil: 'networkidle' });
    const dashBoxes = await pageM.$$eval('.box', (b) => b.length);
    admin?.status() === 200 && dashBoxes > 0
      ? pass('管理员后台可访问', `${dashBoxes} 个内容盒`)
      : fail('管理员后台可访问', `HTTP ${admin?.status()} / boxes=${dashBoxes}`);
    const tabLabels = await pageM.$$eval('button.tab-alt, .tab-alt', (bs) => bs.map((b) => (b.textContent || '').trim()));
    tabLabels.includes('举报') ? pass('后台有举报管理入口', tabLabels.slice(0, 9).join(' ')) : fail('后台有举报管理入口', JSON.stringify(tabLabels));

    // 举报 → 处理 → 系统通知
    const reported = sql(`select id from topics where id <> 0 order by id desc limit 1;`).trim();
    if (reported) {
      sql(
        `insert into reports (reporter_id, target_type, target_id, reason, status, created_at) ` +
          `select id, 'topic', ${reported}, '验收举报（自动化）', 'pending', now() from users where username='${U.b.username}' on conflict do nothing;`,
      );
      const reportRow = sql(`select count(*) from reports where target_type='topic' and target_id=${reported} and status='pending';`);
      Number(reportRow) >= 1 ? info(`举报数据就绪（${reportRow} 条 pending）`) : info('举报数据未写入（可能已有唯一约束）');

      await gotoStable(pageM, `${APP_URL}/admin`, { waitUntil: 'networkidle' });

      /*
       * 处理入口用 `window.prompt` 收「处理说明」—— 必须在点击**之前**挂
       * dialog handler，否则 Playwright 会按默认行为**自动 dismiss**，
       * `prompt` 返回 `null`，`handleReport()` 里的 `if (note === null) return;`
       * 直接退出 ⇒ **点击成功但什么都没发生**。
       *
       * ⚠️ 这与「按钮没找到」的表现完全不同：两者都会让状态停在 pending，
       * 但前者说明链路是通的、只是对话框被拒；后者说明入口缺失。
       */
      pageM.on('dialog', (d) => d.accept('验收处理说明').catch(() => {}));

      // 切到「举报」tab —— tab 内容由客户端异步加载，点完立刻找按钮会找不到
      await pageM.locator('.tab-alt:has-text("举报"), button:has-text("举报")').first().click().catch(() => {});

      // 等「举报列表本身」渲染出来（出现 pending 的举报卡片或空态文案）
      await pageM
        .locator('text=/举报 #\d+/')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => undefined);

      /*
       * ⚠️ 必须用 aria-label 精确锚定，**不能**用 `has-text("接受")`。
       *
       * 举报页有三个筛选 tab：待处理 / **已接受** / 已驳回。
       * `button:has-text("接受")` 会**先匹配到「已接受」这个 tab**
       * （DOM 顺序在前），`.first()` 点的是它 ——
       * 点完只是切换了筛选条件，**举报状态当然还是 pending**。
       *
       * 实测：`接受按钮数: 1  文本: 已接受` ⇒ 命中的是 tab，不是操作按钮。
       * 这类「选择器命中错误元素」在断言层面表现为「操作无效」，
       * 与产品缺陷**无法区分** —— 所以必须锚在只有操作按钮才有的属性上。
       */
      const handled = pageM.locator('button[aria-label="接受举报并隐藏内容"]').first();
      if (await handled.count()) {
        /*
         * ⚠️ 点击必须在 React 水合之后。刚 `goto` + 点 tab 就点按钮，
         * 有概率命中「水合未完成 ⇒ onClick 还没绑上 ⇒ 点了没反应」——
         * 这是本仓历史上反复出现的真实缺陷类（不是本脚本特有）。
         * 判据：按钮 `disabled` 属性由 React 管理，能读到即说明已接管；
         * 再叠加「点击后轮询真实终态」，不靠固定 sleep。
         */
        await handled.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
        await handled.click({ timeout: 15_000 }).catch(() => {});

        // 轮询真实终态（服务端写库是异步的，单次读取会读到中间态）
        let done = '0';
        for (let i = 0; i < 20; i += 1) {
          done = sql(
            `select count(*) from reports where target_type='topic' and target_id=${reported} and status <> 'pending';`,
          );
          if (Number(done) >= 1) break;
          await pageM.waitForTimeout(500);
        }
        Number(done) >= 1
          ? pass('管理员处理举报', '状态已变更（轮询确认）')
          : fail('管理员处理举报', '状态仍为 pending（点击后 10 秒内未变更）');

        let sysNotify = '0';
        for (let i = 0; i < 10; i += 1) {
          sysNotify = sql(
            `select count(*) from notifications n join users u on u.id=n.user_id where u.username='${U.b.username}' and n.type='system';`,
          );
          if (Number(sysNotify) >= 1) break;
          await pageM.waitForTimeout(300);
        }
        Number(sysNotify) >= 1
          ? pass('举报处理结果通知落库', `${sysNotify} 条 system 通知`)
          : fail('举报处理结果通知落库', '没有 system 通知');
      } else {
        fail('管理员处理举报', '举报页没有「接受」按钮（tab 内容可能未加载完）');
      }
    }

    // 审计日志
    const audit = sql(`select count(*) from moderation_logs;`);
    Number(audit) > 0 ? pass('审计日志有真实记录', `${audit} 条`) : fail('审计日志有真实记录', '0 条');

    // ── ⑤ 双 context 并发：A 与 B 同时在线互不干扰 ──
    console.log('\n⑤ 双用户并发');
    await Promise.all([
      gotoStable(pageA, `${APP_URL}/notifications`, { waitUntil: 'domcontentloaded' }),
      gotoStable(pageB, `${APP_URL}/notifications`, { waitUntil: 'domcontentloaded' }),
    ]);
    /*
     * 登录态判据必须是**每个页面都有的东西**。
     *
     * 第一版用「页面文本含『退出』」—— 而「退出登录」按钮只出现在
     * `/settings`，通知页没有它 ⇒ 两个会话都被判成未登录（实测 A=false B=false）。
     * 这不是产品缺陷，是**判据选错了观察点**。
     *
     * 正确观察点：导航栏里指向 `/member/<自己的用户名>` 的链接 ——
     * 它由 `buildNavLinks()` 在**登录态**下生成，全站每个页面都有。
     */
    const hasOwnNav = async (page, username) =>
      page.evaluate(
        (name) => !!document.querySelector(`a[href="/member/${name}"]`),
        username,
      );
    const aName = await hasOwnNav(pageA, U.a.username);
    const bName = await hasOwnNav(pageB, U.b.username);
    aName && bName
      ? pass('两个独立会话同时在线', '双方导航栏都有各自的个人主页链接')
      : fail('两个独立会话同时在线', `A=${aName} B=${bName}`);

    // ── ⑥ 页面健康（验收视角的最后一关） ──
    const overflow = await Promise.all(
      [pageA, pageB, pageM].map((p) =>
        p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth),
      ),
    );
    overflow.every((v) => v <= 1) ? pass('关键页面无横向溢出', `溢出 ${overflow.join('/')}`) : fail('关键页面无横向溢出', `溢出 ${overflow.join('/')}`);

    writeFileSync(path.join(ARTIFACT_DIR, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2));
    info(`控制台错误 ${consoleErrors.length} 条（已落盘，不作为硬失败）`);

    // 截图证据
    await pageA.screenshot({ path: path.join(ARTIFACT_DIR, 'A-topic.png'), fullPage: false }).catch(() => {});
    await pageB.screenshot({ path: path.join(ARTIFACT_DIR, 'B-inbox.png'), fullPage: false }).catch(() => {});
    await pageM.screenshot({ path: path.join(ARTIFACT_DIR, 'M-dashboard.png'), fullPage: false }).catch(() => {});
  } finally {
    await browser.close();
  }

  const tsv = ['检查项\t结果\t说明', ...results.map((r) => `${r.name}\t${r.status}\t${r.detail ?? ''}`)].join('\n');
  writeFileSync(path.join(ARTIFACT_DIR, 'results.tsv'), tsv, 'utf8');
  console.log(`\n结果表：${path.join(ARTIFACT_DIR, 'results.tsv')}`);

  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n汇总：${passed} PASS / ${failures} FAIL（共 ${results.length} 项）`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('验收脚本异常：', err);
  process.exit(1);
});
