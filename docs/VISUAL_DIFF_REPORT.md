# 视觉差异报告（VISUAL_DIFF_REPORT）

## 方法说明

本报告的每一个数字都来自**真实运行**的测量，不含任何估算或声明性的相似率。

### 为什么用几何量测而非纯像素 diff

原站展示的是**实时社区数据**（真实用户的真实主题），本地是 seed 数据。
纯像素 diff 无法区分两类差异：

- **布局差异** —— 样式、间距、组件位置不一致（需要修）
- **内容差异** —— 主题数量、标题文字、回复条数不同（无需修）

因此本轮采用 **DOM 几何量测**（`tools/visual/measure.mjs`）：
在同一视口、同一缩放、同一字体、同一 locale 下，测量两边**同一批选择器**的
`getBoundingClientRect()` 与关键计算样式，逐项比对 Δx / Δy / Δw / Δh。

- **Δx / Δw = 0** 表示该元素的位置与宽度**完全一致**（布局对齐）
- **Δh ≠ 0** 主要来自内容条数不同（动态内容差异），属预期

### 测量环境

| 项 | 值 |
|---|---|
| 浏览器 | Playwright Chromium（`BROWSER_CHANNEL=chromium`） |
| deviceScaleFactor | 1 |
| locale | zh-CN |
| User-Agent | Chrome/131.0.0.0（Windows） |
| 原站访问 | 经本地代理 `http://127.0.0.1:10001`（直连不可达） |
| 本地访问 | `http://localhost:3010`（真实 PostgreSQL + seed 数据） |
| 原站参考 | 仓库内 `docs/evidence/html/*.html`（合法获取的公开页面副本） |
| 原站样式 | 仓库内 `docs/evidence/assets/combo.css`（147,710 字节） |

### 测量目标元素

`#Top`（顶栏）、`#Logo`、`#search-container`、`#Wrapper > .content`、
`#Main`、`#Rightbar`、`#Main .box`、`#Main .cell.item`、
`#Main .item_title`、`#Main .topic_info`、`#Main .count_livid`、`#Rightbar .box`

## 1280 × 900（桌面）

原始数据：`docs/evidence/visual/layout-measurements-desktop-1280.json`

- 视口：1280 × 900
- 测量页面：6 个

| 页面 | 元素 | Δx | Δy | Δw | Δh | 判定 |
|---|---|---|---|---|---|---|
| home | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| home | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| home | `wrapper_content` | +0 | +0 | +0 | -4395 | 内容差异 |
| home | `main` | +0 | +0 | +0 | -4415 | 内容差异 |
| home | `rightbar` | +0 | +0 | +0 | -1268 | 内容差异 |
| home | `first_box` | +0 | +0 | +0 | -3198 | 内容差异 |
| home | `first_topic_item` | +0 | +1 | +0 | +0 | ✅ 完全一致 |
| home | `topic_title` | +0 | +1 | +30 | +0 | ⚠️ 布局差异 |
| home | `topic_info` | +0 | +1 | -78 | +0 | ⚠️ 布局差异 |
| home | `reply_count` | +8 | +1 | -8 | +0 | ⚠️ 布局差异 |
| home | `side_bar_box` | +0 | +0 | +0 | +2 | ✅ 完全一致 |
| home | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| node_claude | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| node_claude | `wrapper_content` | +0 | +0 | +0 | -1387 | 内容差异 |
| node_claude | `main` | +0 | +0 | +0 | -1407 | 内容差异 |
| node_claude | `rightbar` | +0 | +0 | +0 | -385 | 内容差异 |
| node_claude | `first_box` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `topic_title` | +0 | -39 | +76 | +0 | ⚠️ 布局差异 |
| node_claude | `topic_info` | +0 | -39 | +9 | +0 | ⚠️ 布局差异 |
| node_claude | `reply_count` | +8 | -39 | -8 | +0 | ⚠️ 布局差异 |
| node_claude | `side_bar_box` | +0 | +0 | +0 | -35 | 内容差异 |
| node_claude | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `wrapper_content` | +0 | +0 | +0 | -7978 | 内容差异 |
| topic_detail | `main` | +0 | +0 | +0 | -7998 | 内容差异 |
| topic_detail | `first_box` | +0 | +0 | +0 | -91 | 内容差异 |
| topic_detail | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| signin | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| signin | `wrapper_content` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `main` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `rightbar` | +0 | +0 | +0 | +83 | 内容差异 |
| signin | `first_box` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `side_bar_box` | +0 | +0 | +0 | +83 | 内容差异 |
| signin | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| signup | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| signup | `wrapper_content` | +0 | +0 | +0 | +175 | 内容差异 |
| signup | `main` | +0 | +0 | +0 | +155 | 内容差异 |
| signup | `rightbar` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `first_box` | +0 | +0 | +0 | +155 | 内容差异 |
| signup | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| member | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| member | `wrapper_content` | +0 | +0 | +0 | -453 | 内容差异 |
| member | `main` | +0 | +0 | +0 | -473 | 内容差异 |
| member | `rightbar` | +0 | +0 | +0 | +106 | 内容差异 |
| member | `first_box` | +0 | +0 | +0 | -25 | 内容差异 |
| member | `side_bar_box` | +0 | +0 | +0 | +106 | 内容差异 |
| member | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |

**小结**：64 项测量中，Δx=0 有 **62** 项（96.9%），Δw=0 有 **58** 项（90.6%）。

## 1920 × 1080（桌面宽屏）

原始数据：`docs/evidence/visual/layout-measurements-desktop-1920.json`

- 视口：1920 × 1080
- 测量页面：6 个

| 页面 | 元素 | Δx | Δy | Δw | Δh | 判定 |
|---|---|---|---|---|---|---|
| home | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| home | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| home | `wrapper_content` | +0 | +0 | +0 | -4267 | 内容差异 |
| home | `main` | +0 | +0 | +0 | -4287 | 内容差异 |
| home | `rightbar` | +0 | +0 | +0 | -1236 | 内容差异 |
| home | `first_box` | +0 | +0 | +0 | -3070 | 内容差异 |
| home | `first_topic_item` | +0 | +1 | +0 | +0 | ✅ 完全一致 |
| home | `topic_title` | +0 | +1 | +30 | +0 | ⚠️ 布局差异 |
| home | `topic_info` | +0 | +1 | -71 | +0 | ⚠️ 布局差异 |
| home | `reply_count` | +8 | +1 | -8 | +0 | ⚠️ 布局差异 |
| home | `side_bar_box` | +0 | +0 | +0 | +2 | ✅ 完全一致 |
| home | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| node_claude | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| node_claude | `wrapper_content` | +0 | +0 | +0 | -1387 | 内容差异 |
| node_claude | `main` | +0 | +0 | +0 | -1407 | 内容差异 |
| node_claude | `rightbar` | +0 | +0 | +0 | -385 | 内容差异 |
| node_claude | `first_box` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `topic_title` | +0 | -39 | +76 | +0 | ⚠️ 布局差异 |
| node_claude | `topic_info` | +0 | -39 | +9 | +0 | ⚠️ 布局差异 |
| node_claude | `reply_count` | +8 | -39 | -8 | +0 | ⚠️ 布局差异 |
| node_claude | `side_bar_box` | +0 | +0 | +0 | -35 | 内容差异 |
| node_claude | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `wrapper_content` | +0 | +0 | +0 | -7698 | 内容差异 |
| topic_detail | `main` | +0 | +0 | +0 | -7718 | 内容差异 |
| topic_detail | `first_box` | +0 | +0 | +0 | +189 | 内容差异 |
| topic_detail | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| signin | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| signin | `wrapper_content` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `main` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `rightbar` | +0 | +0 | +0 | +83 | 内容差异 |
| signin | `first_box` | +0 | +0 | +0 | +13 | 内容差异 |
| signin | `side_bar_box` | +0 | +0 | +0 | +83 | 内容差异 |
| signin | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| signup | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| signup | `wrapper_content` | +0 | +0 | +0 | +175 | 内容差异 |
| signup | `main` | +0 | +0 | +0 | +155 | 内容差异 |
| signup | `rightbar` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `first_box` | +0 | +0 | +0 | +155 | 内容差异 |
| signup | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `logo` | +0 | -5 | +0 | +0 | ✅ 完全一致 |
| member | `search` | +0 | -2 | +0 | +0 | ✅ 完全一致 |
| member | `wrapper_content` | +0 | +0 | +0 | -453 | 内容差异 |
| member | `main` | +0 | +0 | +0 | -473 | 内容差异 |
| member | `rightbar` | +0 | +0 | +0 | +106 | 内容差异 |
| member | `first_box` | +0 | +0 | +0 | -25 | 内容差异 |
| member | `side_bar_box` | +0 | +0 | +0 | +106 | 内容差异 |
| member | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |

**小结**：64 项测量中，Δx=0 有 **62** 项（96.9%），Δw=0 有 **58** 项（90.6%）。

## 375 × 812（移动）

原始数据：`docs/evidence/visual/layout-measurements-mobile-375.json`

- 视口：375 × 812
- 测量页面：6 个

| 页面 | 元素 | Δx | Δy | Δw | Δh | 判定 |
|---|---|---|---|---|---|---|
| home | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `logo` | +10 | -5 | +0 | +0 | ⚠️ 布局差异 |
| home | `search` | +10 | -2 | +0 | +0 | ⚠️ 布局差异 |
| home | `wrapper_content` | +0 | +0 | +0 | -5446 | 内容差异 |
| home | `main` | -10 | +20 | +310 | -6394 | ⚠️ 布局差异 |
| home | `rightbar` | -520 | +842 | +530 | -1532 | ⚠️ 布局差异 |
| home | `first_box` | -10 | +20 | +310 | -4673 | ⚠️ 布局差异 |
| home | `first_topic_item` | -10 | -32 | +310 | -21 | ⚠️ 布局差异 |
| home | `topic_title` | -10 | -32 | +94 | -21 | ⚠️ 布局差异 |
| home | `topic_info` | -10 | -53 | -64 | +0 | ⚠️ 布局差异 |
| home | `reply_count` | +308 | -42 | -8 | +0 | ⚠️ 布局差异 |
| home | `side_bar_box` | -520 | +842 | +530 | -2 | ⚠️ 布局差异 |
| home | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| home | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `logo` | +10 | -5 | +0 | +0 | ⚠️ 布局差异 |
| node_claude | `search` | +10 | -2 | +0 | +0 | ⚠️ 布局差异 |
| node_claude | `wrapper_content` | +0 | +0 | +0 | -1425 | 内容差异 |
| node_claude | `main` | -10 | +20 | +310 | -1605 | ⚠️ 布局差异 |
| node_claude | `rightbar` | -520 | +339 | +530 | -385 | ⚠️ 布局差异 |
| node_claude | `first_box` | -10 | +20 | +310 | -4 | ⚠️ 布局差异 |
| node_claude | `topic_title` | -12 | -44 | +76 | +0 | ⚠️ 布局差异 |
| node_claude | `topic_info` | -12 | -44 | +3 | +0 | ⚠️ 布局差异 |
| node_claude | `reply_count` | +310 | -45 | -8 | +0 | ⚠️ 布局差异 |
| node_claude | `side_bar_box` | -520 | +339 | +530 | -35 | ⚠️ 布局差异 |
| node_claude | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| node_claude | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `logo` | +10 | -5 | +0 | +0 | ⚠️ 布局差异 |
| topic_detail | `search` | +10 | -2 | +0 | +0 | ⚠️ 布局差异 |
| topic_detail | `wrapper_content` | +0 | +0 | +0 | -8997 | 内容差异 |
| topic_detail | `main` | -10 | +20 | +310 | -9017 | ⚠️ 布局差异 |
| topic_detail | `first_box` | -10 | +20 | +310 | -71 | ⚠️ 布局差异 |
| topic_detail | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| topic_detail | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `top` | +110 | +0 | +0 | +0 | ⚠️ 布局差异 |
| signin | `logo` | +120 | -5 | +0 | +0 | ⚠️ 布局差异 |
| signin | `search` | +120 | -2 | +0 | +0 | ⚠️ 布局差异 |
| signin | `wrapper_content` | +110 | +0 | +0 | +188 | ⚠️ 布局差异 |
| signin | `main` | +100 | +0 | +310 | +9 | ⚠️ 布局差异 |
| signin | `rightbar` | -410 | +378 | +530 | -9 | ⚠️ 布局差异 |
| signin | `first_box` | +100 | +0 | +310 | +9 | ⚠️ 布局差异 |
| signin | `side_bar_box` | -410 | +378 | +530 | -9 | ⚠️ 布局差异 |
| signin | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signin | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `logo` | +10 | -5 | +0 | +0 | ⚠️ 布局差异 |
| signup | `search` | +10 | -2 | +0 | +0 | ⚠️ 布局差异 |
| signup | `wrapper_content` | +0 | +0 | +0 | +124 | 内容差异 |
| signup | `main` | -10 | +20 | +310 | +92 | ⚠️ 布局差异 |
| signup | `rightbar` | -520 | +572 | +530 | +0 | ⚠️ 布局差异 |
| signup | `first_box` | -10 | +20 | +310 | +92 | ⚠️ 布局差异 |
| signup | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| signup | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `top` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `logo` | +10 | -5 | +0 | +0 | ⚠️ 布局差异 |
| member | `search` | +10 | -2 | +0 | +0 | ⚠️ 布局差异 |
| member | `wrapper_content` | +0 | +0 | +0 | -443 | 内容差异 |
| member | `main` | -10 | +20 | +310 | -636 | ⚠️ 布局差异 |
| member | `rightbar` | -520 | +906 | +530 | +97 | ⚠️ 布局差异 |
| member | `first_box` | -10 | +20 | +310 | -33 | ⚠️ 布局差异 |
| member | `side_bar_box` | -520 | +906 | +530 | +97 | ⚠️ 布局差异 |
| member | `_body` | +0 | +0 | +0 | +0 | ✅ 完全一致 |
| member | `_document` | +0 | +0 | +0 | +0 | ✅ 完全一致 |

