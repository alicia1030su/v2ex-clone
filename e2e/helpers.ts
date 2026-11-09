import { Page, expect, type APIResponse, type Locator, type Request } from '@playwright/test';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/**
 * 测试账号
 *
 * 口令从环境变量读取，与 seed 脚本保持一致 ——
 * seed 的口令由 SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD 决定，
 * 硬编码会让「seed 用强口令、测试用弱口令」的两边对不上（登录必然失败）。
 */
/**
 * ⚠️ v0.0.5：这两个口令必须由**测试进程**自己拿到，
 *    不能指望服务端进程的环境变量 —— 它们是**两个进程**。
 *
 * 实测踩到：用 `lisi` 登录一直返回 401「用户名或密码不正确」，
 * 原因就是**启动测试的那条命令**没带 `SEED_DEMO_PASSWORD`，
 * 于是这里退回默认值 `password123`，
 * 而服务端 seed 用的是 `SEED_DEMO_PASSWORD=LocalDemoPass12345`
 * ⇒ 两边对不上 ⇒ 登录必然失败。
 *
 * 跑 E2E 时**必须**同时给服务端与测试进程传：
 *   SEED_DEMO_PASSWORD=…  SEED_ADMIN_PASSWORD=…
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'password123';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

export const ADMIN = { username: 'admin', password: ADMIN_PASSWORD };
export const USER_A = { username: 'lisi', password: DEMO_PASSWORD };
export const USER_B = { username: 'wangwu', password: DEMO_PASSWORD };
export const MODERATOR = { username: 'moderator', password: DEMO_PASSWORD };

/**
 * 调试端点令牌
 *
 * ⚠️ v0.0.5：**必须与「服务端进程」用的是同一份令牌**，否则清理会静默失效。
 *
 * 实测踩到（E2E 反复失败，报错完全指不到真正原因）：
 *   - 服务端 `next start` 读的是 `.env.test` ⇒ 令牌 = `test-debug-token-local-only`
 *   - 测试进程 `playwright.config.ts` 用 dotenv 加载 `.env.test`，
 *     但 dotenv **不覆盖已存在的环境变量** ⇒ 若 shell 里 export 了
 *     `DEBUG_ENDPOINT_TOKEN=local-debug-token`，测试进程拿到的就是**另一个值**
 *   - 两边不一致 ⇒ debug 端点返回 401 ⇒ **限流根本没被清**
 *   - 表现：注册 / 登录 / 发帖莫名其妙地 429 或超时
 *
 * 修法：把「进程 env 的令牌」与「`.env.test` 里的令牌」**都试一遍**，
 * 谁能用就用谁 —— 这样无论 shell 里有没有覆盖都能工作。
 */
/**
 * 导出版本（v0.0.10）
 *
 * 新增的 `/api/debug/boom` 用例需要**同一套令牌回退链**：
 * 进程 env 与 `.env.test` 都可能持有令牌，谁能用就用谁。
 * 之前这个函数是私有的，导致新的调试端点用例只能自己再抄一遍 ——
 * 抄错一次就是「401 而不是 500」的假失败。
 */
