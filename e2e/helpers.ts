import { Page, expect } from '@playwright/test';

/**
 * 测试账号
 *
 * 口令从环境变量读取，与 seed 脚本保持一致 ——
 * seed 的口令由 SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD 决定，
 * 硬编码会让「seed 用强口令、测试用弱口令」的两边对不上（登录必然失败）。
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'password123';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

export const ADMIN = { username: 'admin', password: ADMIN_PASSWORD };
export const USER_A = { username: 'lisi', password: DEMO_PASSWORD };
export const USER_B = { username: 'wangwu', password: DEMO_PASSWORD };
export const MODERATOR = { username: 'moderator', password: DEMO_PASSWORD };

/**
 * 清理限流计数。
 *
 * 限流是按 IP + 账号 / 用户 ID 计数的，测试连续运行会累积配额；
 * 每个需要写操作的测试组开始前调用，保证测试之间互不干扰。
 *
 * 调试端点需要令牌鉴权（见 src/lib/debug-auth.ts）。
 * 未配置 DEBUG_ENDPOINT_TOKEN 时静默跳过 —— 用例本身不依赖清理动作。
 */
export async function clearRateLimits(page: Page) {
  const token = process.env.DEBUG_ENDPOINT_TOKEN;
  if (!token) return;
  await page.request.post('/api/debug/reset-rate-limits', {
    headers: { 'x-debug-token': token },
  });
}

/** 从浏览器上下文读取 CSRF Cookie 的值 */
export async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === 'v2_csrf');
  return c?.value ?? '';
}

/**
 * 发起带 CSRF token 的 API 请求。
 *
 * 未携带 token 时服务端返回 403 —— 这正是 CSRF 防护的预期行为。
 * 用例若要验证"有 token 时放行"，必须走本 helper。
 */
export async function apiPost(
  page: Page,
  path: string,
  data: unknown,
  opts: { withCsrf?: boolean } = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.withCsrf !== false) {
    let token = await getCsrfToken(page);
    if (!token) {
      // CSRF Cookie 由 middleware 在页面响应时下发；
      // 若尚未访问过页面，先访问一次以取得 Cookie。
      // goto 可能因并发导航被中断，忽略该错误后重试读取 Cookie。
      await page.goto('/').catch(() => undefined);
      token = await getCsrfToken(page);
    }
    if (token) headers['x-csrf-token'] = token;
  }
  return page.request.post(path, { headers, data });
}

/**
 * 通过 UI 登录（走真实表单与 API，不走 cookie 注入）。
 *
 * 验证码说明：
 *  - 隔离测试环境（APP_RUNTIME_ENV=test 且 TEST_ENV_ISOLATED=1）下，
 *    登录页**不渲染**验证码输入框，因此可自动化。
 *  - 其他环境（生产/预发）登录页渲染并强制校验验证码，
 *    自动化无法解出图片内容 —— 该场景由生产模式专项测试覆盖。
 */
export async function login(page: Page, username: string, password: string) {
  await page.goto('/signin');
  // 同 register：SignInForm 是客户端组件，需等 hydration
  await page.waitForLoadState('networkidle');
  await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 });

  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * 注册一个新用户（唯一用户名）
 *
 * ⚠️ v0.0.4 修正：注册表单有**必填的 email 字段**（id="email"），
 * 原实现只填了用户名/密码/确认密码 —— email 留空导致注册失败，
 * 页面不跳转，后续断言全部超时。
 */
export async function register(page: Page, username: string, password = 'password123') {
  await page.goto('/signup');
  // ⚠️ SignUpForm 是客户端组件 —— 服务端渲染的 HTML 里**没有**这些输入框，
  // 必须等 React hydration 完成才能 fill，否则 page.fill 一直等到超时。
  await page.waitForLoadState('networkidle');
  await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 });

  await page.fill('#username', username);
  await page.fill('#email', `${username}@e2e.local`);
  await page.fill('#password', password);
  await page.fill('#confirm', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

export async function logout(page: Page) {
  await page.goto('/settings');
  const btn = page.getByRole('button', { name: '退出登录' });
  if (await btn.count()) {
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 }),
      btn.click(),
    ]);
  }
}

/**
 * 唯一用户名，避免并发测试冲突。
 *
 * ⚠️ v0.0.4 修正：原实现只有 `Date.now()`（毫秒）+ 1000 以内的随机数 ——
 * 跨测试轮次碰撞的概率不低。实测出现过注册**静默失败**的情况：
 * 用户名已存在 → /api/auth/signup 返回 409 → 页面不跳转，
 * 而 register() 的 waitForURL 因**当前已是登录态**而立即满足，
 * 于���测试悄悄复用了**上一个用户的会话** ——
 * 表现为「签到按钮显示今日已签到且 disabled」这类莫名其妙的失败。
 *
 * 现在用「时间戳 + 进程内自增计数器 + 6 位随机」，
 * 同一次运行内绝不重复，跨运行碰撞概率也极低。
 */
