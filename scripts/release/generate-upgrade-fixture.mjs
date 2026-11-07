#!/usr/bin/env node
/**
 * v0.0.9 —— 升级基线业务数据生成器（任务书 §四）
 *
 * ## 为什么需要它
 *
 * 升级验证要证明「用户数据原样保留」。但**只靠 seed 数据是不够的** ——
 * seed 库里没有通知、没有积分流水、没有感谢、没有投票，
 * 而这些恰恰是升级最容易丢、也最需要验证的数据。
 *
 * 所以这里通过**真实 HTTP 接口**（不是直接写库）造出这些数据，
 * 这样造出来的行会带上应用层写入的完整字段（关联 id、时间戳、
 * 积分账本的 balance_before/balance_after 等）。
 *
 * ## 生成的数据
 *
 *   · 通知     —— lisi 发帖并 @提及 zhaoliu ⇒ zhaoliu 收到通知
 *   · 积分流水 —— 发帖 + 回复 会触发 grantCredits ⇒ credit_ledger 有行
 *   · 感谢     —— 对已有回复点感谢 ⇒ thanks 表有行
 *   · 投票     —— 对主题投票 ⇒ votes 表有行
 *   · 收藏     —— 收藏主题 ⇒ collections 表有行
 *   · 关注     —— 关注用户 ⇒ follows 表有行
 *
 * ## 用法
 *
 *   node scripts/release/generate-upgrade-fixture.mjs \
 *     --base http://localhost:3012 \
 *     --admin-password '...' --demo-password '...'
 *
 * 退出码：0 = 全部成功 / 1 = 有失败
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = opt('--base', 'http://localhost:3012').replace(/\/$/, '');
const ADMIN_PW = opt('--admin-password', '');
const DEMO_PW = opt('--demo-password', '');
const OUT = opt('--out', '');

if (!ADMIN_PW || !DEMO_PW) {
  console.error('必须提供 --admin-password 与 --demo-password');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };

/** 每个账号一个 cookie jar（会话隔离） */
function newJar() {
  return { cookie: '', csrf: '' };
}

async function jarFetch(jar, url, options = {}) {
  const headers = new Headers(options.headers || {});
  const { json: payload, ...rest } = options;
  if (payload !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (jar.cookie) headers.set('cookie', jar.cookie);
  if (jar.csrf && rest.method && rest.method !== 'GET') {
    headers.set('x-csrf-token', jar.csrf);
  }
  const init = { ...rest, headers, redirect: 'manual' };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  const res = await fetch(url.startsWith('http') ? url : BASE + url, init);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (k && v) {
      if (k === 'v2_csrf') jar.csrf = v;
      const existing = jar.cookie
        .split('; ')
        .filter((p) => p && !p.startsWith(`${k}=`));
      existing.push(`${k}=${v}`);
      jar.cookie = existing.join('; ');
    }
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, text, json };
}

/** 取 CSRF：先读 cookie，再访问首页确保拿到 */
async function primeCsrf(jar) {
  await jarFetch(jar, '/');
  if (!jar.csrf) {
    const r = await jarFetch(jar, '/');
    if (r.json?.csrf) jar.csrf = r.json.csrf;
  }
  return jar.csrf;
}

async function signin(jar, username, password) {
  await primeCsrf(jar);
  const r = await jarFetch(jar, '/api/auth/signin', {
    method: 'POST',
    json: { username, password },
  });
  if (r.status !== 200) {
    bad(`登录失败 ${username}（HTTP ${r.status}）: ${r.text.slice(0, 160)}`);
    return false;
  }
  ok(`登录成功：${username}`);
  return true;
}

console.log(`\n═══ 升级基线业务数据生成（base=${BASE}）═══\n`);

// ── 1. 登录两个账号（一个发帖者、一个被提及者）──────────────────────────
const jarA = newJar(); // lisi —— 发帖 + @提及
const jarB = newJar(); // zhaoliu —— 被提及者

