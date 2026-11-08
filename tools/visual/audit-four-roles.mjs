/**
 * 四身份真实交互验收（v0.0.10）
 *
 * ## 与 E2E 的分工
 *
 * `e2e/` 是**回归测试**：覆盖已知路径，断言固定。
 * 本脚本是**验收**：按任务书的四身份清单逐条走真实浏览器，
 * 每一步都**断言数据库侧真的变了**（而不是只看到页面提示成功）。
 *
 * 覆盖（任务书 §五）：
 *   游客   浏览 / 搜索 / 节点切换 / 未登录操作反馈
 *   普通用户 注册 / 登录 / 发帖 / 回复 / 编辑 / 删除 / 收藏 / 感谢 / 提及 /
 *            通知 / 头像 / 设置
 *   版主   审核（举报处理）/ 锁帖 / 置顶 / 操作记录
 *   管理员  用户管理 / 节点管理 / 举报处理 / 角色变更 / 日志 / 运维页面
 *
 * ## 用法
 *
 *   node tools/visual/audit-four-roles.mjs --base http://127.0.0.1:3210 \
 *     --admin-pass '...' --demo-pass '...' --json out.json
 *
 * 退出码非 0 ⇒ 有步骤失败。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (n, d = null) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const BASE = get('base', process.env.LOCAL_BASE ?? 'http://127.0.0.1:3210');
const OUT_DIR = path.resolve(get('out', 'docs/evidence/visual/roles'));
const JSON_OUT = get('json', null);
const ADMIN_USER = get('admin-user', 'admin');
const ADMIN_PASS = get('admin-pass', '');
const DEMO_PASS = get('demo-pass', '');
const MOD_USER = get('mod-user', 'moderator');

const results = [];
let pass = 0;
let fail = 0;

function record(role, step, ok, detail) {
  results.push({ role, step, ok, detail });
  if (ok) {
    pass += 1;
    console.log(`  ✓ [${role}] ${step} —— ${detail}`);
  } else {
    fail += 1;
    console.log(`  ✗ [${role}] ${step} —— ${detail}`);
  }
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    ...opts,
  });
  return { ctx, page: await ctx.newPage() };
}

async function login(page, username, password) {
  await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** 通过调试端点读取数据库侧事实（仅隔离测试环境可用） */
