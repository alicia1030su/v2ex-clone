# 跨浏览器 × 跨视口视觉回归报告（v0.0.5）

> 任务书 §九：「建立视觉回归基线，自动发现布局变化」。
>
> 本报告记录 v0.0.5 的**多浏览器 × 多视口实测**结果。
> 与 v0.0.4 的 `docs/VISUAL_DIFF_REPORT.md`（与**原站**的几何量测对比）
> 是**不同维度**：那份比「本项目 vs 原站」，这份比「本项目在各浏览器/视口下是否自洽」。

---

## 一、测试矩阵

### 浏览器（3 种内核）

| 浏览器 | 内核 | 说明 |
|---|---|---|
| **Chromium** | Blink（Chrome / Edge） | 与生产用户占比最高的内核一致 |
| **Firefox** | Gecko | 完全独立的渲染引擎 |
| **WebKit** | WebKit（Safari） | ⚠️ **不等于真实 Safari** |

> ⚠️ **WebKit ≠ 真实 Safari**：
> Playwright 的 WebKit 是 WebKit 的**移植构建**，与 macOS 上 Safari 的
> 版本、渲染细节、系统集成都不同。
> 本报告的 WebKit 结果**不能**直接外推到「真实 Safari 没问题」。
> 真实 Safari 需要在 macOS 上单独验证（本轮**未做**，如实标注）。

### 视口（5 个）

| 视口 | 尺寸 | 设备类型 | deviceScaleFactor |
|---|---|---|---|
| iPhone SE | 375×812 | 移动 | 2 |
| iPhone 12 | 390×844 | 移动 | 2 |
| iPad | 768×1024 | 平板 | 1 |
| 桌面 | 1280×900 | 桌面 | 1 |
| 桌面宽 | 1920×1080 | 桌面宽 | 1 |

**组合数**：3 浏览器 × 5 视口 = **15 个 project**，每个 11 条用例 = **165 条**。

---

## 二、实测结果

| 指标 | 结果 |
|---|---|
| 跨浏览器 × 跨视口用例 | **160 / 160 通过**（4.2m） |
| 全量 E2E（core project） | **194 / 194 通过**（4.4m） |

> 注：跨浏览器套件实际跑出 160 条（部分 project 的某些用例按条件跳过，
> 例如搜索框不存在的视口会 `return`），全部通过。

---

## 三、本轮实测发现并修复的 3 个真实缺陷

这一节是本报告的**核心价值** —— 如果只跑 Chromium × 1280×900，这 3 个缺陷**一个都发现不了**。

### 缺陷 1：`body { min-width: 820px }` 从未被覆盖 ⇒ **移动端响应式重排实际从未生效**

**现象**：3 浏览器 × 375/390/768 视口下**全部**出现横向滚动。

**溢出元素**（实测）：
```
div          right=820  vw=375
div.content  right=800  vw=375
div.site-nav right=790  vw=375
div          right=418  vw=375
form         right=417  vw=375
```

**根因**：`src/app/globals.css` 的 `body { min-width: 820px }` 是**桌面优先**写法，
而原有的 `max-width: 600px` 媒体查询只覆盖了 `.content { min-width: 0 }`
—— **漏掉了 body 自己**。

⇒ body 仍被撑到 820px ⇒ 任何窄于 820px 的视口都横向滚动。

**这意味着 v0.0.4 声称的「移动端响应式重排」实际上从未真正生效** ——
之前的 E2E 只跑 1280×900，从未在窄视口下验证过。

**修法**：
- 新增 `≤900px` 断点：`body { min-width: 0; overflow-x: hidden }`
- 同时覆盖 `#Top > .content { min-width: 0; max-width: 100% }`

### 缺陷 2：响应式重排的断点（600px）与桌面最小宽（820px）**不匹配**

**现象**：768×1024（平板）下主内容区只占 **57%**（438/768）。

**根因**：768 > 600 ⇒ 没触发重排 ⇒ 右侧栏仍占位；
而 768 < 820 ⇒ body 仍被撑。

**修法**：把重排断点从 `600px` 提到 **`820px`**（与 body 桌面最小宽对齐）。

> 为什么原站的 600px 断点不适用：
> **原站的移动版是独立站点**（`m.v2ex.com`），它的断点是为那个独立站点设计的。
> 本项目是**单站响应式**，必须与自己的最小宽对齐。

### 缺陷 3：**WebKit 下所有写操作 403**（CSRF Cookie 被丢弃）

**现象**：WebKit 全部 5 个视口**登录失败**；
Chromium / Firefox 正常。

**实测证据**：
```
DIAG_COOKIE ''            ← 浏览器 JS 里读不到
DIAG_COOKIES_CTX [{"name":"v2_csrf", ..., "secure":true, "sameSite":"None"}]
                      ← 浏览器确实收到了，但**不落地**
DIAG_SIGNIN_BODY 403 {"ok":false,"error":"CSRF 校验失败，请刷新页面后重试"}
```

**根因**：`secure: process.env.NODE_ENV === 'production'`。
`next start`（**任何**部署方式，含本地 HTTP 调试与非 HTTPS 部署）
都会设 `NODE_ENV=production` ⇒ Cookie 带 `Secure`。

