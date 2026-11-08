# PAGE_INVENTORY — 页面清单

> 证据来源：通过本机 xray HTTP 代理（`127.0.0.1:10001`）直接抓取 `https://www.v2ex.com` 的服务端渲染 HTML。
> 原始证据保存在 `docs/evidence/html/`，资产保存在 `docs/evidence/assets/`。
> 抓取时间：2026-11-02（北京时间）。

## 1. 站点总体结构

V2EX 主站为**服务端渲染**（SSR）传统论坛页面，主域名 `www.v2ex.com`。
页面骨架固定为：

```
#Top            顶栏（高 44px，含 Logo / 搜索框 / 工具链接）
  .content      max-width:1060px
    .site-nav   flex 布局：#Logo · #search-container · .tools
#Wrapper        背景 #e2e2e2 + shadow_light.png 顶部阴影
  .content      max-width:1060px，flex 布局
    #Leftbar    宽 0（占位）
    #Rightbar   宽 270px，float:right，margin-right:20px
    #Main       宽 770px，flex:1
```

关键 CSS 变量（`combo.css` 的 `:root`）：

| 变量 | 值 |
|---|---|
| `--box-background-color` | `#fff` |
| `--box-background-alt-color` | `#f9f9f9` |
| `--box-border-color` | `rgba(128,128,128,0.228)` |
| `--box-border-radius` | `3px` |
| `--box-font-size` | `14px` |
| `--link-color` | `#778087` |
| `--link-hover-color` | `#4d5256` |
| `--color-blue` | `#485cc7` |

## 2. 页面清单

### 2.1 已抓取并验证的页面

| # | 页面 | 原站 URL | HTTP | 本地实现路径 | 证据文件 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 首页 | `/` | 200 | `/` | `home.html` | ✅ 已实现 |
| 2 | 节点页（技术类） | `/go/tech` | 200 | `/go/[name]` | `node_tech.html` | ✅ 已实现 |
| 3 | 节点页（程序员） | `/go/programmer` | 200 | `/go/[name]` | `node_programmer.html` | ✅ 已实现 |
| 4 | 节点页（创意） | `/go/create` | 200 | `/go/[name]` | `node_create.html` | ✅ 已实现 |
| 5 | 节点页（好玩） | `/go/play` | 200 | `/go/[name]` | `node_ideas.html` | ✅ 已实现 |
| 6 | 节点页（问与答） | `/go/qna` | 200 | `/go/[name]` | `node_qna.html` | ✅ 已实现 |
| 7 | 主题详情 | `/t/1253638` | 200 | `/t/[id]` | `t_1253638.html` | ✅ 已实现 |
| 8 | 最新主题 | `/recent` | 200 | `/?tab=all` | `recent.html` | ✅ 已实现 |
| 9 | 登录 | `/signin` | 200 | `/signin` | `signin.html` | ✅ 已实现 |
| 10 | 注册 | `/signup` | 200 | `/signup` | `signup.html` | ✅ 已实现 |
| 11 | 搜索 | `/go/search?q=node` | 200 | `/go/search?q=` | `go_search_q_node.html` | ✅ 已实现 |
| 12 | 会员主页 | `/member/reoah2` | 200 | `/member/[username]` | `member_reoah2.html` | ✅ 已实现 |
| 13 | 节点分类总览 | `/go/go` | 200 | `/nodes` | `go_go.html` | ✅ 已实现 |
| 14 | 关于 | `/about` | 200 | `/about` | `about.html` | ✅ 已实现（静态说明页） |
| 15 | FAQ | `/faq` | 200 | `/faq` | `faq.html` | ✅ 已实现（静态说明页） |

### 2.2 需要登录的页面（已确认重定向行为）

| 页面 | 原站 URL | 未登录行为 | 本地实现 |
|---|---|---|---|
| 个人设置 | `/settings` | 302 → `/signin?next=%2Fsettings` | ✅ `/settings` |
| 通知 | `/notifications` | 302 → `/signin?next=%2Fnotifications` | ✅ `/notifications` |
| 收藏 | `/bookmarks` | 302 → `/d/bookmarks`（新版） | ✅ `/bookmarks` |
| 发布主题 | `/go/new`（推测） | — | ✅ `/go/new` |