let nameCounter = 0;
export function uniqueName(prefix = 'e2e') {
  nameCounter += 1;
  const ts = Date.now().toString(36);
  const seq = nameCounter.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}${seq}${rand}`;
}

/**
 * 通过 UI 创建主题，返回主题 id。
 *
 * 真实页面结构（v0.0.4 实测确认）：
 *   - 发帖表单在 /go/new 页面，不在节点页（节点页只有搜索框）
 *   - NewTopicForm 是**客户端组件**（useState 受控），
 *     服务端渲染的 HTML 里没有 title/content 输入框，
 *     必须等浏览器渲染后才能填 —— 这也是必须用真实浏览器的原因
 *   - 节点通过 <select name="nodeId"> 选择，值为节点 id（数字）
 */
export async function createTopicViaUi(
  page: Page,
  nodeId: number,
  title: string,
  content: string,
): Promise<number> {
  await page.goto('/go/new');

  // ⚠️ 关键：NewTopicForm 是**客户端组件**，必须等 React hydration 完成，
  // 否则 onSubmit 还没绑定 —— 点击提交不会发起请求，URL 永远不变，
  // waitForURL 必然超时。
  //
  // 实测（v0.0.4）：单独跑一个用例时因为前面有多次 API 往返，
  // hydration 恰好已完成，测试能过；但整套连跑时序不同就会失败 ——
  // 这正是「靠运气通过」的典型，必须显式等待。
  await page.waitForLoadState('networkidle');

  const titleInput = page.locator('input[name="title"]');
  await expect(titleInput).toBeVisible({ timeout: 20_000 });

  // 确认 React 已接管：受控输入框在用户输入后，
  // 若 state 未同步，组件重渲染会把值还原。
  await page.selectOption('select[name="nodeId"]', String(nodeId));
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title, { timeout: 10_000 });

  await page.locator('textarea[name="content"]').fill(content);

  // 顺序执行而非 Promise.all：click() 本身会等待导航，
  // 与 waitForURL 并发时会互相竞争（Playwright 的经典陷阱）。
  await page
    .locator('form')
    .filter({ has: titleInput })
    .first()
    .locator('button[type="submit"]')
    .click();
  await page.waitForURL(/\/t\/\d+/, { timeout: 30_000 });

  const m = page.url().match(/\/t\/(\d+)/);
  if (!m) throw new Error(`无法从 URL 解析主题 id: ${page.url()}`);
  return Number(m[1]);
}

/**
 * 等待目标元素完成 React hydration（客户端组件真正接管事件）。
 *
 * ## 为什么需要这一步
 *
 * `NodeRequestForm` / `FollowButton` / `NewTopicForm` 都是**客户端组件**：
 * 服务端渲染出的 HTML 里输入框与按钮**都在**，但 `onChange` / `onClick`
 * **尚未绑定**。此时 `fill()` / `click()` 不会发出任何请求 ——
 * 表现是「点了没反应」，用例要么超时、要么误判为功能缺失。
 *
 * React 完成 hydration 后会在 DOM 节点上挂 `__reactFiber$*` / `__reactProps$*`
 * 私有属性（**非 enumerable**，必须用 `getOwnPropertyNames` 才能读到），
 * 用它们作为「已接管」的确定性信号。
 *
 * 相比 `waitForTimeout` 之类的盲等，这个信号：
 *  - 不受机器快慢影响（快机器不会白等，慢机器不会超时）
 *  - 失败时是**明确超时**而不是「偶发点击落空」
 *
 * @param page Playwright 页面对象
 * @param selector 目标元素的 CSS 选择器（必须是客户端组件内部的节点）
 */
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Object.getOwnPropertyNames(el).some((k) => k.startsWith('__react'));
    },
    selector,
    { timeout: 20_000 },
  );
}

/** 找一个可用的节点 id（优先 programmer，失败则取第一个） */
export async function pickNodeId(page: Page): Promise<number> {
  const res = await page.request.get('/api/nodes');
  const data = await res.json();
  const nodes = data?.nodes ?? data?.items ?? [];
  if (!nodes.length) throw new Error('没有任何可用节点');
  const preferred = nodes.find((n: { name: string }) => n.name === 'programmer');
  return Number((preferred ?? nodes[0]).id);
}

/**
 * 在主题详情页提交一条回复。
 *
 * 真实行为（v0.0.4 实测确认）：
 *   主题页的回复表单是**原生 form**（action="/api/replies" method="post"），
 *   CSRF token 通过隐藏字段 csrfToken 传递（原生表单无法加请求头）。
 *   提交成功后服务端返回 **303 重定向回 /t/{id}** —— URL **没有变化**，
 *   因此 `waitForURL` 不会触发（会一直等到超时）。
 *
 * 正确的等待方式：**等回复内容出现在页面上**。
 */
export async function submitReplyViaUi(
  page: Page,
  topicId: number,
  content: string,
): Promise<void> {
  await page.goto(`/t/${topicId}`);
  await page.waitForLoadState('networkidle');

  const textarea = page.locator('textarea[name="content"]').first();
  await expect(textarea).toBeVisible({ timeout: 20_000 });

  // 确认 React 已接管（受控输入框的值不会被重渲染还原）
  await textarea.fill(content);
  await textarea.blur();
  await expect(textarea).toHaveValue(content, { timeout: 10_000 });

  // 提交（原生 form → 303 重定向回同一页，URL 不变）
  await page
    .locator('form')
    .filter({ has: textarea })
    .first()
    .locator('button[type="submit"]')
    .click();

  // 等回复内容真正出现在页面上
  await expect(page.locator('#Main')).toContainText(content.slice(0, 20), {
    timeout: 30_000,
  });
}
