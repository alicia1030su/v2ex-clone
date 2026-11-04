/**
 * 前端页面与组件的真实端到端验证脚本（临时验证用）
 *
 * 目的：验证 ui-pages 产出的组件所调用的 API 契约全部成立，
 * 且页面在登录态下能正确渲染、无 500。
 */
const http = require('http');

const PORT = Number(process.env.VERIFY_PORT || 3023);
const USER = process.env.SEED_ADMIN_USERNAME || 'admin';
const PASS = process.env.SEED_ADMIN_PASSWORD || 'test-admin-password-12345';

function req(path, opts = {}, body) {
  return new Promise((resolve) => {
    const headers = Object.assign({}, opts.headers || {});
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path, method: opts.method || 'GET', agent: false, headers },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      },
    );
    if (body) r.write(body);
    r.end();
  });
}

const jar = {};
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
  for (const c of res.headers['set-cookie'] || []) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}
function csrf() {
  return jar['v2_csrf'] || '';
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

(async () => {
  const warm = await req('/');
  storeCookies(warm);
  check('拿到 CSRF cookie', Boolean(csrf()));

  const login = await req(
    '/api/auth/signin',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf(),
        Cookie: cookieHeader(),
      },
    },
    JSON.stringify({ username: USER, password: PASS }),
  );
  storeCookies(login);
  check('登录成功', login.status === 200, `status=${login.status} ${login.body.slice(0, 200)}`);
  if (login.status !== 200) process.exit(1);

  const auth = { Cookie: cookieHeader(), 'x-csrf-token': csrf() };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };

  console.log('\n--- 页面渲染（登录态）---');
  for (const p of [
    '/admin',
    '/notifications',
    '/settings',
    '/leaderboard',
    '/forgot',
    '/reset-password',
    '/signin',
  ]) {
    const r = await req(p, { headers: { Cookie: cookieHeader() } });
    check(`${p} 渲染 200`, r.status === 200, `status=${r.status}`);
  }

  console.log('\n--- 组件调用的 API 契约 ---');
  const apis = [
    ['GET', '/api/users/me'],
    ['GET', '/api/credits?limit=20'],
    ['GET', '/api/checkin'],
    ['GET', '/api/notifications?limit=30&offset=0'],
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/pending'],
    ['GET', '/api/admin/users?limit=30&offset=0'],
    ['GET', '/api/admin/reports?status=pending'],
    ['GET', '/api/admin/node-requests?status=pending'],
    ['GET', '/api/admin/logs?limit=50'],
    ['GET', '/api/admin/config'],
    ['GET', '/api/leaderboard?limit=50&offset=0'],
  ];
  for (const [method, path] of apis) {
    const r = await req(path, { method, headers: auth });
    let ok = false;
    try {
      const j = JSON.parse(r.body);
      ok = r.status === 200 && j.ok === true;
    } catch {
      ok = false;
    }
    check(`${method} ${path}`, ok, `status=${r.status} ${r.body.slice(0, 160)}`);
  }

  console.log('\n--- 写操作（CSRF 生效验证）---');
  const noCsrf = await req('/api/checkin', { method: 'POST', headers: { Cookie: cookieHeader() } });
  check('无 CSRF token 的写操作被拒(403)', noCsrf.status === 403, `status=${noCsrf.status}`);

  const withCsrf = await req('/api/checkin', { method: 'POST', headers: auth });
  check('带 CSRF token 的签到成功', withCsrf.status === 200, `status=${withCsrf.status}`);

  // 通知：全部标记已读（NotificationsList 用的真实端点）
  const readAll = await req('/api/notifications', { method: 'POST', headers: jsonAuth }, JSON.stringify({}));
  check('通知全部标记已读', readAll.status === 200, `status=${readAll.status} ${readAll.body.slice(0, 120)}`);

  // 通知：标记单条已读
  const list = await req('/api/notifications?limit=1', { headers: auth });
  let oneId = null;
  try {
    const j = JSON.parse(list.body);
    if (j.notifications && j.notifications[0]) oneId = j.notifications[0].id;
  } catch {
    /* ignore */
  }
  if (oneId) {
    const readOne = await req(
      '/api/notifications',
      { method: 'POST', headers: jsonAuth },
      JSON.stringify({ id: oneId }),
    );
    check('通知单条标记已读', readOne.status === 200, `status=${readOne.status}`);
  } else {
    console.log('  SKIP  通知单条标记已读（当前无通知）');
  }

  const clear = await req('/api/notifications', { method: 'DELETE', headers: jsonAuth }, JSON.stringify({}));
  check('通知清空', clear.status === 200, `status=${clear.status}`);

  const me = await req('/api/users/me', { headers: auth });
  let meOk = false;
  try {
    const j = JSON.parse(me.body);
    meOk =
      me.status === 200 &&
      j.ok &&
      j.user &&
      'tagline' in j.user &&
      'bio' in j.user &&
      'url' in j.user &&
      'location' in j.user;
  } catch {
    meOk = false;
  }
  check('/api/users/me 返回资料四字段', meOk, me.body.slice(0, 200));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