export function debugTokens(): string[] {
  const out: string[] = [];
  const fromEnv = process.env.DEBUG_ENDPOINT_TOKEN?.trim();
  if (fromEnv) out.push(fromEnv);

  // 从 `.env.test` 再取一次（服务端大概率读的是它）
  try {
    const file = nodePath.join(__dirname, '..', '.env.test');
    const m = /^DEBUG_ENDPOINT_TOKEN\s*=\s*(.+)$/m.exec(nodeFs.readFileSync(file, 'utf8'));
    const v = m?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (v && !out.includes(v)) out.push(v);
  } catch {
    // 文件不存在 ⇒ 忽略
  }

  return out;
}

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
  const tokens = debugTokens();
  if (tokens.length === 0) {
    throw new Error(
      'clearRateLimits: 拿不到 DEBUG_ENDPOINT_TOKEN —— 既不在进程 env 里，也不在 .env.test 里。\n' +
        '没有它就无法清理限流，后续请求会累积到阈值并返回 **429**，\n' +
        '而那个报错完全指不到「限流没被清」这个真正原因。',
    );
  }

  const attempts: string[] = [];
  for (const token of tokens) {
    const res = await page.request.post('/api/debug/reset-rate-limits', {
      headers: { 'x-debug-token': token },
    });
    // 200 ⇒ 成功，停止尝试
    if (res.status() === 200) return;
    attempts.push(`  token=${token.slice(0, 6)}… → HTTP ${res.status()}`);
  }

  // ⚠️ v0.0.5：**所有令牌都失败时抛错**，而不是静默返回。
  //
  // 实测踩到（远端 CI E2E 失败，本地花了一整轮才定位）：
  //   原实现在失败时**静默 return** ⇒ 限流没被清 ⇒
  //   后续 forgot-password 累积到阈值 ⇒ 返回 **429**。
  //
  //   而 429 的报错只说「forgot-password 返回 429」——
  //   **完全指不到**「clearRateLimits 静默失败了」这个真正原因。
  //
  // 现在：失败会**立刻**在这里抛出，并带上所有尝试过的令牌与状态码。
  throw new Error(
    `clearRateLimits 失败 —— 限流**没有被清空**。\n` +
      `\n` +
      `尝试过的令牌：\n${attempts.join('\n')}\n` +
      `\n` +
      `最常见的原因：**测试进程与服务端用了不同的 DEBUG_ENDPOINT_TOKEN**。\n` +
      `  · 服务端（next start）读的是 shell 注入的值\n` +
      `  · 测试 worker 读的是 global-setup 加载的值\n` +
      `  · 两者不一致 ⇒ debug 端点返回 401\n` +
      `\n` +
      `排查：确认启动服务与启动 playwright 的 shell 里\n` +
      `DEBUG_ENDPOINT_TOKEN 是同一个值。`,
  );
}

/** 从浏览器上下文读取 CSRF Cookie 的值 */
export async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const candidates = cookies.filter((x) => x.name === 'v2_csrf');
  if (candidates.length === 0) return '';

  // ⚠️ v0.0.7 修正（实测根因，Linux 矩阵 firefox 全视口稳定 403）：
  //
  // 现场取证（firefox-375x812 分片）：
  //   ctx_csrf = [
  //     { value: '7ebb3c91…', domain: 'localhost'  },
  //     { value: '71b86c2c…', domain: '127.0.0.1' },
  //   ]
  //   当前 URL: http://localhost:3105/t/22
  //
  // 浏览器里存在**两个** v2_csrf cookie（middleware 对每个 host 各发了一个，
  // 因为它是按请求 host 下发的）。原实现 `cookies.find(...)` 取**第一个**
  // ⇒ 拿到的是 `localhost` 域那个；而请求实际发往 `127.0.0.1`
  // ⇒ 服务端读到的 cookie 是 `127.0.0.1` 域那个
  // ⇒ 两个 token 不相等 ⇒ `verifyCsrf` 返回 false ⇒ **403**。
  //
  // Chromium/WebKit 不稳定复现是因为它们的 cookie 列表顺序不同。
  //
  // 修法：按**当前页面 URL 的 host** 精确匹配 domain；
  // 匹配不到时退回页面 `document.cookie`（浏览器实际持有的那个）。
  const host = new URL(page.url()).hostname;
  const exact = candidates.find((c) => {
    const d = (c.domain ?? '').replace(/^\./, '');
    return d === host || (host.endsWith(`.${d}`) && d.length > 0);
  });
  if (exact) return exact.value;

  // 兜底：读页面实际持有的 cookie（与 csrfFetch 的来源一致）
  const fromDoc = await page
    .evaluate(() => {
      const m = document.cookie.match(/(?:^|; )v2_csrf=([^;]*)/);
      return m ? decodeURIComponent(m[1]) : '';
    })
    .catch(() => '');
  return fromDoc || candidates[0].value;
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
  //
  // ⚠️ v0.0.5：不用 `networkidle` —— 页面有**持续的网络请求**
  //    （通知轮询等），网络永远不会真正空闲 ⇒ 等满 20s 超时
  //    （实测踩到：新开的 context 里登录页 #username 等不到）。
  //    `domcontentloaded` + 显式等元素可见更可靠。
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 });

  // ⚠️ v0.0.13（V10-21 家族）：必须等 React 水合完成再点。
  //    未水合时点击走**原生表单提交**（form 没有 action）⇒ 页面重载 ⇒ URL 仍是
  //    /signin ⇒ waitForURL 挂满 30s。实测 CI run 42499586462 的
  //    firefox/375x812 就是这样挂的：截图里表单已填好、按钮未进 pending 态、
  //    页面也没有任何错误提示 —— 特征与「提交根本没发生」一致。
  await waitForHydration(page, '#username');

  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 }),
    // 用 clickUntilRequest 确认**请求真的发出**（Firefox 偶发点击丢失，见 V10-21）
    clickUntilRequest(
      page,
      page.getByRole('button', { name: /登录|登 录/ }),
      (r) => r.url().includes('/api/auth/signin') && r.method() === 'POST',
      WRITE_CLICK_RETRY,
    ),
  ]);
}

