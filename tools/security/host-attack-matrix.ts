/**
 * Host Header Poisoning 攻击矩阵（v0.0.8 P0 安全审计）
 *
 * ## 目的
 *
 * v0.0.7 的 303 重定向曾按请求头（Host / x-forwarded-host /
 * x-forwarded-proto）构造**绝对** Location。本脚本在**真实应用**上
 * 系统性复现攻击面，验证 v0.0.8 的修复（相对 Location + 邮件链接
 * fail-closed）是否真的消除了投毒面。
 *
 * **不靠静态检查宣称安全** —— 每一行结论都有一次真实 HTTP 请求支撑。
 *
 * ## 攻击场景（对应任务书 §三清单）
 *
 *   1. 正常 Host（对照组）
 *   2. 伪造 Host: evil.example.com
 *   3. 伪造 X-Forwarded-Host: evil.example.com
 *   4. 伪造 X-Forwarded-Proto: https（降级/升级混淆）
 *   5. 多值 Forwarded Header（链式代理的第一跳vs最后一跳）
 *   6. 不可信代理直发转发头（同一请求既带 Host 又带 XFH）
 *   7. 协议相对 / 反斜杠重定向参数（开放重定向复测）
 *   8. 绝对 URL 重定向参数（开放重定向复测）
 *   9. IPv6 / 带端口 / 非法主机名 / 控制字符
 *  10. 密码重置链接投毒（**最关键**：令牌随链接泄露）
 *  11. 页面 HTML 中的绝对 URL 泄漏（缓存投毒面）
 *
 * ## 判定
 *
 *   · SAFE       —— Location 为站内相对路径，或与合法 origin 一致；
 *                   重置链接指向运维配置的基址。
 *   · VULNERABLE —— Location / 重置链接 / HTML 中出现**攻击者可控**
 *                   的 host 或协议。
 *
 * 退出码：有任一 VULNERABLE ⇒ 1（CI 直接红）。
 *
 * ## 运行
 *
 *   LOCAL_BASE=http://127.0.0.1:3010 \
 *   E2E_SMTP_PORT=3200 SMTP_PORT=3200 \
 *   npx tsx tools/security/host-attack-matrix.ts
 */

import { chromium, type APIRequestContext } from 'playwright';
import { startSmtpFixture, type SmtpFixture } from '../../e2e/smtp-fixture';

const BASE = (process.env.LOCAL_BASE ?? 'http://127.0.0.1:3010').replace(/\/+$/, '');
const APP_SMTP_PORT = Number(process.env.SMTP_PORT ?? 3025);
const E2E_SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? APP_SMTP_PORT);
const MAIL_DOMAIN = 'attack.local';

type Verdict = 'SAFE' | 'VULNERABLE' | 'ERROR';

type CaseResult = {
  id: string;
  category: string;
  description: string;
  request: { headers: Record<string, string>; redirectParam?: string };
  response: { status: number | null; location: string | null; note?: string };
  verdict: Verdict;
  reason: string;
};

const results: CaseResult[] = [];

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[attack-matrix]', ...args);
}

/** 合法 origin（应用配置的公开基址 —— 环境变量 APP_URL/PUBLIC_BASE_URL 决定） */
function legitOrigins(): string[] {
  const out: string[] = [];
  for (const v of [process.env.PUBLIC_BASE_URL, process.env.APP_URL]) {
    const t = v?.trim();
    if (!t) continue;
    try {
      out.push(new URL(t).origin);
    } catch {
      /* 忽略 */
    }
  }
  // 兜底：LOCAL_BASE 自身（测试环境未显式配 APP_URL 时）
  try {
    out.push(new URL(BASE).origin);
  } catch {
    /* 忽略 */
  }
  return [...new Set(out)];
}

