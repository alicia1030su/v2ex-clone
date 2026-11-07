# v0.0.8 安全审计报告 —— Host Header 与重定向

> **日期**：2026-11-07
> **审计范围**：v0.0.7 引入的 `src/lib/redirect-url.ts`（303 重定向）
> 与找回密码邮件链接的基址推导
> **结论**：**发现 1 个真实的 Host Header Poisoning 攻击面**（v0.0.7 遗留），
> 已修复并用 **19 个攻击场景**在真实应用上验证（含反向断言）。
> **报告方法**：全部结论来自**真实 HTTP 请求**与 **CI 自动化攻击矩阵**，
> 不依赖静态检查宣称安全。

---

## 一、审计对象与背景

### 1.1 v0.0.7 的实现（被审计对象）

```ts
// src/lib/redirect-url.ts（v0.0.7 引入，v0.0.8 已删除）
export function resolveRequestHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();   // ← 取链上第一个
    if (first) return first;
  }
  return request.headers.get('host')?.trim() || null;
}

export function resolveRequestProtocol(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim().toLowerCase();
    if (first === 'https' || first === 'http') return first;
  }
  return new URL(request.url).protocol.replace(':', '');
}

export function buildRedirectUrl(request: Request, path: string): string {
  const host = resolveRequestHost(request);
  // ...
  return `${proto}://${host}${safePath}`;   // ← 绝对 URL，host 完全来自请求头
}
```

调用点：`src/app/api/replies/route.ts`（POST 回复成功后的 **303 See Other**）。

### 1.2 为什么这段代码存在（不是凭空引入的缺陷）

v0.0.7 修的是另一个真实缺陷：`new URL(redirect, request.url)` 在
`next start` 下按**服务器自身 hostname**（默认 `localhost`）重建 URL，
把用户从 `127.0.0.1` 带到 `localhost` ⇒ 浏览器出现两个 `v2_csrf` cookie
⇒ **后续所有写操作 403**。

⇒ 「从请求头取 host」是当时合理的修法，但**引入了一个新的、更隐蔽的攻击面**。

---

## 二、审计发现的攻击面

### 2.1 攻击面 A：303 Location 的域名与协议可被攻击者控制

**威胁模型**：

| 部署形态 | 攻击者能力 |
|---|---|
| 直连应用（应用端口暴露） | 完全控制 `Host` 头 |
| 反代（未剥离客户端转发头） | 完全控制 `x-forwarded-host` / `x-forwarded-proto` |
| 反代（剥离了转发头） | 不可控（安全） |

**可利用后果**：

1. **开放重定向**：攻击者构造 `Host: evil.example.com` ⇒ 303 把受害者
   送到 `https://evil.example.com/t/22`（钓鱼、令牌泄露、OAuth 回调劫持等）。
2. **协议降级**：`X-Forwarded-Proto: http` ⇒ 把 HTTPS 站点的跳转降级为 HTTP。
3. **缓存投毒**：若中间缓存缓存了 303 响应，后续受害者被持续重定向到
   攻击者域名（**影响面从「攻击者自己」扩大到「所有访问者」**）。
4. **反代部署下用户被重定向到打不开的 host**（多域名 / 局域网场景）。

### 2.2 攻击面 B：密码重置邮件链接的基址可被请求头影响

v0.0.7 的找回密码路由：

```ts
const baseUrl =
  process.env.PUBLIC_BASE_URL?.trim() ||
  (process.env.APP_URL?.trim() ?? '') ||
  new URL(request.url).origin;          // ← 回退到请求自身的 origin
const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
```

**风险**：若 `PUBLIC_BASE_URL` / `APP_URL` 未配置（**反代/多域名部署的常见状态**），
基址回退到 `request.url` 的 origin。而 `request.url` 的 host 来源
需要逐层确认 —— 若其中任何一层采信了请求头，攻击者即可让**重置链接指向
自己的域名**，受害者一点击即**把一次性重置令牌交到攻击者手里**
⇒ **完整账号接管**。

> **本轮实测**：v0.0.8 修复后，伪造 Host / XFH / XFP 的四个场景下，
> 重置链接**恒指向运维配置的基址**（见 §四证据 B1~B4）。

---

## 三、修复方案

### 3.1 303 重定向改用**站内相对 Location**（RFC 7231 §7.1.2）

```ts
// src/lib/redirect.ts（新增）
export function seeOther(path: unknown): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: sanitizeRedirect(path),   // 内部再净化（纵深防御）
      'Cache-Control': 'no-store',
    },
  });
}
```

**为什么这是首选方案**（任务书 §三的要求）：

