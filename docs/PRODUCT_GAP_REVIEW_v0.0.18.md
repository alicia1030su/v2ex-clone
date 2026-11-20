# v0.0.18 产品差距审查：页面 / 功能 / API / 权限 / 视觉

> 分支：`feat/v0.0.18-governance`
> 基线：`73b83061b3e36c81963fb8f0edee20673f019099`
> 日期：2026-11-20
> 方法：当前源码枚举 + 权威矩阵交叉核对 + 关键守卫抽样。**不信任旧快照，也不把静态枚举冒充运行验证。**

## 一、结论

- 当前源码共有 **27 个页面路由、74 个 API 路由、93 个 HTTP 方法**。旧路线图写的 72 个 API 已过时。
- **未发现角色水平越权**：`/admin` 仍由服务端守卫，admin API 使用 `adminGuard` 与权限点。
- 发现一个 **P0 内容可见性缺陷**：软删回复、已删主题下的回复、XNA 软删主题、收藏软删主题，
  以及收藏/投票/感谢/举报对不可见目标的写入校验不一致。本轮按缺陷修复，不扩展新产品功能。
- 主要剩余体验缺口是：通知角标口径、回复锚点、API 文档覆盖、失效视觉参考。
- 搜索入口与搜索分页**不是缺口**：`Wrapper → SiteNav → SearchBox` 已全局挂载；搜索页使用保留 `q` 的 `Pager`。
  这两条审计初判已被源码复核否定，未列入待开发。

## 二、可复跑证据

```bash
node scripts/audit/route-inventory.mjs --format json \
  --out docs/evidence/audit/route-inventory-v0.0.18.json
node scripts/audit/route-inventory.mjs --format markdown \
  --out docs/evidence/audit/route-inventory-v0.0.18.md
node node_modules/vitest/vitest.mjs run \
  --config vitest.static.config.ts tests/static/v018-route-inventory.spec.ts
```

产物：

- `docs/evidence/audit/route-inventory-v0.0.18.json`
- `docs/evidence/audit/route-inventory-v0.0.18.md`

权限列是静态启发式：页面 12 public / 7 public-optional-session / 8 authenticated；
API 37 public / 27 authenticated / 9 admin / 1 mixed。它用于发现漏守卫线索，不替代权限测试。

## 三、已实现，不得重复登记为缺口

| 领域 | 当前事实 | 证据 |
|---|---|---|
| 账号 | 注册、登录、退出、会话、限流、封禁状态均已实现 | `FEATURE_MATRIX.md` §1；`src/app/api/auth/*` |
| 主题/回复 | 发帖、编辑、软删/恢复、投票、感谢、引用、楼层、锁定/置顶均已实现 | `FEATURE_MATRIX.md` §3–4 |
| 通知 | 回复、@提及、系统通知、列表、未读、已读、可见性过滤均已实现 | `src/server/notifications.ts`；`tests/v015-notifications-db.spec.ts` |
| 收藏/关注 | 主题/节点收藏、关注用户、关注流均已实现 | `FEATURE_MATRIX.md` §6–7 |
| 搜索 | 建议、主题/节点/会员搜索均已实现 | `SearchBox.tsx`；`src/app/api/search/*` |
| 积分/后台 | 签到、排行榜、管理员调整、节点/分类/举报/用户管理均已实现 | `FEATURE_MATRIX.md` §9–10 |
| Feed/标签 | Atom/JSON Feed、标签写入/移除/检索均已实现 | `FEATURE_MATRIX.md` §2–3 |
| 视觉骨架 | 历史实测几何骨架、六视口无横向溢出、结构探针通过 | `FEATURE_MATRIX.md` §12.1（历史证据，非本轮新截图） |

## 四、差距与优先级