/**
 * 注册一个新用户（唯一用户名）
 *
 * ⚠️ v0.0.4 修正：注册表单有**必填的 email 字段**（id="email"），
 * 原实现只填了用户名/密码/确认密码 —— email 留空导致注册失败，
 * 页面不跳转，后续断言全部超时。
 *
 * ⚠️ v0.0.8：**返回实际注册的邮箱** —— 调用方应直接用这个返回值，
 * 不要自己拼邮箱域名。v0.0.8 实测踩到：稳定性 spec 自己拼了
 * `@stability.local`，而这里写死 `@e2e.local` ⇒ 申请的邮箱**未注册**
 * ⇒ 找回密码**一封邮件都不发** ⇒ 表现为「等待邮件超时」，
 * 而接口返回 200（枚举防护）、日志无任何错误 —— 极难定位。
 */

/** 注册时使用的邮箱域名（对外暴露，供测试拼出**真实**注册邮箱） */
export const REGISTER_EMAIL_DOMAIN = 'e2e.local';

export async function register(
  page: Page,
  username: string,
  password = 'password123',
): Promise<{ username: string; email: string }> {
  await page.goto('/signup');
  // ⚠️ SignUpForm 是客户端组件 —— 服务端渲染的 HTML 里**没有**这些输入框，
  // 必须等 React hydration 完成才能 fill，否则 page.fill 一直等到超时。
  // ⚠️ v0.0.5：同 login helper —— 不用 networkidle（页面有持续请求）
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 });

  // 同 login：先等水合，再用 clickUntilRequest 确认注册请求真的发出
  await waitForHydration(page, '#username');

  await page.fill('#username', username);
  await page.fill('#email', `${username}@${REGISTER_EMAIL_DOMAIN}`);
  await page.fill('#password', password);
  await page.fill('#confirm', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 30_000 }),
    clickUntilRequest(
      page,
      page.getByRole('button', { name: /注册|注 册/ }),
      (r) => r.url().includes('/api/auth/signup') && r.method() === 'POST',
      WRITE_CLICK_RETRY,
    ),
  ]);
  // 显式返回实际注册的凭据（见上方说明：调用方不要自己拼邮箱）
  return { username, email: `${username}@${REGISTER_EMAIL_DOMAIN}` };
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
 * 于是测试悄悄复用了**上一个用户的会话** ——
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
  // ⚠️ v0.0.5：不用 networkidle（页面有持续请求，网络永不空闲）
  await page.waitForLoadState('domcontentloaded');

  // ⚠️ v0.0.4（V4-20）：用 `id` 定位，**不用** `name="title"` ——
  // 表单内 input 的 `name` 若与 `HTMLFormElement` 的 DOM 属性同名
  // （如 `title` / `nodeName` / `id` / `action`），会因 HTML 规范的
  // `[OverrideBuiltins]` 把该控件暴露成 form 的同名命名属性。
  // 其中 `name="nodeName"` 会**直接**让 react-dom 的
  // `instance.nodeName.toLowerCase()` 崩溃 → 水合失败（#418）→
  // 事件处理器不绑定。NewTopicForm 的标题框已把 `name` 改为 `topic_title`。
  const titleInput = page.locator('input#title');
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

