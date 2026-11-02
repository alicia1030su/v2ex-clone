# DESIGN_SYSTEM — 设计系统（源自原站实测）

> 所有数值均从原站 `/assets/24a675cc31e0246e4ab1b09af3608861ace026c1-combo.css` 实测提取，
> 原文件保存在 `docs/evidence/assets/combo.css`（147,710 字节）。
> 提取脚本逻辑见本文件"提取方法"一节。

## 1. 布局骨架

```
body                    min-width:820px
                        font-family: "Helvetica Neue","Luxi Sans","Segoe UI",
                                     "Hiragino Sans GB","Microsoft Yahei",sans-serif,"Apple Logo"
                        background-color:#e2e2e2
                        background-image:url(/static/img/shadow_light.png)
                        background-repeat:repeat-x

#Top                    height:44px; font-size:15px; font-weight:500; text-align:center
                        background-color:#fff
                        border-bottom:1px solid rgba(0,0,0,.22)
                        padding:0 20px
#Top > .content          max-width:1060px

#Wrapper                text-align:center; background-color:#e2e2e2
#Wrapper > .content      max-width:1060px; display:flex

#Leftbar                width:0; float:left
#Rightbar               width:270px; float:right; margin-right:20px
#Main                   width:770px; flex:1 1 770px
```

## 2. CSS 变量（`:root`，实测原值）

```css
--box-background-color: #fff;
--box-background-translucent-color: rgba(255,255,255,0.75);
--box-background-alt-color: #f9f9f9;
--box-background-hover-color: #fafafa;
--box-foreground-color: #000;
--box-border-color: rgba(128,128,128,0.228);
--box-border-hover-color: #c0c0c0;
--box-border-focus-color: #a6a6b0;
--box-border-radius: 3px;
--box-padding: 10px;
--box-font-size: 14px;
--box-line-height: 120%;
--button-background-color: #f0f0f0;
--button-background-hover-color: #f5f5f5;
--button-background-active-color: #e0e0e0;
--button-foreground-color: #666;
--button-foreground-hover-color: #333;
--button-border-color: #ddd;
--button-border-hover-color: #c0c0c0;
--menu-shadow-color: rgba(0,0,0,0.2);
--link-color: #778087;
--link-visited-color: #afb9c1;
--link-hover-color: #4d5256;
--color-foreground: #000;
--color-graphite: #333;
--color-gray: #999;
--color-fade: #ccc;
--color-white: #fff;
--color-blue: #485cc7;
--code-font: 'Consolas','Panic Sans','Bitstream Vera Sans Mono','Menlo','Microsoft Yahei',monospace;
--component-margin: 20px;
```

## 3. 核心组件

### 3.1 `.box`

```css
background-color: var(--box-background-color);
border-radius: var(--box-border-radius);   /* 3px */
box-shadow: 0 2px 3px rgba(0,0,0,.1);
border-bottom: 1px solid var(--box-border-color);
```

### 3.2 `.cell`

```css
padding: 10px;
font-size: 14px;
line-height: 150%;
text-align: left;
border-bottom: 1px solid var(--box-border-color);
```
首尾单元：去掉对应边框并补圆角（`border-*-radius`）。

### 3.3 `.cell-top`

```css
padding: 10px; font-size: 14px; line-height: 120%; text-align: left;
border-top: 1px solid var(--box-border-color);
```

### 3.4 `.cell_ops`

```css
padding: 10px; font-size: 12px; line-height: 120%; text-align: left;
border-bottom: 1px solid var(--box-border-color);
background-color: #f9f9f9;
box-shadow: 0 1px 2px rgba(0,0,0,.05) inset;
```

### 3.5 `.header`

```css
padding: 10px; font-size: 14px; line-height: 120%; text-align: left;
border-bottom: 1px solid var(--box-border-color); font-weight: 500;
```

### 3.6 间隔块

| 类名 | 值 |
|---|---|
| `.sep20` | `height:20px` |
| `.sep10` | `height:10px` |
| `.sep5` | `height:5px` |
| `.sep3` | `height:3px` |

### 3.7 导航 tab

```css
a.tab            { display:inline-block; font-size:14px; line-height:14px;
                   padding:5px 8px; margin-right:5px; border-radius:3px; color:#555 }
a.tab:hover      { background-color:#f5f5f5; color:#000; text-decoration:none }
a.tab_current    { background-color:#334; color:#fff }
a.tab_current:hover { background-color:#445; color:#fff }
```

### 3.8 单元格 tab（用于详情页内部切换）