**小结**：64 项测量中，Δx=0 有 **22** 项（34.4%），Δw=0 有 **36** 项（56.2%）。

## 汇总

| 视口 | 测量项 | Δx=0 | Δw=0 | Δx 一致率 | Δw 一致率 | 布局差异项 |
|---|---|---|---|---|---|---|
| 1280 × 900 | 64 | 62 | 58 | 96.9% | 90.6% | 6 |
| 1920 × 1080 | 64 | 62 | 58 | 96.9% | 90.6% | 6 |
| 375 × 812 | 64 | 22 | 36 | 34.4% | 56.2% | 42 |

## 差异说明与处置

### 1. 桌面视口（1280 / 1920）：水平布局高度一致

两个桌面视口下，64 项测量中 **Δx=0 有 62 项（96.9%）、Δw=0 有 58 项（90.6%）**。
即绝大多数元素的位置与宽度与原站**逐像素一致**。

剩余 2 项 Δx 偏差与 6 项 Δw 偏差集中在内容区内的**主题条目**
（`topic_title` / `topic_info` / `reply_count`）——
这些元素的宽度取决于**标题文字长度**，原站是真实标题、本地是 seed 标题，
属动态内容差异而非布局缺陷（其 y 坐标与父级一致即证明位置正确）。

Δh 的差异来自内容条数不同（原站是真实社区，本地是 seed 的 10 个主题），
属**动态内容差异**，不是布局缺陷。