- **Chromium / Firefox** 对 `localhost` 的 `Secure` Cookie 有**放宽**（允许 HTTP）⇒ 没暴露
- **WebKit 没有这个放宽** ⇒ HTTP 下**直接拒绝存储** ⇒
  `document.cookie` 为空 ⇒ 登录 / 发帖 / 举报等**所有写操作一律 403**

**修法**：**按请求的实际协议判定**，而不是按环境变量：
```ts
const isHttps =
  request.nextUrl.protocol === 'https:' ||
  (forwardedProto?.split(',')[0]?.trim() === 'https');
```
会话 Cookie（`src/lib/auth.ts`）同步修复。

**⚠️ 安全影响（如实标注）**：HTTP 部署下 Cookie 不带 `Secure` ⇒ 会随明文传输。
这是 HTTP 部署的固有风险（会话 Cookie 同理），
且 `SameSite=Lax` 仍能挡住绝大多数 CSRF。
**生产部署应当在反向代理后用 HTTPS**（此时 `secure=true` 依然生效）。

---

## 四、视觉回归基线（自动发现布局变化）

### 4.1 判据设计

不用「像素相似度」—— 那样只能发现「长得不一样」，
无法区分「布局坏了」与「内容不同」。

本轮用的判据是**可断言的几何量测**：

| 判据 | 含义 | 失败含义 |
|---|---|---|
| `scrollWidth - clientWidth ≤ 1` | 无横向滚动 | 布局撑破视口 |
| 主区宽度 ≥ 600px（桌面视口） | 内容可读 | 主区被压成窄条 |
| 主区占满视口（窄视口，≤820px） | 响应式重排生效 | 重排没触发 |
| `#Top` / `#search` 可见可点 | 导航可用 | 导航被隐藏或遮挡 |

### 4.2 基线快照

`e2e/v005-cross-browser.spec.ts` 本身就是**基线**：
每个浏览器 × 视口组合都必须满足上述判据，
任何一条不满足 ⇒ CI 立刻红。

**运行方式**：
```bash
# 专项验证（展开成 15 个 project）
E2E_CROSS=1 npx playwright test e2e/v005-cross-browser.spec.ts

# CI 默认只跑 core（Chromium × 1280×900），避免用例数爆炸
npx playwright test
```

### 4.3 为什么 CI 默认不跑全套 15 个 project

用例数会从 194 涨到 ~2000，CI 时间与不稳定性都会失控。

**取舍**：
- **CI**：跑 `core`（Chromium × 1280×900）+ 全部功能用例 —— 守住回归
- **专项验证**：`E2E_CROSS=1` 展开 15 个 project —— 守住跨浏览器 / 跨视口
- 本轮的 3 个缺陷就是专项验证抓到的 —— 它们**从未**影响过 CI 的绿灯

---

## 五、本轮覆盖的移动端专项检查

| 项 | 覆盖方式 | 结果 |
|---|---|---|
| **横向溢出** | `scrollWidth vs clientWidth` + 定位溢出元素 | ✅ 修复后全部通过 |
| **导航** | `#Top` 可见、Logo 链接可点、搜索框可见 | ✅ |
| **内容布局** | 主区宽度判据（桌面 ≥600px / 窄视口占满） | ✅ 修复断点后通过 |
| **长文本** | 超长标题（30×「超长标题」）+ 超长正文（500×「超长正文」） | ✅ 不撑破布局 |
| **弹窗** | 头像裁剪器模态在 375px 下完整可见 | ✅ |
| **表单** | 登录表单输入框可点可输入、提交按钮可见 | ✅ |
| **图片** | 头像不溢出容器 | ✅ |
| **触屏交互** | `hasTouch: true` 下 `click()` 等价于 tap | ✅ |

---

## 六、已知限制（如实标注）

1. **WebKit ≠ 真实 Safari** ——
   本轮验证的是 Playwright 的 WebKit 移植版。
   真实 Safari（macOS）**未验证**。

2. **没有像素级截图基线** ——
   本轮建立的是**几何判据**基线（无溢出 / 宽度合理 / 元素可见可点），
   不是「截图与基线逐像素比对」。
   后者需要维护二进制基线文件，且对内容差异极其敏感 ——
   本项目的数据是动态的（真实社区数据），逐像素比对会持续误报。

3. **移动端只覆盖 375 / 390 两个宽度** ——
   未覆盖 320px（iPhone SE 1 代）等更窄设备。

4. **未做横屏（landscape）验证** ——
   视口都是竖屏。

5. **只覆盖 Chromium / Firefox / WebKit 三个引擎** ——
   未覆盖 Edge（虽然生产用户里有相当比例，且 Chromium 内核与 Chromium 一致）、
   Safari on iOS（同 WebKit 内核）。

---

## 七、复现方式

```bash
# 1. 启动测试 PG + 构建 + 启动应用（同一次调用内 —— PG 会被工具回收进程树）
bash tests/helpers/start-test-pg.sh start
npx next build && npx next start -p 3010

# 2. 跑跨浏览器 × 跨视口（15 个 project）
E2E_CROSS=1 BROWSER_CHANNEL=chromium \
  npx playwright test e2e/v005-cross-browser.spec.ts --reporter=list

# 3. 列出所有 project
E2E_CROSS=1 npx playwright test --list
```