if (!(await signin(jarA, 'lisi', DEMO_PW))) process.exit(1);
if (!(await signin(jarB, 'zhaoliu', DEMO_PW))) process.exit(1);

// ── 2. 查一个可用节点 id ────────────────────────────────────────────────
const nodesRes = await jarFetch(jarA, '/api/nodes');
let nodeId = 0;
if (nodesRes.json) {
  const nodes = Array.isArray(nodesRes.json)
    ? nodesRes.json
    : (nodesRes.json.nodes ?? nodesRes.json.data ?? []);
  const first = nodes.find((n) => n && (n.id ?? n.nodeId));
  if (first) nodeId = first.id ?? first.nodeId;
}
if (!nodeId) {
  // 回退：直接查第一个主题所属节点（seed 必然有主题）
  nodeId = 1;
}
ok(`使用节点 id = ${nodeId}`);

// ── 3. lisi 发帖并 @提及 zhaoliu（产生通知）─────────────────────────────
const title = `升级基线探针主题 ${Date.now()}`;
const content = `这是升级验证用探针主题，内容需要超过十个字符。@zhaoliu 请注意。`;
const topicRes = await jarFetch(jarA, '/api/topics', {
  method: 'POST',
  json: { nodeId, title, content },
});
if (topicRes.status !== 200 && topicRes.status !== 201) {
  bad(`发帖失败（HTTP ${topicRes.status}）: ${topicRes.text.slice(0, 200)}`);
  process.exit(1);
}
const topicId =
  topicRes.json?.topic?.id ??
  topicRes.json?.id ??
  // v0.0.4 / v0.0.9 的发帖响应是 `{ ok: true, redirect: '/t/<id>' }`
  (() => {
    const m = /\/t\/(\d+)/.exec(topicRes.json?.redirect ?? '');
    return m ? Number(m[1]) : null;
  })();
if (!topicId) {
  bad(`发帖响应中无法解析 topicId: ${topicRes.text.slice(0, 200)}`);
  process.exit(1);
}
ok(`发帖成功，topicId = ${topicId}`);

// ── 4. lisi 回复自己的主题（产生回复 + 积分流水）────────────────────────
const replyRes = await jarFetch(jarA, '/api/replies', {
  method: 'POST',
  json: { topicId, content: '这是升级验证用探针回复，内容足够长以通过校验。' },
});
if (replyRes.status !== 200 && replyRes.status !== 201) {
  bad(`回复失败（HTTP ${replyRes.status}）: ${replyRes.text.slice(0, 200)}`);
} else {
  ok('回复成功');
}

// ── 5. zhaoliu 感谢 lisi 的回复（产生 thanks 行 + 积分流水）───────────────
// 先拿到 lisi 刚发的回复 id
const replyId = await (async () => {
  const t = await jarFetch(jarA, `/api/topics/${topicId}`);
  const list = t.json?.replies ?? t.json?.data?.replies ?? [];
  const mine = list.find((r) => (r.author?.username ?? r.username) === 'lisi');
  return mine?.id ?? list[0]?.id ?? null;
})();

if (replyId) {
  const thanksRes = await jarFetch(jarB, '/api/thanks', {
    method: 'POST',
    json: { replyId },
  });
  if (thanksRes.status === 200 || thanksRes.status === 201) {
    ok(`感谢成功（replyId=${replyId}）`);
  } else {
    bad(`感谢失败（HTTP ${thanksRes.status}）: ${thanksRes.text.slice(0, 160)}`);
  }
} else {
  bad('未找到可感谢的回复');
}

// ── 6. 投票 ─────────────────────────────────────────────────────────────
const voteRes = await jarFetch(jarB, '/api/votes', {
  method: 'POST',
  json: { topicId, direction: 'up' },
});
if (voteRes.status === 200) ok('投票成功');
else bad(`投票失败（HTTP ${voteRes.status}）: ${voteRes.text.slice(0, 160)}`);