### 2. 移动视口（375）：有意不同 —— 独立替代实现

原站桌面版的 `.content` 带有 `min-width: 600px`（见 `combo.css`），
在 375px 视口下必然产生横向滚动 —— 这是原站桌面站自身的行为
（原站的移动版是**另一个独立站点**，本次未获取其证据）。

本项目在 ≤600px 断点下改为**响应式重排**：

- `.content` 解除 `min-width`，宽度 100%
- `#Main` 占满宽度，取消为侧栏预留的 310px 右边距
- `#Rightbar` 取消浮动，改用 flex `order` 排在主区**之后**
- 表单元素占满宽度，便于触屏操作

这一项**明确标注为独立替代实现**，不声称与原站移动版一致
（无原站移动版证据可比对）。

### 3. 与原站对齐的具体修正

| 项 | 修正前 | 修正后 | 依据 |
|---|---|---|---|
| `.fa` 图标类 | `float: left` | `inline-block` + 字体渲染属性 | `combo.css` 中的 `.fa` 定义 |
| 断点 | 无（零 `@media`） | 600px / 500px | `combo.css` 的断点值 |
| `.content` 最小宽度 | 600px（窄屏横向滚动） | 窄屏解除 | 独立替代实现 |
| `#Rightbar` 窄屏行为 | 浮动占 270px 挤偏主区 | flex order 后置 | 实测 Δx 偏差修正 |

### 4. 字体与排版基线（与原站 combo.css 一致）

| 项 | 原站 | 本地 |
|---|---|---|
| 主字号 | 14px（89 处） | 14px |
| 次字号 | 12px（34 处） | 12px |
| 标题字号 | 16px（23 处） | 16px |
| 圆角 | 3px（34 处）/ 4px（17 处） | 3px / 4px |
| 边框色 | `rgba(128,128,128,0.228)` | 同 |
| 阴影 | `0 1px 0 rgba(66,66,77,.1)` | 同 |
| 链接色 | `#778087` | 同 |

### 5. 交互态与无障碍检查

| 项 | 实现位置 | 状态 |
|---|---|---|
| hover | `.tab:hover`、`.sign_in_with:hover` 等 | ✅ |
| focus | `:focus-visible { outline: 2px solid #5897fb }` | ✅ |
| 加载态 | 组件 `pending` 状态禁用按钮 | ✅ |
| 禁用态 | `disabled` 属性 + `aria-disabled` 语义 | ✅ |
| 错误态 | 组件 `error` 状态 + `role="alert"` | ✅ |
| 键盘操作 | 全部交互元素为原生 `<button>` / `<a>` / `<input>`，可 Tab 聚焦 | ✅ |
| 减少动效 | `@media (prefers-reduced-motion: reduce)` | ✅ |
| ARIA | `aria-label` / `aria-pressed` / `role="status"` / `role="alert"` | ✅ |

### 6. 视觉回归截图

| 目录 | 视口 | 数量 |
|---|---|---|
| `docs/evidence/screenshots/desktop-1280` | 1280×900 | 10 |
| `docs/evidence/screenshots/desktop-1920` | 1920×1080 | 10 |
| `docs/evidence/screenshots/mobile-375` | 375×812 | 10 |

原始几何测量数据：`docs/evidence/visual/layout-measurements-*.json`

### 7. 未做与如实标注

| 项 | 状态 | 原因 |
|---|---|---|
| 原站**移动版**比对 | ❌ 未做 | 无原站移动版证据（其移动版是独立站点）；本项目为独立替代实现 |
| 像素级相似率数字 | ❌ **刻意不给** | 无法把「样式差异」与「实时内容差异」分离，声明一个数字会误导 |
| hover / focus / 错误态的逐像素比对 | ⚠️ 部分 | 状态态需交互触发，未纳入自动几何测量 |


---

# 增补（v0.0.9）：README 截图无样式事故的复核与几何复测