/**
 * 韧性导航 —— v0.0.7：消除「应用自身导航」与「测试 goto」的竞态
 *
 * ## 实测根因（Linux 矩阵 webkit-375x812 失败）
 *
 * `软删除主题` 用例里，作者删除自己的主题后：
 *   1. 应用调 `router.refresh()` 重新拉取服务端组件；
 *   2. 该主题对非 staff 已 notFound ⇒ Next 客户端路由收到 notFound 载荷后
 *      **导航到当前 URL 以渲染 404 页**（同 URL 的真实导航事件）；
 *   3. 这个导航可能**晚于**测试的 API 轮询才到达 ⇒ 与测试随后的
 *      `page.goto('/')` 抢同一个导航槽位 ⇒ Playwright 报
 *      `Navigation to "…/" is interrupted by another navigation to "…/t/24"`。
 *
 * 这是**测试与应用的正常路由活动竞态**，不是产品缺陷
 * （用户侧看到的就是「留在原 URL、显示 404」，行为正确）。
 *
 * ## 修法
 *
 * 被「another navigation」打断时等待稳定后重试（最多 3 次）。
 * **不削弱任何断言** —— 只是不再让竞态决定成败。
 */
export async function gotoResilient(page: Page, url: string, attempts = 3): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url);
      return;
    } catch (err) {
      const msg = String(err);
      // ⚠️ v0.0.9：**不同浏览器的「导航被中断」错误文案不同**，必须都覆盖：
      //
      //   · Chromium： `net::ERR_ABORTED` / `interrupted by another navigation`
      //   · Firefox： `NS_BINDING_ABORTED`（导航被同源的另一个导航取代）
      //   · WebKit ： `interrupted by another navigation`
      //
      // 实测（v0.0.9 CI，run 42360422764）：firefox/1920x1080 分片
      // 因 `NS_BINDING_ABORTED` 失败 1 条 —— 而 chromium/webkit 的同一条
      // 用例通过 ⇒ 这**不是**产品缺陷，是**辅助函数只认 Chromium 文案**。
      //
      // 典型触发场景（见 v004-content-interaction.spec.ts）：
      // 删除主题后应用自己会 `router.refresh()`，此时测试又发起 `goto('/')`
      // ⇒ 两个导航竞争 ⇒ 后者被前者取代 ⇒ Firefox 抛 NS_BINDING_ABORTED。
      const interrupted =
        msg.includes('interrupted by another navigation') ||
        msg.includes('NS_BINDING_ABORTED') ||
        msg.includes('ERR_ABORTED') ||
        msg.includes('Navigation interrupted');

      if (interrupted && i < attempts) {
        // 等应用自身的导航落地再重试
        await page.waitForTimeout(400);
        continue;
      }
      throw err;
    }
  }
}