### 2.3 新版路由（`/d/*`）

原站存在两套 URL 体系：`/go/*`（旧版 SSR）与 `/d/*`（新版 SPA 壳，仅 ~6.8KB）。
证据：`d_index.html`、`d_nodes.html` 等仅含 `#Main` 空容器，正文由 JS 渲染。

新版路由清单（抓取到 200）：

| 路径 | 说明 |
|---|---|
| `/d/nodes` | 全部节点（新版） |
| `/d/feed` | 订阅 |
| `/d/index` | 首页（新版） |
| `/d/login` | 登录（新版） |
| `/d/register` | 注册（新版） |
| `/d/explore` | 探索 |
| `/d/topics` | 主题 |
| `/d/bookmarks` | 收藏（新版） |
| `/d/values` | 积分（新版） |

> 本项目实现以**旧版 SSR 路由**为主（内容可被 curl 直接抓取、可被搜索引擎索引，更接近"高保真复刻"目标）。
> 新版 SPA 路由作为 URL 兼容性补充保留在 `docs/PAGE_INVENTORY.md` 记录中。

### 2.4 其他可发现端点

| 端点 | HTTP | 说明 |
|---|---|---|
| `/api/topics/show.json?id=1` | 200 | 旧版 API —— **本项目已实现**，见 `docs/API_SPEC.md` §14.1 |
| `/api/topics/latest.json` | 200 | 最新 35 条 —— **本项目已实现**（§14.2） |
| `/api/members/show.json` | 200 | 会员资料 —— **本项目已实现**（§14.2） |
| `/api/nodes/show.json` | 200 | 节点详情 —— **本项目已实现**（§14.2） |
| `/api/nodes/all.json` | 200 | 全部节点 —— **本项目已实现**（§14.2） |
| `/api/topics.json` | 404 | 已下线 |
| `/api/nodes.json` | 404 | 已下线 |
| `/feed/{node}.xml` | 200 | 节点 Atom 1.0（50 条）—— **本项目已实现原站路径**，见 §14.3；另保留 `/api/nodes/{name}/feed`（RSS 2.0） |
| `/feed/{node}.json` | 200 | 节点 JSON Feed 1.0（50 条）—— **本项目已实现原站路径**，见 §14.3 |
| `/planet/about` | — | Planet 订阅说明 |

## 3. 首页 tab 结构

原站首页顶部导航 tab（实测顺序，11 项 + VXNA）：

| 顺序 | 标签 | 链接 | 本地实现 |
|---|---|---|---|
| 1 | 程序员 | `/go/programmer` | ✅ |
| 2 | 创意 | `/go/create` | ✅ |
| 3 | 好玩 | `/go/play` | ✅ |
| 4 | Apple | `/go/apple` | ✅ |
| 5 | 酷工作 | `/go/jobs` | ✅ |
| 6 | 交易 | `/go/deals` | ✅ |
| 7 | 城市 | `/go/city` | ✅ |
| 8 | 问与答 | `/go/qna` | ✅ |
| 9 | 最热 | `/?tab=hot` | ✅ |
| 10 | 全部 | `/?tab=all` | ✅ |
| 11 | R2 | `/?tab=r2` | ✅ |
| — | VXNA | `/xna` | ⚠️ 占位（外站内容，未复制） |

二级 tab（`#SecondaryTabs`）：程序员 · Python · iDev · Claude · OpenAI · Local LLM · 云计算 · 宽带症候群 — ✅ 已实现

## 4. 分页规则

- **主题列表**：`?p=N`，每页 20 条（实测首页 50 条 `item_title`，分 3 页）
- **主题详情回复**：`?p=N`，每页 20 条回复（实测 `#r_` 锚点数量与分页器 `max` 值一致）
- **节点页**：`?p=N`
- 分页器样式：`page_current`（背景 #f9f9f9 加粗）/ `page_normal`（链接色）

## 5. 关键 DOM 结构

### 5.1 主题列表项

