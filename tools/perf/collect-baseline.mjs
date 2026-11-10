/**
 * v0.0.16 性能基线采集（真实 HTTP + 真实 SQL 计数）
 *
 * ## 为什么要自己采集，而不是凭 pnpm build 的页面大小说话
 *
 * 任务书要求的是「页面加载耗时 / TTFB / LCP / CLS / JS 体积 / SQL 查询数 /
 * 慢 SQL / 连接池」，这些**没有一项**能从构建产物里读出来。
 * 而「感觉快了」不是证据。
 *
 * ## 两路数据来源
 *
 * 1. **浏览器侧**（Playwright + PerformanceObserver）
 *    - `TTFB`：`responseStart - requestStart`
 *    - `LCP` / `CLS`：真实 `PerformanceObserver` 回调（不是估算）
 *    - `transferSize`：本次页面所有 `/_next/static` 响应字节之和
 * 2. **数据库侧**（`pg_stat_statements` 不可用时的替代方案）
 *    - 采集前后读 `pg_stat_database` 的 `xact_commit` / `blks_read`，做差
 *    - 逐页单独采样：`SELECT pg_stat_clear_snapshot()` 后逐页测量
 *
 * ⚠️ `pg_stat_statements` 需要 `shared_preload_libraries`，便携版 PostgreSQL
 * 默认没开 ⇒ **本脚本不依赖它**，只用 `pg_stat_database` 的累计计数做差。
 * 口径是「该页触发的数据库事务数增量」，不是「SQL 语句条数」——
 * 两者不同，报告里必须写清楚量的是什么，不能用事务数冒充查询数。
 *
 * ## 可重复性
 *
 * - 每个页面跑 `ROUNDS` 次（默认 3），取**中位数**（不是均值 —— 单次抖动会污染均值）
 * - 冷启动与热缓存分开：第 1 次记 `cold`，第 2~N 次记 `warm`
 * - 采集前禁用浏览器缓存以外的任何预热，避免「测的是缓存命中」
 *
 * 用法：
 *   BASE=http://127.0.0.1:3210 \
 *   DATABASE_URL=postgres://... \
 *   node tools/perf/collect-baseline.mjs --rounds 3 --json docs/evidence/perf/v016-baseline.json
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const get = (n, d) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = (get('base', process.env.BASE ?? 'http://127.0.0.1:3210')).replace(/\/$/, '');
const ROUNDS = Number(get('rounds', '3'));
const JSON_OUT = get('json', null);
const CHANNEL = get('channel', process.env.BROWSER_CHANNEL || 'msedge');
const PSQL = process.env.PSQL_BIN ?? '';

const PAGES = [
  { name: 'home', path: '/', label: '首页' },
  { name: 'node', path: '/go/claude', label: '节点页' },
  { name: 'topic', path: '/t/1', label: '主题详情' },
  { name: 'search', path: '/go/search?q=claude', label: '搜索' },
  { name: 'member', path: '/member/admin', label: '用户主页' },
  { name: 'nodes_all', path: '/nodes', label: '全部节点' },
  { name: 'hot', path: '/hot', label: '最热' },
];

/** 读 pg_stat_database 的两个累计计数器（用于做差） */
function dbCounters() {
  if (!PSQL || !process.env.DATABASE_URL) return null;
  try {
    const out = execFileSync(
      PSQL,
      ['-d', process.env.DATABASE_URL, '-t', '-A', '-F', '|', '-c',
        "select xact_commit, tup_returned, tup_fetched, blks_read from pg_stat_database where datname = current_database();"],
      { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? '' }, shell: false },
    ).trim();
    const [xact, tupRet, tupFetch, blks] = out.split('|').map(Number);
    return { xact, tupRet, tupFetch, blks };
  } catch {
    return null;
  }
}