| 维度 | 相对 Location | 绝对 URL（白名单校验） |
|---|---|---|
| 攻击面 | **零**（不经任何请求头） | 需正确实现白名单 + 可信代理判定 |
| 反代/多域名 | **自动正确**（浏览器按实际请求 URL 解析） | 需运维正确配置，否则跳错 |
| 协议 | **自动正确**（跟随实际连接） | 需正确处理 XFP |
| 缓存投毒 | 不受影响（Location 是相对路径） | 需额外防护 |
| 实现复杂度 | **低** | 高（白名单、代理边界、端口策略） |

**RFC 依据**：RFC 7231 §7.1.2 明确允许 `Location` 为相对引用，
且「若为相对引用，接收方按请求的**有效 URI** 解析」⇒
host 与协议**必然**与实际请求一致。

### 3.2 邮件链接基址：**只信运维配置，fail-closed**

```ts
// src/lib/public-base-url.ts（新增）
export function resolvePublicBaseUrl(): string | null {
  for (const candidate of [process.env.PUBLIC_BASE_URL, process.env.APP_URL]) {
    const value = candidate?.trim();
    if (!value) continue;
    const normalized = normalizeConfiguredBaseUrl(value);   // 严格校验
    if (normalized) return normalized;
    console.error('[public-base-url] 环境变量值不合法，已忽略：…');
  }
  return null;   // ← 未配置 ⇒ null
}
```

调用方（`forgot-password`）：

```ts
const baseUrl = resolvePublicBaseUrl();
if (!baseUrl) {
  // fail-closed：**不发任何带不可信链接的邮件**
  console.error('[forgot-password] 未配置 PUBLIC_BASE_URL / APP_URL，已拒绝发送重置邮件…');
} else {
  // 正常发送，链接基址 = baseUrl（配置值）
}
```

**设计要点**：

- **不退回请求头**（那正是攻击面本身）；
- **不退回 `request.url`**（同因）；
- 配置值本身严格校验（协议必须是 http/https、主机名非空、无控制字符）；
- 响应仍保持统一（邮箱枚举防护不受影响），但错误**可观测**；
- 生产部署文档已补 `PUBLIC_BASE_URL` 说明（`deploy/.env.example`）。

### 3.3 明确的能力边界（安全修复不制造新风险）

| 事项 | 处理 |
|---|---|
| 外部绝对 URL 重定向 | `sanitizeRedirect` 拦为 `/`（既有行为，v0.0.8 加断言锁住） |
| 协议相对 `//evil.com` | 拦为 `/` |
| 反斜杠变体 `/\evil.com` | 拦为 `/` |
| CRLF 注入 | 拦为 `/` |
| 令牌有效期 / 限流窗口 | **不受** `APP_NOW` 影响（`tests/v008-app-now.spec.ts` 有回归护栏） |

---

## 四、攻击矩阵实测证据

### 4.1 执行方式

- 脚本：`tools/security/host-attack-matrix.ts`
- 工作流：`.github/workflows/security-host-audit.yml`（PR 触发，Linux 隔离环境）
- 真实应用（`next start`）+ 真实 PostgreSQL + 真实 SMTP
- **每次请求都带伪造头**，检查**未跟随重定向**的原始响应（`maxRedirects: 0`）

### 4.2 结果（run `42336954558`，19/19 SAFE，0 VULNERABLE）

合法 origin：`http://127.0.0.1:3010`（运维配置）

| ID | 场景 | 状态 | Location | 判定 |
|---|---|---|---|---|
| A1 | 正常 Host（对照组） | 303 | `/t/11` | SAFE |
| A2 | `Host: evil.example.com` | 303 | `/t/11` | SAFE |
| A3 | `X-Forwarded-Host: evil.example.com` | 303 | `/t/11` | SAFE |
| A4 | `X-Forwarded-Proto: https` | 303 | `/t/11` | SAFE |
| A5 | `X-Forwarded-Host: good.example.com, evil.example.com` | 303 | `/t/11` | SAFE |
| A6 | `X-Forwarded-Proto: https, http` | 303 | `/t/11` | SAFE |
| A7 | 不可信代理（Host + XFH + XFP 同时伪造） | 303 | `/t/11` | SAFE |
| A8 | `redirect=https://evil.example.com` | 303 | `/` | SAFE |
| A9 | `redirect=//evil.example.com` | 303 | `/` | SAFE |
| A10 | `redirect=/\evil.example.com` | 303 | `/` | SAFE |
| A11 | `Host: evil.example.com:99999`（非法端口） | 303 | `/t/11` | SAFE |
| A12 | `Host: [::1]:3103`（IPv6 字面量） | 303 | `/t/11` | SAFE |
| A13 | `Host: EVIL.EXAMPLE.COM`（大小写混淆） | 303 | `/t/11` | SAFE |
| B1 | 密码重置链接（正常 Host） | 200 | — | SAFE（链接 → 配置基址） |
| B2 | 密码重置链接（伪造 Host） | 200 | — | SAFE（链接 → 配置基址） |
| B3 | 密码重置链接（伪造 XFH） | 200 | — | SAFE（链接 → 配置基址） |
| B4 | 密码重置链接（伪造 XFP） | 200 | — | SAFE（链接 → 配置基址） |
| C1 | 首页 HTML（伪造 Host） | 200 | — | SAFE（HTML 无攻击者域名） |
| C2 | 首页 HTML（伪造 XFH） | 200 | — | SAFE（HTML 无攻击者域名） |