```html
<div class="cell item">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="48" valign="top" align="center"><a href="/member/{u}"><img class="avatar" width="48" data-uid="{id}"></a></td>
      <td width="10"></td>
      <td width="auto" valign="middle">
        <span class="item_title"><a href="/t/{id}#reply{n}" class="topic-link" id="topic-link-{id}">{title}</a></span>
        <div class="sep5"></div>
        <span class="topic_info">
          <div class="votes"><li class="fa fa-chevron-up"></li> &nbsp;{votes} &nbsp;&nbsp; </div>
          <a class="node" href="/go/{node}">{nodeTitle}</a> &nbsp;•&nbsp;
          <strong><a href="/member/{u}">{u}</a></strong> &nbsp;•&nbsp;
          <span title="{ISO time}">{relative}</span> &nbsp;•&nbsp;
          最后回复来自 <strong><a href="/member/{u2}">{u2}</a></strong>
        </span>
      </td>
      <td width="70" align="right" valign="middle"><a href="/t/{id}#reply{n}" class="count_livid">{n}</a></td>
    </tr>
  </table>
</div>
```

### 5.2 主题详情头部

```html
<div class="box" style="border-bottom: 0px;">
  <div class="header">
    <div class="fr"><a href="/member/{u}"><img class="avatar" width="73"></a></div>
    <div class="flex-one-row gap10"><div><a href="/">V2EX</a> <span class="chevron">›</span> <a href="/go/{node}">{node}</a></div></div>
    <div class="sep10"></div>
    <h1>{title}</h1>
    <div id="topic_{id}_votes" class="votes">…</div>
    &nbsp; <small class="gray"><a href="/member/{u}">{u}</a> · <span title="{ISO}">{relative}</span> · {views} 次点击</small>
  </div>
  <div class="cell"><div class="topic_content">{html}</div></div>
</div>
```

### 5.3 回复项

```html
<div id="r_{replyId}" class="cell">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="48" valign="top" align="center"><img class="avatar" alt="{u}" data-uid="{id}"></td>
      <td width="10" valign="top"></td>
      <td width="auto" valign="top" align="left">
        <div class="fr">&nbsp; &nbsp; <span class="no">{floor}</span></div>
        <div class="sep3"></div>
        <strong><a href="/member/{u}" class="dark">{u}</a></strong> &nbsp; <div class="badges"></div>&nbsp; &nbsp;
        <span class="ago" title="{ISO}">{relative}</span>
        [ &nbsp; <span class="small fade"><img src="/static/img/heart_20250818.png" width="14"> {thanks}</span> ]
        <div class="sep5"></div>
        <div class="reply_content">{html}</div>
      </td>
    </tr>
  </table>
</div>
```

### 5.4 相对时间格式（实测）

| 场景 | 格式 | 实例 |
|---|---|---|
| < 1 分钟 | `刚刚` | — |
| < 1 小时 | `N 分钟前` | `5 分钟前` |
| < 1 天 | `N 小时 M 分钟前` / `N 小时前` | `12 小时 42 分钟前` |
| < 30 天 | `N 天 M 小时前` / `N 天前` | `16 分钟前`（不同上下文） |
| ≥ 30 天 | `YYYY-MM-DD` | — |

`title` 属性统一为 `2026-11-02 21:22:40 +08:00` 格式。

## 6. 已知未实现 / 降级项

| 项 | 原因 |
|---|---|
| Google / Solana 登录 | 原站为第三方 OAuth + 钱包签名，无可用测试账号，未实现（UI 以禁用态展示） |
| `edge.v2ex.com` 新版 SPA | 原站新版为独立前端应用，本项目聚焦旧版 SSR 结构 |
| VXNA / R2 tab 内容 | 属于 V2EX 关联社区外站，未复制 |
| 广告位 | 原站含 Google AdSense，本项目不复制广告 |
| 节点真实 logo 图片 | 原站使用 CDN 上的受保护图片资源，本项目使用占位（不复制品牌素材） |
| 会员主页「被回应主题」/ V2EX 等级 | 原站数值由服务端真实计算，本项目实现基础版本（积分、主题数、回复数） |