async function measureOnce(page, url) {
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: 'load' });
  // ⚠️ 必须在「导航完成」这一瞬间结算 wallMs。
  //    第一版把 t0 一直量到 vitals 观察窗口结束（+1200ms），
  //    于是每个页面都稳定报 ~1300ms —— 那是**测量窗口**，不是页面耗时。
  const wallMs = Date.now() - t0;
  const status = resp?.status() ?? null;

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    // ⚠️ 不要在这里读 paint timing —— 实测 msedge 在 `load` 当刻返回空数组，
    //    约 500ms 后才可见。FCP 在下面的 vitals 窗口里读。
    const paints = [];
    const resources = performance.getEntriesByType('resource');
    // ⚠️ 缓存命中时 `transferSize === 0`（尤其第二轮之后）。
    //    只用 transferSize 会得到 0 字节 —— 看起来像「本站没有 JS」的假结论。
    //    回退顺序：transferSize → encodedBodySize → decodedBodySize。
    const sizeOf = (r) => r.transferSize || r.encodedBodySize || r.decodedBodySize || 0;
    const staticBytes = resources
      .filter((r) => r.name.includes('/_next/static/'))
      .reduce((a, r) => a + sizeOf(r), 0);
    const jsBytes = resources
      .filter((r) => r.name.endsWith('.js'))
      .reduce((a, r) => a + sizeOf(r), 0);
    const cssBytes = resources
      .filter((r) => r.name.endsWith('.css'))
      .reduce((a, r) => a + sizeOf(r), 0);
    const imgCount = resources.filter((r) => r.initiatorType === 'img').length;
    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
      loadComplete: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
      fcp: null,
      staticBytes, jsBytes, cssBytes, imgCount,
      requestCount: resources.length,
    };
  });

  // LCP / CLS 必须在导航后持续观察 —— 这里用一个短窗口（2s）抓首屏值
  const vitals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let lcp = null;
        let cls = 0;
        let fcp = null;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) lcp = Math.round(e.startTime);
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          /* 浏览器不支持则留空，不伪造 */
        }
        setTimeout(() => {
          // FCP 必须在窗口结束后读（见上）
          const paints = performance.getEntriesByType('paint');
          const hit = paints.find((x) => x.name === 'first-contentful-paint');
          fcp = hit ? Math.round(hit.startTime) : null;
          resolve({
            lcp,
            cls: Math.round(cls * 1000) / 1000,
            fcp,
            paintEntries: paints.map((x) => `${x.name}=${Math.round(x.startTime)}`),
          });
        }, 1200);
      }),
  );

  return { status, wallMs, ...perf, ...vitals };
}

const median = (arr) => {
  const a = arr.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  return a[Math.floor(a.length / 2)];
};

const browser = await chromium.launch({ channel: CHANNEL });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

const results = [];
for (const p of PAGES) {
  const url = BASE + p.path;
  const runs = [];
  let dbDelta = null;
  for (let i = 0; i < ROUNDS; i += 1) {
    const before = dbCounters();
    const m = await measureOnce(page, url);
    const after = dbCounters();
    if (before && after) {
      dbDelta = {
        xact: after.xact - before.xact,
        tupFetch: after.tupFetch - before.tupFetch,
        tupRet: after.tupRet - before.tupRet,
        blksRead: after.blks - before.blks,
      };
    }
    runs.push({ round: i + 1, ...m });
  }
  const warm = runs.slice(1);
  results.push({
    page: p.name,
    label: p.label,
    url: p.path,
    status: runs[0]?.status ?? null,
    cold: runs[0] ?? null,
    warmMedian: {
      wallMs: median(warm.map((r) => r.wallMs)),
      ttfb: median(warm.map((r) => r.ttfb)),
      fcp: median(warm.map((r) => r.fcp)),
      lcp: median(warm.map((r) => r.lcp)),
      cls: median(warm.map((r) => r.cls)),
      domContentLoaded: median(warm.map((r) => r.domContentLoaded)),
      loadComplete: median(warm.map((r) => r.loadComplete)),
      jsBytes: median(warm.map((r) => r.jsBytes)),
      cssBytes: median(warm.map((r) => r.cssBytes)),
      staticBytes: median(warm.map((r) => r.staticBytes)),
      requestCount: median(warm.map((r) => r.requestCount)),
      imgCount: median(warm.map((r) => r.imgCount)),
    },
    dbDelta,
    runs,
  });
}

await browser.close();

const table = results.map((r) => ({
  页面: r.label,
  cold_ms: r.cold?.wallMs ?? null,
  warm_ms: r.warmMedian.wallMs,
  TTFB: r.warmMedian.ttfb,
  FCP: r.warmMedian.fcp,
  LCP: r.warmMedian.lcp,
  CLS: r.warmMedian.cls,
  'JS_kB': r.warmMedian.jsBytes ? Math.round(r.warmMedian.jsBytes / 1024) : null,
  'CSS_kB': r.warmMedian.cssBytes ? Math.round(r.warmMedian.cssBytes / 1024) : null,
  请求数: r.warmMedian.requestCount,
  图片数: r.warmMedian.imgCount,
  DB事务: r.dbDelta?.xact ?? null,
}));
console.table(table);

if (JSON_OUT) {
  await mkdir(path.dirname(JSON_OUT), { recursive: true });
  await writeFile(
    JSON_OUT,
    JSON.stringify({ measuredAt: new Date().toISOString(), base: BASE, rounds: ROUNDS, results }, null, 2),
    'utf8',
  );
  console.error(`已写入 ${JSON_OUT}`);
}