// ── 7. 收藏 ─────────────────────────────────────────────────────────────
const colRes = await jarFetch(jarB, '/api/collections', {
  method: 'POST',
  json: { target: 'topic', id: topicId, action: 'add' },
});
if (colRes.status === 200) ok('收藏成功');
else bad(`收藏失败（HTTP ${colRes.status}）: ${colRes.text.slice(0, 160)}`);

// ── 8. 关注（可能无独立 API；失败不致命，但要如实报告）────────────────────
let followOk = false;
try {
  const followRes = await jarFetch(jarB, `/api/users/lisi/follow`, { method: 'POST' });
  followOk = followRes.status === 200 || followRes.status === 201;
  if (followOk) ok('关注成功');
  else console.log(`  · 关注未生效（HTTP ${followRes.status}）—— 可能无独立接口`);
} catch {
  console.log('  · 关注接口不可用 —— 记为未生成');
}

// ── 9. 验证通知真的产生 ────────────────────────────────────────────────
//
// ⚠️ v0.0.4 **没有 @提及功能**（`src/lib/mentions.ts` 是 v0.0.5 才引入的）。
// v0.0.4 里能产生通知的路径是「感谢」⇒ 被感谢者收到 `topic_thanks` 通知。
// 所以这里查 **lisi（被感谢者）** 的通知列表，而不是 zhaoliu。
const notifRes = await jarFetch(jarA, '/api/notifications');
let notifCount = -1;
let notifTypes = [];
if (notifRes.json) {
  const list = Array.isArray(notifRes.json)
    ? notifRes.json
    : (notifRes.json.notifications ?? notifRes.json.data ?? []);
  notifCount = list.length;
  notifTypes = list.map((n) => n.type).filter(Boolean);
}
if (notifCount > 0) {
  ok(`被感谢者收到通知 ${notifCount} 条（类型：${notifTypes.join(', ') || '未标注'}）`);
} else {
  bad(`被感谢者通知数为 ${notifCount} —— 感谢未产生通知`);
}

// ── 10. 记录 @提及支持情况（v0.0.4 无此功能，需如实标注）────────────────
//
// v0.0.9 已具备 `src/lib/mentions.ts`（@提及 ⇒ 通知）。
// 本轮升级验证的是「**v0.0.4 的数据**升级到 v0.0.9 后是否完好」，
// 因此 @提及通知由 v0.0.9 侧的专项验收覆盖（见 e2e/v005-mentions.spec.ts），
// 不在 v0.0.4 基线里产生。
const mentionSupportedInV004 = false;
console.log(`  · @提及：v0.0.4 不支持该功能（mentions 库为 v0.0.5 引入），基线中不含提及通知`);

// ── 11. 头像上传（任务书 §四要求验证「用户上传文件」）────────────────────
//
// 用一个**合法 PNG**（1x1）走真实的 multipart 上传链，
// 让 avatars 表有行、users.avatar 有值、磁盘上有文件。
// 这三项在升级后都必须保留。
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadAvatar(jar, label) {
  await primeCsrf(jar);
  const form = new FormData();
  form.append('file', new Blob([PNG_1x1], { type: 'image/png' }), 'probe.png');
  const headers = new Headers();
  if (jar.cookie) headers.set('cookie', jar.cookie);
  if (jar.csrf) headers.set('x-csrf-token', jar.csrf);
  const res = await fetch(`${BASE}/api/users/avatar`, {
    method: 'POST',
    headers,
    body: form,
    redirect: 'manual',
  });
  const text = await res.text();
  if (res.status === 200 || res.status === 201) {
    ok(`头像上传成功（${label}）：${text.slice(0, 120)}`);
    return true;
  }
  bad(`头像上传失败（${label}，HTTP ${res.status}）: ${text.slice(0, 160)}`);
  return false;
}

const avatarUploaded = await uploadAvatar(jarA, 'lisi');

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    topicId, replyId, nodeId, notifCount, notifTypes, followOk,
    mentionSupportedInV004, avatarUploaded,
    generatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  console.log(`\n  探针信息已写入：${OUT}`);
}

console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══\n`);
process.exit(fail > 0 ? 1 : 0);