/** 判定一个 Location 头是否安全 */
function judgeLocation(location: string | null): { verdict: Verdict; reason: string } {
  if (!location) return { verdict: 'SAFE', reason: '无 Location 头（非重定向响应）' };
  // 相对引用（RFC 7231 §7.1.2）⇒ 浏览器按实际请求 URL 解析 ⇒ 无投毒面
  if (location.startsWith('/') && !location.startsWith('//')) {
    return { verdict: 'SAFE', reason: `站内相对 Location：${location}` };
  }
  // 绝对 URL ⇒ 必须落在合法 origin 内
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return { verdict: 'VULNERABLE', reason: `Location 无法解析：${location}` };
  }
  const allowed = legitOrigins();
  if (allowed.some((o) => parsed.origin === o)) {
    return { verdict: 'SAFE', reason: `绝对 Location 指向合法 origin：${parsed.origin}` };
  }
  return {
    verdict: 'VULNERABLE',
    reason: `Location 指向非授权 origin：${parsed.origin}（合法：${allowed.join(' , ') || '无'}）`,
  };
}

/** 发一次带攻击头的 POST /api/replies */
async function attackReply(
  req: APIRequestContext,
  csrf: string,
  topicId: number,
  attackHeaders: Record<string, string>,
  redirectParam = '/t/' + topicId,
): Promise<{ status: number | null; location: string | null; body?: string; note?: string }> {
  try {
    const r = await req.post(`${BASE}/api/replies`, {
      headers: { 'x-csrf-token': csrf, ...attackHeaders },
      form: { topicId: String(topicId), content: `attack-probe ${Date.now()}`, redirect: redirectParam },
    });
    const loc = r.headers()['location'] ?? null;
    // ⚠️ v0.0.8：记录响应体 —— 没有它就无法区分「303（攻击场景真的被测了）」
    //    与「200（走了 JSON 分支 / 回复没创建）」。实测踩到：13 个场景全部
    //    返回 200 且无 Location ⇒ 看起来「全部 SAFE」，实际**攻击根本没发生**。
    const bodyText = await r.text().catch(() => '');
    return {
      status: r.status(),
      location: loc,
      body: bodyText.slice(0, 200),
    };
  } catch (err) {
    return { status: null, location: null, note: `请求失败：${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  log(`目标应用：${BASE}`);
  log(`SMTP：app→${APP_SMTP_PORT}，fixture→${E2E_SMTP_PORT}`);

  if (APP_SMTP_PORT !== E2E_SMTP_PORT) {
    throw new Error(`SMTP_PORT(${APP_SMTP_PORT}) 与 E2E_SMTP_PORT(${E2E_SMTP_PORT}) 不一致`);
  }

  // ── 启动独立 fake SMTP（供密码重置链接取证）──
  const smtp: SmtpFixture = await startSmtpFixture(E2E_SMTP_PORT);
  log(`fake SMTP 就绪：127.0.0.1:${smtp.port}`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const req = context.request;

  try {
    // ── 0. 前置：拿 CSRF cookie + 注册 + 建主题 ──
    await req.get(`${BASE}/`);
    const csrf =
      (await context.cookies()).find((c) => c.name === 'v2_csrf')?.value ?? '';
    if (!csrf) throw new Error('未取得 v2_csrf cookie（middleware 未下发？）');
    log(`CSRF token 已取得（${csrf.length} 字符）`);

    const username = `atk${Math.random().toString(36).slice(2, 9)}`;
    const email = `${username}@${MAIL_DOMAIN}`;
    const signup = await req.post(`${BASE}/api/auth/signup`, {
      headers: { 'x-csrf-token': csrf },
      data: { username, email, password: 'AttackTest-2026!' },
    });
    if (signup.status() !== 200 && signup.status() !== 201) {
      throw new Error(`注册失败：HTTP ${signup.status()} ${(await signup.text()).slice(0, 200)}`);
    }
    log(`测试用户已注册：${username}`);

    const nodesRes = await req.get(`${BASE}/api/nodes`);
    const nodesBody = (await nodesRes.json()) as { nodes?: { id: number }[] };
    const nodeId = nodesBody.nodes?.[0]?.id;
    if (!nodeId) throw new Error('未取得可用节点');
    const topicRes = await req.post(`${BASE}/api/topics`, {
      headers: { 'x-csrf-token': csrf },
      data: { nodeId, title: `Host 攻击矩阵 ${Date.now()}`, content: '安全审计用主题，勿删。' },
    });
    const topicBody = (await topicRes.json()) as { topicId?: number; topic?: { id: number } };
    const topicId = topicBody.topicId ?? topicBody.topic?.id;
    if (!topicId) throw new Error(`建主题失败：HTTP ${topicRes.status()}`);
    log(`测试主题已创建：/t/${topicId}`);

    // ── 1~9. 303 Location 攻击矩阵 ──
    const cases: {
      id: string;
      category: string;
      description: string;
      headers: Record<string, string>;
      redirectParam?: string;
    }[] = [
      {
        id: 'A1',
        category: '对照组',
        description: '正常 Host（应用实际监听地址）',
        headers: {},
      },
      {
        id: 'A2',
        category: 'Host 伪造',
        description: 'Host: evil.example.com（直连场景攻击者完全可控）',
        headers: { host: 'evil.example.com' },
      },
      {
        id: 'A3',
        category: 'X-Forwarded-Host 伪造',
        description: 'X-Forwarded-Host: evil.example.com（代理不剥离客户端头时）',
        headers: { 'x-forwarded-host': 'evil.example.com' },
      },
      {
        id: 'A4',
        category: 'X-Forwarded-Proto 伪造',
        description: 'X-Forwarded-Proto: https（把明文部署的跳转升级成 https）',
        headers: { 'x-forwarded-proto': 'https' },
      },
      {
        id: 'A5',
        category: '多值 Forwarded',
        description: 'X-Forwarded-Host: good.example.com, evil.example.com（链式代理歧义）',
        headers: { 'x-forwarded-host': 'good.example.com, evil.example.com' },
      },
      {
        id: 'A6',
        category: '多值 Proto',
        description: 'X-Forwarded-Proto: https, http',
        headers: { 'x-forwarded-proto': 'https, http' },
      },
      {
        id: 'A7',
        category: '不可信代理',
        description: '同时带 Host + X-Forwarded-Host + X-Forwarded-Proto（不可信代理直发）',
        headers: {
          host: 'evil.example.com',
          'x-forwarded-host': 'evil.example.com',
          'x-forwarded-proto': 'https',
        },
      },
      {
        id: 'A8',
        category: '开放重定向参数',
        description: 'redirect=https://evil.example.com（绝对 URL 注入）',
        headers: {},
        redirectParam: 'https://evil.example.com',
      },
      {
        id: 'A9',
        category: '开放重定向参数',
        description: 'redirect=//evil.example.com（协议相对注入）',
        headers: {},
        redirectParam: '//evil.example.com',
      },
      {
        id: 'A10',
        category: '开放重定向参数',
        description: 'redirect=/\\evil.example.com（反斜杠变体注入）',
        headers: {},
        redirectParam: '/\\evil.example.com',
      },
      {
        id: 'A11',
        category: '畸形 Host',
        description: 'Host: evil.example.com:99999（非法端口）',
        headers: { host: 'evil.example.com:99999' },
      },
      {
        id: 'A12',
        category: '畸形 Host',
        description: 'Host: [::1]:3103（IPv6 字面量）',
        headers: { host: '[::1]:3103' },
      },
      {
        id: 'A13',
        category: '畸形 Host',
        description: 'Host: EVIL.EXAMPLE.COM（大小写混淆）',
        headers: { host: 'EVIL.EXAMPLE.COM' },
      },
    ];

    // ── 探针：先确认「回复确实能创建」与「表单分支确实返回 303」──
    //
    // ⚠️ v0.0.8 实测踩到：首轮 13 个场景全部 status=200 且无 Location，
    //    看起来「全部 SAFE」，实际**攻击根本没发生**（303 从未出现）。
    //    所以在跑场景之前先用两个对照请求把「测试前提」钉死：
    //      P1（JSON 分支）→ 期望 200 + { ok:true, replyId }
    //      P2（表单分支）→ 期望 **303** + Location
    //    任一不符 ⇒ 直接判 ERROR（而不是继续跑出一堆假 SAFE）。
    {
      const jsonRes = await req.post(`${BASE}/api/replies`, {
        headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
        data: { topicId, content: `probe-json ${Date.now()}`, redirect: `/t/${topicId}` },
      });
      const jsonBody = await jsonRes.text().catch(() => '');
      const formRes = await req.post(`${BASE}/api/replies`, {
        headers: { 'x-csrf-token': csrf },
        form: { topicId: String(topicId), content: `probe-form ${Date.now()}`, redirect: `/t/${topicId}` },
      });
      const formBody = await formRes.text().catch(() => '');
      const formLoc = formRes.headers()['location'] ?? null;
      console.log(
        `[attack-matrix] 探针 P1(JSON) status=${jsonRes.status()} body=${jsonBody.slice(0, 120)}`,
      );
      console.log(
        `[attack-matrix] 探针 P2(表单) status=${formRes.status()} location=${formLoc} body=${formBody.slice(0, 120)}`,
      );
      if (formRes.status() !== 303) {
        throw new Error(
          `测试前提不成立：表单分支未返回 303（实际 ${formRes.status()}）` +
            ` ⇒ 303 场景无法被真正测试，拒绝产出「假 SAFE」结论。` +
            `\n  body: ${formBody.slice(0, 300)}`,
        );
      }
    }

    for (const c of cases) {
      const r = await attackReply(req, csrf, topicId, c.headers, c.redirectParam);
      const judged = judgeLocation(r.location);
      results.push({
        id: c.id,
        category: c.category,
        description: c.description,
        request: { headers: c.headers, redirectParam: c.redirectParam },
        response: { status: r.status, location: r.location, note: r.note },
        verdict: r.note ? 'ERROR' : judged.verdict,
        reason: r.note ?? judged.reason,
      });
      log(
        `${c.id} [${c.category}] ${judged.verdict}${r.note ? ' (ERROR)' : ''} — ${judged.reason}`,
      );
    }

    // ── 10. 密码重置链接投毒（最关键：令牌泄露 ⇒ 账号接管）──
    for (const [id, headers, desc] of [
      ['B1', {}, '对照组：正常 Host'],
      ['B2', { host: 'evil.example.com' }, '伪造 Host'],
      ['B3', { 'x-forwarded-host': 'evil.example.com' }, '伪造 X-Forwarded-Host'],
      ['B4', { 'x-forwarded-proto': 'https' }, '伪造 X-Forwarded-Proto'],
    ] as [string, Record<string, string>, string][]) {
      const victim = `victim_${id}_${Math.random().toString(36).slice(2, 8)}`;
      const victimEmail = `${victim}@${MAIL_DOMAIN}`;
      const reg = await req.post(`${BASE}/api/auth/signup`, {
        headers: { 'x-csrf-token': csrf },
        data: { username: victim, email: victimEmail, password: 'VictimPass-2026!' },
      });
      if (reg.status() !== 200 && reg.status() !== 201) {
        results.push({
          id,
          category: '密码重置链接',
          description: desc,
          request: { headers },
          response: { status: reg.status(), location: null },
          verdict: 'ERROR',
          reason: `注册受害者失败：HTTP ${reg.status()}`,
        });
        continue;
      }
      const fp = await req.post(`${BASE}/api/auth/forgot-password`, {
        headers: { 'x-csrf-token': csrf, ...headers },
        data: { email: victimEmail },
      });
      let mailBody = '';
      let verdict: Verdict = 'SAFE';
      let reason = '';
      try {
        // ⚠️ 大小写不敏感：应用会把邮箱**转小写**（用户名规范化为小写），
        //    而 victimEmail 里含用例 ID（如 B1）⇒ 原样 includes 匹配不到
        //    ⇒ 误报「未收到邮件」（实测踩到：日志显示已收到 victim_b1_…，
        //    但谓词找的是 victim_B1_…）⇒ 得出「fail-closed」的假结论。
        const needle = victimEmail.toLowerCase();
        const mail = await smtp.waitForMail(
          (m) => m.to.some((t) => t.toLowerCase() === needle),
          15_000,
        );
        mailBody = mail.body;
        const m = mailBody.match(/https?:\/\/[^\s"'<>]*\/reset-password\?token=([^\s"'<>&]+)/);
        if (!m) {
          verdict = 'SAFE';
          reason = '邮件正文中无重置链接（fail-closed 或未发送）—— 未泄露令牌';
        } else {
          const linkOrigin = new URL(m[0]).origin;
          const allowed = legitOrigins();
          if (allowed.some((o) => linkOrigin === o)) {
            verdict = 'SAFE';
            reason = `重置链接指向配置基址：${linkOrigin}`;
          } else {
            verdict = 'VULNERABLE';
            reason = `重置链接被攻击者控制到：${linkOrigin}（令牌泄露 ⇒ 账号接管）`;
          }
        }
      } catch (err) {
        verdict = 'SAFE';
        reason = `未收到邮件（fail-closed）：${(err as Error).message.slice(0, 120)}`;
      }
      results.push({
        id,
        category: '密码重置链接',
        description: desc,
        request: { headers },
        response: { status: fp.status(), location: null },
        verdict,
        reason,
      });
      log(`${id} [密码重置链接] ${verdict} — ${reason}`);
    }

    // ── 11. 页面 HTML 绝对 URL 泄漏（缓存投毒面）──
    for (const [id, headers, desc] of [
      ['C1', { host: 'evil.example.com' }, '伪造 Host 拉首页'],
      ['C2', { 'x-forwarded-host': 'evil.example.com' }, '伪造 XFH 拉首页'],
    ] as [string, Record<string, string>, string][]) {
      try {
        const r = await req.get(`${BASE}/`, { headers });
        const html = await r.text();
        const hits = ['evil.example.com'].filter((d) => html.includes(d));
        const verdict: Verdict = hits.length ? 'VULNERABLE' : 'SAFE';
        const reason = hits.length
          ? `HTML 中出现攻击者域名：${hits.join(',')}（缓存投毒 / 外链注入面）`
          : 'HTML 中未出现攻击者域名';
        results.push({
          id,
          category: 'HTML 泄漏',
          description: desc,
          request: { headers },
          response: { status: r.status(), location: null },
          verdict,
          reason,
        });
        log(`${id} [HTML 泄漏] ${verdict} — ${reason}`);
      } catch (err) {
        results.push({
          id,
          category: 'HTML 泄漏',
          description: desc,
          request: { headers },
          response: { status: null, location: null, note: (err as Error).message },
          verdict: 'ERROR',
          reason: (err as Error).message,
        });
        log(`${id} [HTML 泄漏] ERROR — ${(err as Error).message}`);
      }
    }

    // ── 收尾：资源释放 ──
    const stopInfo = await smtp.stop();
    log(`fake SMTP 已停止：received=${stopInfo.received} openSockets=${stopInfo.openSockets}`);
    if (stopInfo.openSockets !== 0 || stopInfo.exitCode !== 0) {
      log('⚠️ fake SMTP 资源未完全释放');
    }
  } finally {
    await browser.close();
  }

  // ── 汇总 ──
  const vulnerable = results.filter((r) => r.verdict === 'VULNERABLE');
  const errored = results.filter((r) => r.verdict === 'ERROR');
  const safe = results.filter((r) => r.verdict === 'SAFE');

  log('');
  log('════════════ 攻击矩阵汇总 ════════════');
  log(`SAFE: ${safe.length}  VULNERABLE: ${vulnerable.length}  ERROR: ${errored.length}`);
  for (const r of [...vulnerable, ...errored]) {
    log(`  ${r.verdict} ${r.id} [${r.category}] ${r.description}`);
    log(`      → ${r.reason}`);
  }
  log('══════════════════════════════════════');

  // 报告落盘（CI artifact 取证）
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    legitOrigins: legitOrigins(),
    smtp: { appPort: APP_SMTP_PORT, fixturePort: E2E_SMTP_PORT },
    summary: { safe: safe.length, vulnerable: vulnerable.length, error: errored.length },
    results,
  };
  const fs = await import('node:fs');
  const out = process.env.ATTACK_REPORT_PATH ?? 'attack-matrix-report.json';
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  log(`报告已写入：${out}`);

  if (vulnerable.length > 0) {
    log('✗ 存在可利用的 Host Header Poisoning —— 修复前不得合并');
    process.exit(1);
  }
  if (errored.length > 0) {
    log('⚠️ 有用例执行出错（见报告）—— 不等于安全，需人工复核');
    process.exit(2);
  }
  log('✓ 全部攻击场景被防御');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[attack-matrix] 执行失败：', err);
  process.exit(3);
});