/**
 * v0.0.12：点击并**确认请求真的发出**（容忍 Firefox「点击丢失」，V10-21）
 *
 * ## 事故（CI 实测，run 42488795887，firefox/1920x1080）
 *
 * 「SMTP 停止后申请重置」用例 31.5s 失败：`waitForResponse` 30s 超时，
 * 但失败截图里按钮仍是「发送重置链接」（未进 pending 态）、页面零变化。
 * 拆开 trace 逐层取证后确认：
 *   · 点击动作本身**正常完成**（Playwright actionability 检查全过，
 *     「元素稳定」检查需要 rAF，证明主线程当时是活的）；
 *   · 点击后 30s 内：没有任何请求发出、没有任何 DOM 变化、
 *     没有任何控制台错误、也没有原生表单导航（frameUrl 全程不变）；
 *   · 输入框的值始终在（排除「清水合把受控输入清空」）。
 * ⇒ 点击事件在浏览器侧丢失，React 的提交处理从未运行。
 *
 * 同一症状族 v0.0.9 记录过一次（ef39aa5：按钮停在「发送重置链接」、
 * trace 里没有 POST），当时归因为「准备阶段耗尽 60s 预算」；
 * 本次**预算充足**（90s 预算仅用 31.5s，前期准备 <2s）仍复现 ⇒
 * 是独立的「点击丢失」变体。且同一轮 chromium / webkit / 其余 4 个
 * firefox 分片的同一条用例全绿 ⇒ **不是产品缺陷**，是浏览器级偶发。
 *
 * ## 修法（不动任何断言，与 gotoResilient 同范式）
 *
 * 每轮**先注册**请求探针再点击 —— 请求是在点击事件的同一个 task 里
 * 同步发出的，若先 click 再注册探针，请求可能已经在飞而探针看不见
 * （假阴性 ⇒ 无谓多点一次）。探针超时未见请求 ⇒ 用 **locator 重新
 * 解析**后再点（locator 每个 Action 都重新查询 DOM，能拿到 React
 * 重渲染后的新节点）。最多 `attempts` 轮；全部丢失则交还调用方既有
 * 的响应等待超时去失败（错误信息不变，仍直指缺失的请求）。
 *
 * 用法（保持「先建响应 Promise 再点击」的约定不变）：
 *   const respPromise = page.waitForResponse(respFilter, { timeout: 30_000 });
 *   await clickUntilRequest(page, page.getByRole('button', { name: '提交' }), reqFilter);
 *   const resp = await respPromise;
 */
/**
 * 「写操作但允许**受闸门约束**的重试」的显式开关。
 *
 * 用于登录 / 注册 / 找回密码这类 POST：它们不是幂等的，默认只点一次；
 * 但 CI 上 Firefox 确有「点击丢失」记录（V10-21），因此需要容忍一次。
 * 开启后 `clickUntilRequest` 仍会在每轮重试前验证
 * 「零写请求 + 零在途 + 按钮未进 pending」，确保不会重复提交。
 */
export const WRITE_CLICK_RETRY: ClickUntilRequestOptions = {
  allowWriteRetry: true,
  attempts: 3,
};

export type ClickUntilRequestOptions = {
  /** 最多点击轮数（仅对允许重试的操作生效） */
  attempts?: number;
  /** 每轮等待请求的探针时长 */
  probeMs?: number;
  /**
   * 该点击是否为**幂等**操作（GET / 导航 / 纯只读）。默认 `false`。
   *
   * 默认 false 是刻意的：写操作（发帖、回复、消费积分、注册、重置密码…）
   * 绝不能因为「探针没看见请求」就再点一次 —— 那会造成重复提交。
   */
  idempotent?: boolean;
  /**
   * 非幂等写操作**确需**容忍浏览器级点击丢失时必须显式开启。
   * 开启后仍受下面三道闸门约束，任一道不满足都不会再点第二次。
   */
  allowWriteRetry?: boolean;
  /**
   * 「有操作正在处理」的更宽判据。默认：任何非 GET 请求。
   * 用于捕捉窄探针漏检的请求，避免把「请求其实已发出」误判为点击丢失。
   */
  activityPredicate?: (r: Request) => boolean;
};

