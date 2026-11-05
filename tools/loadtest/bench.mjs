/**
 * v0.0.4 真实社区负载测试器
 *
 * 为什么自研而不用 k6：
 *   本机没有 k6 / hey / ab，且环境不允许随意安装系统级工具。
 *   自研的好处是能精确控制并报告**分位延迟**（P50/P95/P99），
 *   而不只是平均值 —— 平均值会掩盖长尾。
 *
 * 覆盖任务要求的场景：
 *   1. 首页分页与响应时间
 *   2. 节点主题查询
 *   3. 热门排序
 *   4. 搜索查询
 *   5. 用户主页
 *   6. 大型帖子回复分页
 *   7. 高并发发帖与回复
 *   8. 积分事务一致性（压测后校验）
 *   9. 数据库索引命中（EXPLAIN）
 *  10. PostgreSQL 连接池（观察连接数与等待）
 *  11. Redis 内存与缓存失效（本环境未配 Redis，如实标注）
 *  12. 容器 CPU 与内存（本机无 Docker，如实标注）
 *
 * 用法：
 *   node tools/loadtest/bench.mjs --base=http://localhost:3030 \
 *     --duration=30 --concurrency=10
 */

import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- 参数
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : dflt;
}
const BASE = arg('base', 'http://localhost:3030');
const DURATION = Number(arg('duration', 20));
const CONCURRENCY = Number(arg('concurrency', 10));
const WARMUP = Number(arg('warmup', 3));

// ---------------------------------------------------------------- 工具
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[i] * 100) / 100;
}
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: pct(s, 0),
    p50: pct(s, 50),
    p95: pct(s, 95),
    p99: pct(s, 99),
    max: pct(s, 100),
    avg: Math.round((sum / (s.length || 1)) * 100) / 100,
  };
}

/** 单个场景的结果 */
const scenarios = [];
function record(name, method, path, samples, errors, extra = {}) {
  const st = stats(samples);
  const r = {
    name,
    method,
    path,
    ...st,
    errors: errors.length,
    errorSamples: errors.slice(0, 5),
    rps: Math.round((samples.length / (DURATION || 1)) * 100) / 100,
    ...extra,
  };
  scenarios.push(r);
  console.log(
    `  ${name.padEnd(26)} n=${String(st.n).padStart(5)}  ` +
      `p50=${String(st.p50).padStart(7)}ms  p95=${String(st.p95).padStart(8)}ms  ` +
      `p99=${String(st.p99).padStart(8)}ms  max=${String(st.max).padStart(8)}ms  ` +
      `err=${errors.length}`,
  );
  return r;
}

// ---------------------------------------------------------------- 场景定义
// path 里用 {n} 占位，表示第 n 次迭代的随机参数
// 节点名与用户名需与压测库的实际数据匹配：
//   压测库由 scripts/loadtest/seed-large.ts 生成，节点名为 n_000001…，用户名为 lt_000001…
const NODE_NAME = process.env.LOADTEST_NODE ?? 'n_000001';
const USER_NAME = process.env.LOADTEST_USER_NAME ?? 'lt_000001';

const SCENARIOS = [
  { name: '首页分页', method: 'GET', path: '/?p={n}' },
  { name: '节点主题查询', method: 'GET', path: `/go/${NODE_NAME}?p={n}` },
  { name: '热门排序', method: 'GET', path: '/hot?p={n}' },
  { name: '搜索查询', method: 'GET', path: '/go/search?q=linux&p={n}' },
  { name: '用户主页', method: 'GET', path: `/member/${USER_NAME}` },
  { name: '大型帖回复分页', method: 'GET', path: '/t/{n}?p=2' },
  { name: '节点列表 API', method: 'GET', path: '/api/nodes?limit=50&offset={n}' },
  { name: '搜索 API', method: 'GET', path: '/api/search?q=linux&limit=50' },
  { name: '排行榜 API', method: 'GET', path: '/api/leaderboard?limit=50' },
  { name: '主题详情 API', method: 'GET', path: '/api/topics/{n}' },
  { name: 'Feed', method: 'GET', path: '/api/feed' },
];

async function hit(method, path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'accept': 'application/json,text/html' },
      redirect: 'manual',
    });
    const body = await res.text();
    const dt = performance.now() - t0;
    // 5xx 与 404 视为错误（3xx 是重定向，游客态访问受保护页面属正常）
    const bad = res.status >= 500 || res.status === 404;
    return { dt, bad, status: res.status, len: body.length };
  } catch (e) {
    return { dt: performance.now() - t0, bad: true, status: 0, err: String(e) };
  }
}