| ID | 优先级 | 差距 | 代码证据 | 影响 | 本轮状态 / 建议 |
|---|---|---|---|---|---|
| G-01 | **P0** | 公共内容软删可见性不一致 | `member/[username]/page.tsx` 最近回复；`xna/page.tsx`；`bookmarks/page.tsx`；`api/collections`、`api/votes`、`api/thanks`、`api/reports` | 公众可读到已删正文/标题；可对不可见目标互动 | **本轮已修复**：统一 `PUBLIC_TOPIC_CONDITION` / `PUBLIC_REPLY_CONDITION`，真库 8/8、完整单元 1056/1056 通过 |
| G-02 | P1 | 通知角标与通知列表口径不同 | `SiteNav.tsx` 直接 `count(notifications)`；列表走 `listNotificationsForUser()` 的可见性 join | hidden 节点/软删主题已过滤，角标仍可能显示未读 | 改为复用 `listNotificationsForUser(..., { limit: 1 })` 的 `unread`，补“列表 0 / 角标 0”真库测试 |
| G-03 | P1 | 回复锚点使用错误标识 | `member/[username]/page.tsx` 用 `#reply${r.id}`；`ReplyItem.tsx` 锚点是 `#reply${floor}`；列表用 `repliesCount` 近似最后楼层 | 删除楼层后深链跳到错误位置或不存在锚点 | 列表返回真实 `lastReplyFloor`；会员页 select `floor`；统一锚点生成函数并加 E2E |
| G-04 | P1 | API 文档覆盖落后于源码 | 74 个 API 路由中大量 admin/auth/settings/reports 端点未在 `API_SPEC.md` 形成逐端点契约 | 集成方只能读源码；权限/错误码难审计 | 从路由清单生成待补清单，按模块补请求/响应/状态码/权限点；动态路由文档匹配需人工复核 |
| G-05 | P2 | `nodes_all` 视觉参考无效 | `FEATURE_MATRIX.md` §12.1 已标 INVALID/UNVERIFIED | 无法证明全部节点页视觉还原 | 取得合法新参考前保持 UNVERIFIED，不裁剪/伪造旧图 |
| G-06 | P2 | 可访问性缺系统化证据 | 现有视觉探针关注布局/资源，不含键盘、焦点、对比度、语义标签完整矩阵 | 无法声称 WCAG/无障碍达标 | 下一轮补键盘走查、焦点顺序、表单标签、对比度与读屏语义测试 |
| G-07 | P3 | 私信未实现 | `FEATURE_MATRIX.md` 未设计；路由与数据模型无对应能力 | 不影响当前论坛核心闭环 | **暂不开发**：产品范围未要求，避免把“V2EX 没有的功能”当复刻缺口 |

### 复核后否定的初判

| 初判 | 复核结论 | 证据 |
|---|---|---|
| 顶栏搜索入口未挂载 | **否定** | `Wrapper.tsx:13` 渲染 `SiteNav`，`SiteNav.tsx:53` 渲染 `SearchBox` |
| 搜索翻页丢失 `q` | **否定** | `go/search/page.tsx` 的 `Pager` 显式传 `query={{ q }}` |
| 移动端 min-width 820 是缺陷 | **暂不认定为缺陷** | `DESIGN_SYSTEM.md` 记录原站骨架；本项目以 SSR 桌面高保真为主，移动端策略需产品裁决 |

## 五、权限审查

抽样结果：

- `/admin` 页面：未登录/非 staff 重定向，未发现仅靠隐藏链接实现权限。
- `/api/admin/ops`：`adminGuard(request, 'ops.view')`，admin-only。
- `/api/admin/config`：`config.view`；用户/节点/举报管理分别使用 `users.write`、`nodes.review`、`reports.handle`。
- 普通用户内容操作：`getSessionUser` + 作者/staff 二次校验。
- 写操作：`guardCsrf` 与社区/用户限流覆盖主要路径。
- **真实缺口属于“内容可见性”而不是“角色提权”**：登录用户可对软删/隐藏目标投票、感谢、收藏或举报，
  错误语义还会暴露目标存在性。已并入 G-01。

建议下一轮增加逐端点权限表自动生成：路由 → 方法 → guard → permission → 负向用例，防止新增端点漏测。

## 六、视觉与体验审查

历史证据支持几何骨架与桌面视觉基线，但本轮**没有重新采集 72 张截图**，因此不宣称新的视觉 PASS。

| 项目 | 状态 | 说明 |
|---|---|---|
| 内容宽 1060 / 主栏 770 / 右栏 270 / 顶栏 44 | 历史已验证 | `FEATURE_MATRIX.md` §12.1 |
| 21 页结构探针、六视口无横向溢出 | 历史已验证 | 同上；本轮代码改动后需 CI/运行复核 |
| `nodes_all` 对照 | **UNVERIFIED** | 参考图实际是单节点页，不能用于全部节点页 |
| 通知角标实时性 | 部分实现 | 服务端首屏正确，但跨页面操作后不自动刷新 |
| 回复深链 | 待修复 | 见 G-03 |
| 空状态/错误态 | 核心页面已有 | 通知、搜索、收藏、会员页均有空态；未做系统化错误注入 |
| 无障碍 | 证据不足 | 见 G-06 |

## 七、后续顺序

1. **v0.0.18 本分支**：完成 G-01 修复与回归；不开发 G-02～G-07。
2. **v0.0.19 建议**：G-02 通知角标 → G-03 回复锚点 → G-04 API 契约补齐。
3. **证据建设**：G-05 合法视觉参考、G-06 可访问性矩阵。
4. **暂不开发**：G-07 私信；如需产品扩张，应另立需求，不计入“复刻差距”。

## 八、边界

- 路由枚举与权限提示是静态事实，不证明运行行为。
- 功能矩阵中的历史测试数字不作为本轮当前结论。
- 本轮不修改 R-01 `DEFERRED`，不发布 v0.0.18，不创建 Tag/Release/GHCR 正式标签。