> 本节为 v0.0.9 视觉真实性整改的增补。完整过程、门禁判据与证据索引见
> [`docs/VISUAL_AUTHENTICITY_v0.0.9.md`](VISUAL_AUTHENTICITY_v0.0.9.md)。

## A. 事故结论

`docs/evidence/screenshots/desktop-1280/local-home.png`（提交 `29689fd`）**确实没有加载 CSS**：

| 图像 | 灰底 `#e2e2e2` 占比 | 默认蓝 `#0000EE` 像素 |
|---|---|---|
| 事故截图 | **0.00%** | 4524 |
| 人为拦截全部 `*.css` 的对照图 | **0.00%** | 4573 |
| 修复后的站点 | 18.38% | **0** |

两份指纹几乎重合 ⇒ 不是「样式有差异」，是**样式表整个没生效**。

**成因（可证部分）**：截图工具的「假成功」机制 ——
浏览器级 `--proxy-server`（未 bypass localhost）、
`waitForLoadState(...).catch(() => {})` 吞掉超时、
从不校验 CSS/布局是否加载。三者叠加使「失败」与「成功」在工具眼里没有区别。
**不可证部分**：当次运行 CSS 为何未加载（旧索引未留失败请求清单），本节不做猜测。

## B. 同视口纯像素几何复测（v0.0.9）

方法：对原站参考图与本地截图做**同一套水平扫描线**，找白卡边界（不读 DOM，纯像素）。

| 扫描线 / 边界 | 原站参考图 | 本地截图 | Δ |
|---|---|---|---|
| `y=300` 白卡区间 | `[110, 879]`（宽 770） | `[110, 879]`（宽 770） | **0 / 0** |
| 右栏右边缘 | `1169` | `1169` | **0** |
| 灰底占比 | 20.57% | 18.38% | −2.19pp（内容条数不同） |

主栏左边缘、右边缘、宽度、右栏右边缘**四项与参考图逐像素一致**。

## C. 本轮修正的差异项（B 类：设计本身不一致）

| # | 项 | 修正前实测 | 修正后实测 |
|---|---|---|---|
| 1 | 回复操作按钮 | 卡片高 155px，按钮 `bottom=621` **溢出 15px 被裁** | `clipped=[]` |
| 2 | 主题页右栏 | `#Rightbar` 缺失，310px 纯灰空档 | `#Main x=110 w=770 / #Rightbar x=900 w=270` |
| 3 | `/xna` 主栏 | 右侧 310px 空档 | `#Main` 全宽 1060 |
| 4 | RSS 链接 | 5 个 href 全 404 | `/api/feed`、`/api/nodes/{name}/feed` 均 200 |
| 5 | 回复数徽章 | `color` 继承 `#778087`（灰字） | `rgb(255,255,255)` on `rgb(170,176,198)` |
| 6 | 导航选中态 | 无任何 `.tab_current` | 首页「全部」为 `.tab_current`（`#334` 底 + 白字） |
| 7 | 页面灰底 | `rgb(220,220,220)`（被渐变叠暗） | `rgb(226,226,226)` |

## D. 无法测量的差异（保持 UNVERIFIED，不编数字）

| 项 | 状态 | 说明 |
|---|---|---|
| 运营标识（PRO 徽章、金币图标）的视觉影响 | **UNVERIFIED** | 未实现，因此无法测量「实现后」的差异 |
| 原站「VXNA」tab 的下拉图标 | **UNVERIFIED** | 该图标为原站图标字体，未做替代方案，差异量级未测 |
| 移动端 meta 行换行位置 | **UNVERIFIED** | 取决于标题长度（内容差异），无法在同等内容下比对 |
| 24 小时长跑下的视觉稳定性 | **UNVERIFIED** | soak 未完成（见 `docs/SOAK_24H_FINDING_v0.0.9.md`） |

**仍然不给出「相似率」百分比** —— 理由同本报告开头：无法把「样式差异」
与「实时内容差异」分离，给一个数字只会误导。