```css
.cell_tab           { font-size:14px; line-height:30px; border-bottom:3px solid transparent;
                      display:inline-block; margin-right:15px; padding:0 5px 5px; color:#99a }
.cell_tab:hover     { color:#778087; border-bottom-color:#f0f0f0 }
.cell_tab_current   { border-bottom-color:#778087 }
```

### 3.9 主题列表项

```css
.item_title  { font-size:15px; font-weight:500; line-height:130% }
.topic_info  { font-size:12px; color:#999 }
.count_livid { font-size:14px; line-height:120%; color:#999; text-align:right }
```

### 3.10 Logo

```css
#Logo            { width:94px; height:30px;
                   background-image:url(/static/img/v2ex@2x.png);
                   background-size:94px 30px; background-repeat:no-repeat;
                   display:inline-block }
.site-nav #Logo  { width:100px }
```

> 说明：`v2ex@2x.png` 为原站品牌素材，本项目保留**结构与尺寸**但使用本地生成的占位图，
> 不复制原站受保护的图片资源。

## 4. 排版

| 元素 | 原站实测 |
|---|---|
| 正文 `.topic_content` / `.reply_content` | `font-size:15px; line-height:160%` |
| 标题 `h1` | `font-size:22px; font-weight:500; line-height:130%` |
| 节点页 `h2` | `font-size:16px; font-weight:400; line-height:130%` |
| `.markdown_body` | `font-size:15px; line-height:160%; word-wrap:break-word` |
| 元信息 `.topic_info` | `font-size:12px` |
| 楼层号 `.no` | `font-size:12px; color:#999` |
| 时间 `.ago` | `font-size:12px; color:#999` |
| `.cell.section` | `font-size:16px; font-weight:600; background:#f9f9f9` |

## 5. 颜色规范

| 用途 | 色值 |
|---|---|
| 页面背景 | `#e2e2e2` |
| 卡片背景 | `#fff` |
| 卡片次级背景 | `#f9f9f9` |
| 边框 | `rgba(128,128,128,0.228)` |
| 正文 | `#000` |
| 链接 | `#778087` |
| 链接 hover | `#4d5256` |
| 弱化文字 | `#999` |
| 更弱文字 | `#ccc` |
| 强调蓝 | `#485cc7` |
| 当前 tab | `#334` |
| 顶栏分隔线 | `rgba(0,0,0,0.22)` |

## 6. Markdown 正文样式

原站 `.markdown_body` 支持段落、标题、代码块、引用、列表、表格、图片。本项目实现了同等规则：

- `code`：背景 `#f5f5f5`，圆角 3px，内边距 1px 4px，等宽字体 13px
- `pre`：背景 `#f5f5f5`，圆角 3px，内边距 10px，横向滚动
- `blockquote`：左边框 3px `var(--box-border-color)`，背景 `#f9f9f9`，文字 `#999`
- `a`：颜色 `#485cc7`
- `table`：`border-collapse:collapse`，单元格 1px 边框 + 6px 10px 内边距
- `ul/ol`：左内边距 24px

## 7. 提取方法（可复现）

```bash
# 1. 抓取原站首页，提取 CSS 资产路径
./tools/recon/fetch.sh "/" docs/evidence/html/home.html
grep -o -E 'href="/assets/[^"]+\.css[^"]*"' docs/evidence/html/home.html

# 2. 下载组合 CSS
curl -x http://127.0.0.1:10001 -o docs/evidence/assets/combo.css \
  "https://www.v2ex.com/assets/<hash>-combo.css"

# 3. 提取 :root 变量与关键选择器
python - <<'PY'
import re
c = open('docs/evidence/assets/combo.css', encoding='utf-8', errors='replace').read()
for m in re.finditer(r':root\s*\{([^}]*)\}', c):
    for name, value in re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+)', m.group(1)):
        print(name, '=', value.strip())
PY
```

## 8. 与原站的已知视觉差异

| 差异项 | 原因 |
|---|---|
| Logo / 头像 / 节点图标为占位图 | 原站图片为受保护品牌素材，不予复制 |
| 未复制 Google AdSense 广告位 | 广告属于原站商业资源 |
| 未实现 `node-sidebar` Vue 组件的异步加载效果 | 本项目为服务端渲染，等价信息（相关节点）在侧栏同步渲染 |
| 顶部阴影 `shadow_light.png` 使用 CSS 渐变近似 | 原图为受保护图片资源 |
| 底部备案/统计脚本未复刻 | 原站第三方统计代码 |