**读法**：

- A1~A13：无论怎么伪造 Host / 转发头，**Location 恒为站内相对路径**
  ⇒ 攻击者**完全无法控制**跳转的域名或协议；
- A8~A10：开放重定向参数被 `sanitizeRedirect` 拦为 `/`；
- B1~B4：重置链接**恒指向运维配置的基址** ⇒ 令牌不可能被投毒；
- C1~C2：HTML 中不出现攻击者域名 ⇒ 无缓存投毒 / 外链注入面。

### 4.3 反向断言（防止「假绿」）

攻击矩阵内置**测试前提探针**：

```
P1（JSON 分支）→ 期望 200 + { ok:true, replyId }   （确认回复确实创建）
P2（表单分支）→ 期望 303 + Location                  （确认 303 路径确实执行）
```

任一不符 ⇒ **直接抛错终止**，不产出任何结论。

> **本轮最重要的一条教训**：修复前的两轮矩阵都报「19/19 SAFE」，但
> **303 从未发生** —— Playwright 的 `APIRequestContext` 默认
> `maxRedirects: 20` 会**自动跟随**重定向，Location 头因此消失。
> ⇒ 加上 `maxRedirects: 0` 后才拿到上表的**真实**证据。
> **「测试全绿」不等于「被测行为被检查到了」。**

---

## 五、单元测试

`tests/v008-redirect-security.spec.ts`（24 条断言）：

| 组 | 覆盖 |
|---|---|
| `sanitizeRedirect` | 合法路径 / 绝对 URL / 协议相对 / 反斜杠 / CRLF / 非字符串 / 前后空白 |
| `seeOther` | 303 + 相对 Location + `no-store`；内部再净化；**「Location 永不含协议与域名」** |
| `resolvePublicBaseUrl` | 未配置 ⇒ null（fail-closed）/ 优先级 / 子路径 / 拒绝 `javascript:` / 拒绝畸形值 / 空白忽略 / 剔除 URL 凭据 |

---

## 六、回归保证

| 保证 | 机制 |
|---|---|
| 用户回复后仍回到正确主题 | 相对 Location 由浏览器解析 ⇒ 恒为当前 origin + `/t/{id}`；E2E「回复后落地」用例持续通过 |
| 反向代理正常工作 | 相对 Location 不依赖任何代理头 ⇒ 反代、多域名、局域网均自动正确 |
| 不出现 localhost / 127.0.0.1 混用 | Location 不含 host ⇒ **不可能**混用（v0.0.7 的原始缺陷一并消除） |
| 不产生跨域 CSRF Cookie 冲突 | 不跳到别的 host ⇒ 不会产生第二个域的 `v2_csrf` |
| 恶意 Host 不能控制跳转地址 | 攻击矩阵 A2/A3/A7/A11~A13 实测 ⇒ Location 恒为相对路径 |
| 现有 3000 条 E2E 不回归 | 15 分片矩阵持续跑（见交付报告） |

---

## 七、已知限制（如实披露）

| 限制 | 说明 |
|---|---|
| `PUBLIC_BASE_URL` 未配置 ⇒ **不发**重置邮件 | fail-closed 的**预期行为**；运维须配置（`.env.example` 已写明）。生产部署必须设置，否则「忘记密码」功能不可用 |
| 代理若**不剥离**客户端的 `x-forwarded-host`，其他库仍可能受影响 | 本项目已不读该头；但若将来引入依赖转发头的组件，需重新评估 |
| 本报告只覆盖重定向与邮件基址 | 其它攻击面（CSRF、鉴权、注入、限流绕过）不在本轮范围；CSRF 为双提交 Cookie 模式且**不比对 Origin/Host** ⇒ Host 投毒绕不过 CSRF |
| 原站视觉对照仍 UNVERIFIED | 与本审计无关（原站反爬拦截，不绕过） |

---

## 八、结论与授权边界

**结论**：v0.0.7 的重定向实现**存在真实的 Host Header Poisoning 攻击面**
（在直连或代理未剥离转发头的部署形态下可被利用，v0.0.7 的测试未能发现
是因为测试本身在跟随重定向）。v0.0.8 已用**相对 Location**（零攻击面）
与**配置化 + fail-closed 的邮件基址**彻底修复，并用 19 个真实攻击场景
与 24 条单元断言锁定行为。

**本轮未执行**（需主人单独授权）：任何历史改写、force push、
Tag 移动/删除、Release 修改、仓库删除或可见性变更。