/** 按钮/页面是否已进入处理中（pending 态）——决定能否安全再点一次 */
async function operationInProgress(locator: Locator): Promise<boolean> {
  try {
    // disabled：最常见的 React pending 态（SignInForm / 重置表单都用它）
    if (await locator.isDisabled()) return true;
    const busy = await locator.getAttribute('aria-busy');
    if (busy === 'true') return true;
    const text = (await locator.textContent()) ?? '';
    return /中…|\.\.\.|处理中|提交中|登录中|注册中|发送中/.test(text);
  } catch {
    // locator 已脱离 DOM（例如页面已跳转）—— 说明操作已经发生
    return true;
  }
}

/**
 * v0.0.13（V13-05）新增的三道闸门，缺一不可：
 *
 *  ① **先注册监听**：`page.on('request')` 的宽监听必须在第一次点击之前注册，
 *     与窄探针一起覆盖「请求已发出但探针谓词太窄」的情形；
 *  ② **零请求**：宽监听看到任何写请求 ⇒ 绝不再点；
 *  ③ **零处理中**：仍有在途请求，或按钮进入 disabled/pending 态 ⇒ 绝不再点。
 *
 * 对非幂等写操作默认 `attempts = 1`（只点一次）；只有显式
 * `allowWriteRetry: true` 才允许最多 3 轮，且每轮重试前都要重新过三道闸门。
 * 全部轮次都丢失时，写操作会**显式抛错**而不是安静返回 ——
 * 静默吞掉一次丢失的写点击，比让调用方的响应等待超时更难排查。
 */
export async function clickUntilRequest(
  page: Page,
  locator: Locator,
  requestPredicate: (r: Request) => boolean,
  opts: ClickUntilRequestOptions = {},
): Promise<void> {
  const idempotent = opts.idempotent ?? false;
  const allowWriteRetry = opts.allowWriteRetry ?? false;
  const retryAllowed = idempotent || allowWriteRetry;
  const attempts = retryAllowed ? (opts.attempts ?? 3) : 1;
  const probeMs = opts.probeMs ?? 3_000;
  const activityPredicate =
    opts.activityPredicate ?? ((r: Request) => r.method() !== 'GET');

  // ① 宽监听**先于**任何点击注册；同时跟踪在途请求
  let observedActivity = 0;
  const inFlight = new Set<Request>();
  const onRequest = (r: Request) => {
    if (!activityPredicate(r)) return;
    observedActivity += 1;
    inFlight.add(r);
  };
  const onSettled = (r: Request) => inFlight.delete(r);
  const hasEvents = typeof (page as Page).on === 'function'
    && typeof (page as Page).off === 'function';
  if (hasEvents) {
    page.on('request', onRequest);
    page.on('requestfinished', onSettled);
    page.on('requestfailed', onSettled);
  }

  try {
    for (let i = 1; i <= attempts; i++) {
      // 每轮都**先注册探针**再点击（请求与点击同 task 发出）
      const probe = page.waitForRequest(requestPredicate, { timeout: probeMs }).then(
        () => true,
        () => false,
      );
      await locator.click();
      if (await probe) return;

      // ② / ③ 重试前的双闸门：只要可能已有操作在处理，就绝不再点
      if (observedActivity > 0 || inFlight.size > 0 || (await operationInProgress(locator))) {
        return; // 交还调用方既有的响应等待（请求其实在飞）
      }
      if (!retryAllowed) {
        throw new Error(
          'clickUntilRequest: 写操作点击后未观察到请求；为防止重复提交，已拒绝重试（allowWriteRetry=false）',
        );
      }
      // 三道闸门全过：确认「零请求 + 零处理中」后才允许下一轮
    }

    if (!idempotent) {
      throw new Error(
        `clickUntilRequest: 写操作连续 ${attempts} 轮点击均未观察到请求；已停止重试以避免重复提交`,
      );
    }
  } finally {
    if (hasEvents) {
      page.off('request', onRequest);
      page.off('requestfinished', onSettled);
      page.off('requestfailed', onSettled);
    }
  }
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
  // ⚠️ v0.0.5：不用 networkidle（页面有持续请求，网络永不空闲）
  await page.waitForLoadState('domcontentloaded');

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