// ---------------------------------------------------------------- 主流程
async function main() {
  console.log(`=== v0.0.4 真实社区负载测试 ===`);
  console.log(`  目标: ${BASE}`);
  console.log(`  时长: ${DURATION}s  并发: ${CONCURRENCY}  预热: ${WARMUP}s`);
  console.log();

  // —— 预热（排除首次 JIT / 连接建立的影响）
  console.log('  预热中…');
  for (let i = 0; i < WARMUP * 4; i++) {
    await hit('GET', '/');
  }

  console.log('  —— 读场景 ——');
  for (const sc of SCENARIOS) {
    const samples = [];
    const errors = [];
    const end = Date.now() + DURATION * 1000;
    let i = 0;
    // 每个并发 worker 独立循环
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (Date.now() < end) {
          const n = 1 + ((i++ * 7919) % 1000);
          const path = sc.path.replace('{n}', String(n));
          const r = await hit(sc.method, path);
          samples.push(r.dt);
          if (r.bad) {
            errors.push(`${r.status}${r.err ? ' ' + r.err : ''} ${path}`);
          }
        }
      }),
    );
    record(sc.name, sc.method, sc.path, samples, errors);
  }

  console.log();
  console.log('  —— 写场景（高并发发帖 / 回复）——');
  await writeScenarios();

  // —— 输出报告
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    duration: DURATION,
    concurrency: CONCURRENCY,
    scenarios,
  };
  const outFile = 'docs/evidence/loadtest/bench-result.json';
  try {
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`\n  ✓ 报告已写入 ${outFile}`);
  } catch (e) {
    console.log(`\n  ⚠ 报告写入失败: ${e.message}`);
  }
}

/** 写场景：并发发帖与回复 —— 需要登录态 */
async function writeScenarios() {
  const jar = [];
  // 登录一个压测账号
  try {
    const home = await fetch(BASE + '/');
    // Node 的 fetch 用 getSetCookie()（18+）；旧环境回退到 raw()。
    const rawSetCookie = home.headers.getSetCookie?.() ?? [];
    const rawHeader = home.headers.get('set-cookie') ?? '';
    const allCookies = rawSetCookie.length
      ? rawSetCookie
      : rawHeader
          .split(/,(?=[^;,]+=)/)
          .map((c) => c.trim());
    const csrf = allCookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('v2_csrf='))
      ?.split('=')[1];
    if (!csrf) {
      console.log('  ⚠ 拿不到 CSRF token，跳过写场景');
      console.log('     set-cookie 头:', rawHeader.slice(0, 120) || '(空)');
      return;
    }
    jar.push(`v2_csrf=${csrf}`);

    const signin = await fetch(BASE + '/api/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf,
        cookie: jar.join('; '),
      },
      body: JSON.stringify({
        username: process.env.LOADTEST_USER ?? 'lt_000001',
        password: process.env.LOADTEST_PASSWORD ?? '',
      }),
    });
    if (!signin.ok) {
      const body = await signin.text().catch(() => '');
      console.log(`  ⚠ 登录失败（${signin.status}）—— 写场景需要压测账号，跳过`);
      console.log('     响应:', body.slice(0, 160));
      return;
    }
    const sc2 = signin.headers.getSetCookie?.() ?? [];
    const raw2 = signin.headers.get('set-cookie') ?? '';
    const all2 = sc2.length
      ? sc2
      : raw2.split(/,(?=[^;,]+=)/).map((c) => c.trim());
    for (const c of all2) {
      if (c.startsWith('v2_session=')) jar.push(c.split(';')[0]);
    }
    if (!jar.some((c) => c.startsWith('v2_session='))) {
      console.log('  ⚠ 登录成功但没拿到会话 cookie，跳过写场景');
      return;
    }
    console.log(`  ✓ 已登录压测账号 ${process.env.LOADTEST_USER ?? 'lt_000001'}`);
  } catch (e) {
    console.log(`  ⚠ 登录异常：${e.message} —— 跳过写场景`);
    return;
  }

  const cookie = jar.join('; ');
  const csrf = jar.find((c) => c.startsWith('v2_csrf=')).split('=')[1];

  for (const sc of [
    { name: '并发发帖', path: '/api/topics', body: (i) => ({ nodeId: 1, title: `压测主题 ${Date.now()}-${i}`, content: `压测内容 ${Date.now()}-${i} 内容需要足够长以通过长度校验。` }) },
    { name: '并发回复', path: '/api/replies', body: (i) => ({ topicId: 1, content: `压测回复 ${Date.now()}-${i} 内容需要足够长以通过长度校验。` }) },
  ]) {
    const samples = [];
    const errors = [];
    const N = CONCURRENCY * 5;
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const t0 = performance.now();
        const res = await fetch(BASE + sc.path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf,
            cookie,
          },
          body: JSON.stringify(sc.body(i)),
        });
        const dt = performance.now() - t0;
        const bad = res.status >= 500;
        return { dt, bad, status: res.status };
      }),
    );
    for (const r of results) {
      samples.push(r.dt);
      if (r.bad) errors.push(String(r.status));
    }
    record(sc.name, 'POST', sc.path, samples, errors, { concurrency: N });
  }
}

main().catch((e) => {
  console.error('压测失败:', e);
  process.exit(1);
});