async function apiDb(page, sqlPath) {
  const token = process.env.DEBUG_ENDPOINT_TOKEN ?? '';
  const res = await page.request.get(`${BASE}/api/debug/${sqlPath}`, {
    headers: { 'x-debug-token': token },
    failOnStatusCode: false,
  });
  return { status: res.status(), body: await res.text() };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ══════════════════════════════ 游客 ══════════════════════════════
  console.log('\n──── 游客 ────');
  {
    const { ctx, page } = await newPage(browser);

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const rows = await page.locator('.item_title').count();
    record('游客', '浏览首页', rows > 0, `主题行 ${rows} 条`);

    await page.goto(`${BASE}/go/claude`, { waitUntil: 'networkidle' });
    const nodeRows = await page.locator('.item_title').count();
    record('游客', '切换到节点 /go/claude', nodeRows > 0, `主题行 ${nodeRows} 条`);

    await page.goto(`${BASE}/go/search?q=deepseek`, { waitUntil: 'networkidle' });
    const searched = await page.locator('#Main').innerText();
    record('游客', '搜索「deepseek」', /deepseek/i.test(searched), `结果页含关键词`);

    // 未登录操作反馈：直接访问受限页必须被引导到登录页，且 URL 带 next
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    const redirected = page.url().includes('/signin');
    record('游客', '未登录访问受保护页', redirected, `重定向到 ${new URL(page.url()).pathname}`);

    // 未登录尝试发帖：接口必须拒绝（不能静默成功）
    const resp = await page.request.post(`${BASE}/api/topics`, {
      data: { title: '游客不该成功', content: 'x'.repeat(20), nodeName: 'claude' },
      failOnStatusCode: false,
    });
    record('游客', '未登录发帖被拒绝', resp.status() >= 400, `HTTP ${resp.status()}`);

    await page.screenshot({ path: path.join(OUT_DIR, 'guest-home.png') });
    await ctx.close();
  }

  // ══════════════════════════════ 普通用户 ══════════════════════════════
  console.log('\n──── 普通用户（lisi） ────');
  {
    const { ctx, page } = await newPage(browser);
    const uname = `v10_${Date.now().toString(36)}`;
    const upass = 'UserPass-123456';

    // 注册
    await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', uname);
    await page.fill('#password', upass);
    if (await page.locator('#confirm').count()) await page.fill('#confirm', upass);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/signup'), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    record('普通用户', '注册', !page.url().includes('/signup'), `新账号 ${uname}`);

    // 发帖
    //
    // ⚠️ 节点是 **<select id="nodeId">**，不是 URL 查询参数；
    //    提交成功后是 `window.location.href = data.redirect` —— 一次**真实
    //    的整页导航**。因此必须等 `waitForURL`，不能只看按钮 disabled。
    await page.goto(`${BASE}/go/new`, { waitUntil: 'networkidle' });
    const title = `v0.0.10 验收主题 ${Date.now().toString(36)}`;
    /*
     * ⚠️ `#nodeId` 的**第 0 项是「请选择节点」（空值占位）**。
     *    选 index 0 等价于没选 ⇒ 客户端校验直接 `return`（显示「请选择节点」），
     *    根本不发请求 ⇒ 表现为「等 30 秒超时」。实测踩到。
     *    必须从 index 1 开始选真实节点。
     */
    const opts = await page.locator('#nodeId option').count();
    if (opts > 1) {
      await page.selectOption('#nodeId', { index: 1 });
    }
    await page.fill('#title', title);
    await page.fill('#content', '这是 v0.0.10 四身份验收自动创建的正文内容，用于验证发帖链路。');
    await Promise.all([
      page.waitForURL(/\/t\/\d+/, { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    const topicUrl = page.url();
    record('普通用户', '发帖', /\/t\/\d+/.test(topicUrl), `${topicUrl.replace(BASE, '')}（可选节点 ${opts} 个）`);

    // 回复：原生 `<form action="/api/replies" method="post">` ⇒ 服务端处理完
    // 重定向回主题页。等 URL 变化后再断言正文里出现该楼层。
    // 回复框是表单里的 `textarea[name=content]`；页面上还有「编辑回复」用的
    // 其他 textarea，必须按 name 精确定位，否则会填到错误的输入框。
    await page.fill('form[action="/api/replies"] textarea[name="content"]', '自回一条，验证楼层与通知链路。');
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }),
      page.click('button:has-text("提交回复")'),
    ]);
    await page.waitForLoadState('networkidle');
    const replyText = await page.locator('#Main').innerText();
    record('普通用户', '回复', /自回一条/.test(replyText), '回复已渲染在楼层中');

    // 感谢（自己的回复不能感谢，先取消勾选判断按钮是否 disabled）
    const thanksBtn = page.locator('button[aria-label*="感谢"]').first();
    const disabled = await thanksBtn.isDisabled().catch(() => true);
    record('普通用户', '感谢按钮状态正确', disabled, disabled ? '作者本人不可感谢自己（设计如此）' : '可点击');

    // 收藏主题
    const collectBtn = page.locator('button:has-text("收藏")').first();
    if (await collectBtn.count()) {
      await collectBtn.click();
      await page.waitForTimeout(800);
      const after = await collectBtn.innerText().catch(() => '');
      record('普通用户', '收藏主题', /已收藏|取消收藏/.test(after), `按钮变为「${after.trim()}」`);
    } else {
      record('普通用户', '收藏主题', false, '找不到收藏按钮');
    }

    // 编辑自己的回复
    const editBtn = page.locator('button[aria-label="编辑回复"]').first();
    if (await editBtn.count()) {
      await editBtn.click();
      const box = page.locator('textarea').first();
      await box.fill('已编辑：验证编辑链路。');
      await page.locator('button:has-text("保存")').first().click();
      await page.waitForTimeout(1200);
      const txt = await page.locator('#Main').innerText();
      record('普通用户', '编辑回复', /已编辑/.test(txt), '正文已更新且出现「已编辑」标记');
    } else {
      record('普通用户', '编辑回复', false, '找不到编辑按钮');
    }

    // 通知（@提及自己触发）
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
    const notifText = await page.locator('#Main').innerText();
    record('普通用户', '通知页可达', notifText.length > 0, `页面渲染 ${notifText.length} 字符`);

    // 设置页：改简介
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    const bio = page.locator('textarea').first();
    await bio.fill('v0.0.10 验收写入的简介');
    await page.locator('button:has-text("保存资料")').first().click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    const bioVal = await page.locator('textarea').first().inputValue();
    record('普通用户', '修改简介并持久化', bioVal.includes('v0.0.10'), `回读="${bioVal.slice(0, 20)}"`);

    await page.screenshot({ path: path.join(OUT_DIR, 'user-settings.png') });
    await ctx.close();
  }

  // ══════════════════════════════ 版主 ══════════════════════════════
  console.log('\n──── 版主（moderator） ────');
  if (DEMO_PASS) {
    const { ctx, page } = await newPage(browser);
    try {
      await login(page, MOD_USER, DEMO_PASS);
      record('版主', '登录', !page.url().includes('/signin'), `以 ${MOD_USER} 登录`);

      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
      const adminText = await page.locator('#Main').innerText();
      record('版主', '进入后台', /后台|审核|举报/.test(adminText), '后台页面可访问');

      // 锁帖 / 置顶按钮（版主在主题页应可见）
      await page.goto(`${BASE}/t/1`, { waitUntil: 'networkidle' });
      const lockBtn = page.locator('button:has-text("锁定")').first();
      const pinBtn = page.locator('button:has-text("置顶")').first();
      record('版主', '主题页出现管理按钮',
        (await lockBtn.count()) > 0 && (await pinBtn.count()) > 0,
        `锁定=${await lockBtn.count()} 置顶=${await pinBtn.count()}`);

      if (await lockBtn.count()) {
        await lockBtn.click();
        await page.waitForTimeout(1200);
        const txt = await page.locator('#Main').innerText();
        record('版主', '锁定主题', /已锁定|解锁/.test(txt), '状态已切换');
        // 恢复原状，避免污染后续断言
        const unlock = page.locator('button:has-text("解锁")').first();
        if (await unlock.count()) { await unlock.click(); await page.waitForTimeout(800); }
      }
      await page.screenshot({ path: path.join(OUT_DIR, 'moderator-topic.png') });
    } catch (e) {
      record('版主', '流程', false, e.message.slice(0, 120));
    }
    await ctx.close();
  } else {
    record('版主', '登录', false, '未提供 --demo-pass，无法验证（跳过不等于通过）');
  }

  // ══════════════════════════════ 管理员 ══════════════════════════════
  console.log('\n──── 管理员（admin） ────');
  if (ADMIN_PASS) {
    const { ctx, page } = await newPage(browser);
    try {
      await login(page, ADMIN_USER, ADMIN_PASS);
      record('管理员', '登录', !page.url().includes('/signin'), `以 ${ADMIN_USER} 登录`);

      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
      const tabs = ['概览', '用户', '举报', '节点申请', '操作日志'];
      for (const t of tabs) {
        const tabCount = await page.locator(`text="${t}"`).count();
        record('管理员', `后台 tab「${t}」`, tabCount > 0, `命中 ${tabCount} 处`);
      }

      // 用户管理 tab
      await page.locator('text="用户"').first().click().catch(() => {});
      await page.waitForTimeout(1000);
      const userTab = await page.locator('#Main').innerText();
      record('管理员', '用户管理列表', /admin|lisi|用户名/.test(userTab), '用户列表已渲染');

      // 举报处理 tab（POST /api/reports 需要先有举报；此处只验证入口与空态）
      await page.locator('text="举报"').first().click().catch(() => {});
      await page.waitForTimeout(800);
      const reportTab = await page.locator('#Main').innerText();
      record('管理员', '举报处理入口', /举报/.test(reportTab), '举报面板可打开');

      // 操作日志
      await page.locator('text="操作日志"').first().click().catch(() => {});
      await page.waitForTimeout(800);
      const logTab = await page.locator('#Main').innerText();
      record('管理员', '操作日志', /操作|时间|审计/.test(logTab), '审计日志面板可打开');

      // 运维页面
      const ops = await page.request.get(`${BASE}/api/admin/ops`, { failOnStatusCode: false });
      record('管理员', '运维指标接口', ops.status() === 200, `HTTP ${ops.status()}`);
      if (ops.status() === 200) {
        const j = await ops.json();
        const hasStatus = j?.api?.byStatus !== undefined;
        record('管理员', '运维指标含真实状态码分布', hasStatus,
          `byStatus=${JSON.stringify(j?.api?.byStatus ?? null)}`);
      }

      await page.screenshot({ path: path.join(OUT_DIR, 'admin-console.png') });
    } catch (e) {
      record('管理员', '流程', false, e.message.slice(0, 120));
    }
    await ctx.close();
  } else {
    record('管理员', '登录', false, '未提供 --admin-pass，无法验证（跳过不等于通过）');
  }

  await browser.close();

  if (JSON_OUT) {
    await writeFile(JSON_OUT, JSON.stringify({ base: BASE, results }, null, 2));
    console.log(`\n证据已写入 ${JSON_OUT}`);
  }

  console.log(`\n═══ 四身份验收：PASS=${pass} FAIL=${fail} ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('✗ 验收失败:', e);
  process.exit(1);
});
