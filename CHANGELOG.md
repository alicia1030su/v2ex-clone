# 更新日志
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 版本号从 `0.0.1` 起，采用 `0.MINOR.PATCH` 形式：
> `0.0.x` 全部为**早期开发预览版**，不承诺 API 稳定性，不建议用于生产环境。

本文件只记录**本项目实际做过的事**。凡是未实现的功能，一律列在「不包含」小节，
不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

## [Unreleased] — v0.0.15（发行候选；已获本版公开发布授权）

> **上一已公开版本**：`v0.0.14`（Pre-release，2026-11-09）。
> **本版本**：`v0.0.15`，版本载体已固定为 `0.0.15`；公开发布已获主人对本版本的
> **单独授权**（2026-11-10，决策 A = **A3 保留历史 + 强化披露**、决策 B = **B1 授权发布**，
> 裁决记录见 `docs/RISK_DECISION_v0.0.15.md`）。Tag / Release / GHCR 镜像由本次
> 发布流水线产出。**本段记录的是冻结时的候选状态**；发布结果由发布完成后的
> 独立文档提交回填，**不移动 Tag**。
> **R-01 历史版权风险维持 DEFERRED**：A3 的含义是「保留历史 + 把事实讲清」，
> **不包含**历史改写，也**不构成**素材使用许可。本轮完成 R-01 的 12 项调查与
> 隔离清理演练，**未执行任何远端不可逆操作**，仓库保持 Public。
> 决策材料见 `docs/R01_COMPLIANCE_REVIEW_v0.0.15.md`。

本轮**不扩张新功能**。四条 P0 全部是「把上一版声称做过、但没真做的事做一遍」。

### A. 安全：通知收件箱在节点隐藏后仍显示原主题标题（跨用户泄露）

通知的 `message` 是**写入时**拼好的字符串，里面嵌了主题标题：

    `${actor} 回复了你的主题：${topic.title}`

而 `GET /api/notifications` 与 `/notifications` 页面**完全不 join topics / nodes**。
于是节点被 `hidden`、或主题被软删除之后：公共页面已 404（v0.0.14 已修），
**通知收件箱却照常返回那条标题**。

「提及通知」的收件人是**任意被 @ 的第三方**，不是主题作者 ——
这不是「作者本来就知道」能解释掉的，而是真实的跨用户泄露。

修法：新增 `src/server/notifications.ts`，把可见性判据收敛到
`visibleNotificationCondition()` 一处；`list / total / unread` **必须**走同一个
带 join 的基座（`total` 与 `unread` 用 `count(*) FILTER` 一次算出），
从结构上杜绝「列表过滤了、总数没过滤」的分页错位。

**附带修掉一个我自己的回归**：`action=accept` 处理举报时会先**软删被举报主题**，
再写 `type='system'` 的通知 —— 那条通知的 `topicId` 指向刚被删的主题，
被「只判断主题可见性」的判据一起过滤 ⇒ **举报人永远收不到处理结果**。
已在判据中显式放行 `system` 类型，并补真库用例钉死。

### B. 测试可信度：通知的**真实双用户**验收（此前从未做过）

v0.0.14 发布后独立验收留了一条 WARN：「通知写入路径未在本环境自动化」。
本轮补齐，全部真实浏览器 + 真实数据库，**不使用模拟接口**：

| 事件 | 产品是否设计 | 覆盖方式 |
|---|---|---|
| 回复通知 | ✅ | E2E + 真库 |
| @ 提及 | ✅ | E2E + 真库 |
| 感谢回复（`topic_thanks`） | ✅ | E2E（含重复感谢幂等） |
| 系统通知（举报处理结果） | ✅ | E2E + 真库（含「带 topicId 且主题已删」） |
| 收藏 | ❌ **不适用** —— `/api/collections` 从不写通知 | 断言「确实不产生」（**不凭空新增**） |
| 节点感谢（`node_thanks`） | ❌ **不适用** —— 枚举有，全仓零写入点 | 断言「从未出现」（**不凭空新增**） |

另覆盖：未读数 / 单条已读 / 全部已读 / 刷新后保留 / 多用户真并发（`Promise.all`）/
删除内容后的通知 / 隐藏节点不泄露 / 封禁后退登录。

### C. 验证口径：长期稳定性「24 小时」的说法是错的

`soak-test.yml` 与 `verify-soak.sh` 原文写着
「⇒『24 小时』指应用**实际持续运行** 24 小时」。**这句话不成立**：

分段链的每一段都会 ① `docker run` 一个全新 PostgreSQL 容器、
② 重新 `npm run build`、③ 起一个全新 `next start` 进程、④ 段末销毁数据库。
段与段之间**不共享实例、不共享数据库**，只通过 artifact 传累计计数。

⇒ 24 小时「累计」的真实含义是「**5 个互不相同的实例各跑约 5 小时**」，
**不是**「同一个实例连续运行 24 小时」。两者证明力不同：
累计值证明不了「单实例长期运行不劣化」。

修正：新增 `MAX_SEGMENT_SECONDS`（单段最长 = 单实例最长连续观测）、
`SEGMENTS_TOTAL`（实例重建次数）、`LONGEST_MEM_MB`、`MAX_CONN_USED`；
汇总环节**必须同时报告两个口径**，且缺这些字段时**判红**
（防止用旧 artifact 冒充新口径的结论）。

**如实结论**：24 小时**仍未完成**。GitHub-hosted runner 无法提供单实例连续 24 小时的
运行环境；本轮完成的是「口径修正 + 可执行部分」，不虚构成功。

### D. 发布工程：内置发布预演，不推 Tag 也能演练整条链路

新增 `.github/workflows/release-dryrun.yml`：6 个 job，权限只有 `contents: read`
—— **从权限上就不可能**建 Tag / 推镜像 / 建 Release。

配套 `scripts/release/preflight-dryrun.mjs`（`--mode=static` 21 项 / `--mode=notes` 16 项）
与 `scripts/release/release-decision.mjs`（发布路径判定）。覆盖：

- 版本解析（空 / `0.0.15` / `v0.0` / `v0.0.15.1` / `vv0.0.15` / `v0.0.15-rc1` 全部拒绝）
- Tag 白名单（含目标版本 / 禁通配 / 严格递增无重复）
- checkout 与文件依赖（`publish-release` 必须有 checkout，且**必须**排在
  `download-artifact` 之前 —— checkout 默认 `clean: true` 会 `git clean -ffdx`，
  先下 artifact 再 checkout 会把 `release-assets/` 静默清空）
- CHANGELOG 读取与段落抽取（精确版本 token，禁止 `v0.0.1` 命中 `v0.0.13`）
- Release Notes 渲染（无残留占位符 / 无内部状态措辞 / R-01 披露在场）
- Artifact 校验（篡改 `VERSION` → 判红；降级 `.sh` 权限 → 判红，
  且断言失败原因**只**是该项）
- **Tag 存在与不存在两种情形**：`create` / `resume` / `refuse` / `inconsistent`
  四态决策表，纯函数穷举 + 真实仓库数据验证
  （`v0.0.14 ⇒ refuse`、`v0.0.10 / v0.0.11 ⇒ resume`、`v0.0.15 ⇒ create`）
- Draft 与正式发布、失败后的幂等恢复（`resume` 路径即 v0.0.14 首次发布中断的真实场景）
- 失败必须传播：汇总 job 逐项核对 `needs.*.result`，非 success 即 `exit 1`

**每一项正向判据都当场做一次注入式负向对照**（临时破坏 → 必须判红 → 恢复）。

### E. 文档真实性：README 不再暗示「整个 Git 历史都没复制过第三方材料」

原顶部写「**未复制**原站的私有源码、商标素材、用户数据或社区内容」
+ 「仓库内所有代码、文档与数据均为本项目独立编写 / 采集」——
单看是立场，合起来会被读成「整个 Git 历史从未包含第三方材料」，**而那不是事实**。

改为四层分层陈述（当前树 / 当前发行物 / 早期历史 / 今日可达性），
并显式声明「不表示整个 Git 历史从未包含」「技术清理 ≠ 版权授权」。

### F. R-01 历史合规：12 项调查 + 隔离清理演练（**未执行任何清理**）

最重要的一处口径修正：历史报告里的「81 个」是**证据文件总数**，
不是**第三方素材数**。第三方素材为 **68**（差 13 = 本站自有 `local-*.png` 10 +
测量 JSON 3）。**可达性判定只能用 68 那个口径** —— 混用会把风险面虚报成 100%
（本轮审计脚本第一版确实得出过该假结论，已修正并写进文档）。

实测结论：

| 项 | 结果 |
|---|---|
| 让素材可达的分支 | **6 / 39**（全部 `history-only`） |
| 让素材可达的 Tag | **4 / 9**（`v0.0.1`~`v0.0.4`） |
| 让素材可达的 PR ref | **8 / 53**（`refs/pull/1..8/head`，**GitHub 不删、仓库方无法删除**） |
| 匿名取回（完整 SHA） | `raw.githubusercontent.com/<SHA>/docs/evidence/assets/combo.js` → **200** |
| 匿名取回（Tag 名） | `/v0.0.1/…` → **404** |
| 已发布 ZIP / 镜像 | **均不含素材** |

⇒ **删 Tag 解决不了问题**（完整 SHA 仍可取），必须改写历史。

隔离演练（工作区外，全程无 push）：最小清理口径下第三方素材 **0 残留**，
`local-*.png` 82 个与 JSON 15 个**保留**，**520 个业务文件 blob 逐一未变**。
代价：**9 个 Tag SHA 全变**（其中 6 个已发布）⇒ 与「已发布 Tag 不得移动」直接冲突。

**本轮未执行任何远端不可逆操作**：未改写历史、未 force push、未移动/删除 Tag、
未删 Release、未改可见性、未删用户数据。仓库保持 Public。
三个待裁问题见 `docs/R01_COMPLIANCE_REVIEW_v0.0.15.md` §决策材料。

### G. 已发布 Release Notes 的勘误方案（**只披露，不执行**）

v0.0.14 线上 Notes 的 R-01 表格有一行状态写着「待主人裁决」，
与「已获授权」的事实矛盾（模板写死）。给出三个方案
（单行改 / 追加勘误 / 只披露），**推荐单行改但未执行** ——
修改已发布 Release 需单独授权。详见 `docs/RELEASE_NOTES_ERRATA_v0.0.14.md`。

### 不包含（本版明确没做）

- 新功能。本版只有修复、测试与工程化。
- 24 小时单实例连续运行验证（无可用运行环境，**不虚构**）。
- R-01 的历史清理执行（需单独授权）。
- v0.0.14 Release Notes 的修改（需单独授权）。
- 对「原站对非 active 节点的行为」的任何新宣称。

## [0.0.14] — v0.0.14（2026-11-09 已发布：公开 Pre-release）

> **当前实际公开版本**：`v0.0.14`（Pre-release，2026-11-09）。
> `v0.0.13` 已合并且版本载体固定为 `0.0.13`，但**从未发布**；
> `v0.0.14` 在其之上开发，**包含 v0.0.13 的全部成果**。
> **R-01 历史版权风险维持 DEFERRED**；本版本的公开发布已在完整披露 R-01 的前提下
> 由项目所有者单独授权（一次性、仅限本版本，不构成后续版本先例；
> 授权**不包含**历史改写）。裁决记录见 `docs/RISK_DECISION_v0.0.14.md`。

### A. 安全：隐藏节点跨页面信息泄露（P0-1）

v0.0.13 只把「非 active 节点不可见」收敛到**旧版 API 与 Feed**（7 条路径）。
站内页面与站内 API **一条都没接**，于是同一个 hidden 节点下的主题：

- 在 `/api/topics/show.json` 里看不到；
- 却能通过 `/tag/{name}`、`/go/search`、`/api/search`、`/following`、
  `/bookmarks`、`/member/{username}`、`/t/{id}`（直接输入 URL）读到。

**隐藏只对订阅者生效，对网页访客不生效。**

本轮把站内公共面全部接上 `src/lib/node-visibility.ts` 的同一判据：

- `src/server/queries.ts`：`listTopics` / `listTopicsByNodeIds` / `listHotTopics` /
  `getTopicById` / `getNodeByName` / `getNodeById` / `listNodesByCategory` /
  `listReplies` 全部带条件；新增 `listTopicsByTag`（标签页从页面内联 SQL 收敛过来，
  使其可被真库测试直接调用）
- 14 个直接持 SQL 的文件 + 6 个改为委托收敛查询的页面
- `getTopicById` / `listReplies` 提供**显式** `includeHiddenNode` 审核例外，
  由 `canReviewHiddenNodes(user)` 传入；默认一律公共口径
- 列表与 `count` 使用**同一 where**（否则会出现「列表隐藏了、总数没隐藏」的分页错位）

顺带修掉的真实缺陷：

- `getNodeByName` 原无状态过滤 ⇒ `/go/{hidden}` 能正常打开
- `listReplies` 原不 join topics/nodes ⇒ 回复不依赖主题可见性、可独立泄露
- `node-service.listCategories` 原 `SELECT c.description`（`categories` 表无此列）
  ⇒ 该端点在生产构建下**必然 500**

### B. 安全：标签总量上限未得到完整保证（P0-2）

`normalizeTags()` 只能保证**单次调用** ≤ 5 个；编辑是追加语义，
于是「每次提交 5 个」可以无限累加（5 → 10 → 15 …），`TAG_MAX_PER_TOPIC` 形同虚设。

- `attachTags()` 改为**事务内** `SELECT ... FOR UPDATE` 锁定主题行，
  读已有标签、只补到剩余额度；插入前按名字排序防死锁；
- 返回值改为「库里**最终**生效的标签」，而不是本次输入（额度截断时不会误导前端）；
- 新增 `detachTags()`：只删 `topic_tags` 关联行，不删 `tags` 本体；
- `PUT /api/topics/[id]` 新增 `removeTags` 字段；编辑表单提供标签 chips 移除入口，
  补齐「只能加、不能减」的体验缺陷；
- `editTopic()` 在 title/content 逐字未变时**提前返回**（不写库、不计数、不留快照）——
  否则「只删一个标签」会让按钮变成「编辑 (1)」并在审计表里留下一条什么都没改的记录。
  提前返回位于授权与时限校验**之后**，避免把空改动变成免费的权限探测口；
- **鉴权顺序修正**：原实现把 `attachTags()` 放在 `editTopic()` 之前，
  而 `editTopic()` 是唯一的授权 + 编辑时限校验点 ⇒ 任何登录用户都能用
  `{ "tags": ["x"] }` 给**别人的主题**改标签（正文那条路 403，标签却已落库）。
  现在先鉴权再写标签。

### C. 孤儿页：`/hot` 与 `/recent` 没有站内入口

两个页面早已实现且可用，但全站**没有任何链接指向它们**，只能手输 URL。
入口收敛到 `src/lib/nav-links.ts` 的 `CONTENT_LINKS`（游客与登录用户共用），
位置紧跟「首页」，因为它们是**全局内容视图**而不是用户工具。

### D. 分类管理链路（表与页面齐全、管理链路不通）

`categories` 表从 v0.0.1 起存在，`/nodes` 也按分类分组渲染，
但生产代码**没有任何 insert / update / delete 落点** —— 只能由 seed 写入。
真实部署中管理员无法创建 / 改名 / 排序 / 禁用分类。

- 迁移 `0004_v014_categories.sql`：新增 `hidden`、`updated_at`、`(sort, id)` 索引
  （全部 `IF NOT EXISTS`，纯加法，可原地升级）
- `src/server/categories.ts`：`pg_advisory_xact_lock` 串行化并发创建 + 应用层查重
  （**刻意不加 `name` 唯一索引**：历史数据可能已有重名，加索引会让升级迁移失败）
- `GET/POST /api/admin/categories`、`PATCH /api/admin/categories/[id]`
- 权限拆两个：`categories.view`（moderator + admin）、`categories.manage`（仅 admin）
- 审计四个 action：`category.create` / `category.update` / `category.hide` / `category.show`
- 后台「分类」tab：列表 / 新建 / 改名 / 排序 / 禁用 / 启用
- 公共侧过滤：`queries.listCategories()` 与 `node-service.listCategories()` 均排除
  `hidden = true`

### E. 公共列表 `page` 参数

新增 `src/lib/page-param.ts`：

- 只接受十进制正整数；`'1.5'` / `'Infinity'` / `'-3'` / `'1e3'` / `'0x10'` 一律回退第 1 页
- 超过上限（`MAX_PAGE = 1000`）**钳到上限**而不是回退第 1 页
  （否则用户翻到第 1001 页会莫名回到首页，地址栏与实际内容不一致）
- `clampOffset()` 保证 `OFFSET` 永不溢出成 `1e+21` 这类非法 bigint 文本
- 10 个公共列表页全部接入；`totalPages` 同步钳在 `MAX_PAGE`

### F. 标签编码与特殊字符（实测，不靠框架行为猜测）

- 中文标签的百分号编码路径可命中（`/tag/%E5%89%8D%E7%AB%AF` → 200）
- 字面量 `%`（`/tag/100%25`）返回 **404 而非 500**（`safeDecode` 失败原样返回）
- 畸形编码（`%E4%B8`、`%ZZ`、`%E4%B8%`、`a%zzb`、`%C3%28`）均不抛异常
- 全角拉丁（`ＡＢＣ`）当前被 `normalizeTag` 丢弃 —— 这是**实测行为**，已用测试记录，
  不假装它被归一化成半角

### G. 验证（真实执行）

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 |
| 静态套件 | 20 文件 / 285 用例 |
| 完整单元套件 | 60 文件 / 802 用例 |
| 真库 `v014-node-visibility` | 6/6（active → hidden → active 三态闭环） |
| 真库 `categories-admin` | 22/22（含并发同名 create 只成功一个） |
| 真库 `tags-db` | 25/25（含真 `Promise.all` 并发总量 ≤ 5） |
| `tag-encoding` / `page-param` | 15/15 / 24/24 |
| E2E `v014-*`（本地 CI 等价复现） | 5/5（含 staff 审核视角与公众视角分离） |

### H. 本轮修复过程中被修正的**测试自身**问题（如实记录）

- E2E 「active 时 /nodes 应列出该节点」假红：临时节点未带 `categoryId`，
  而 `/nodes` 按分类分组渲染 —— 无分类节点本就不出现。改为先取真实分类。
- E2E 「hidden 后主题页应 404」假红：用例全程以 admin 身份跑，
  而 staff 审核入口**有意**允许查看隐藏内容。改为先断言 staff 可访问，
  退出登录后再断言公众 404。
- 静态护栏被注释误伤 / 被 `import` 满足（「名字出现 ≠ 真的被调用」）：
  统一改为剥注释 + 匹配调用形态，并逐条做负向对照。

## [Unreleased] — v0.0.13（从未发布 —— 成果由 v0.0.14 一次性包含）

> ⚠️ **本段落保持原样，不改写历史**：v0.0.13 的代码与版本载体都已完成，
> 但**从未打 Tag、从未发布 Release、从未推送镜像**。
> 其全部成果已由 `v0.0.14` 一次性包含并发布（见本节上方的 v0.0.14 段落）。
> 下面的「当前实际公开版本 / 当前开发版本」等描述是**当时的状态记录**，
> 不是此刻的事实。
> **R-01 历史版权风险维持 DEFERRED**；v0.0.9 / v0.0.10 的一次性风险接受
> **不自动构成本版本的新授权**。正式公开发布须主人单独授权。
> 本段落由**实际提交与验证结果**生成，不复用旧模板；逐项证据见
> `docs/SESSION_HANDOFF_v0.0.13.md` 与 `docs/LEGACY_API_MATRIX_v0.0.13.md`。

### A. 旧版 API 兼容收口（本轮最重要的开发任务）

上一轮已完成并**保留**，本轮不重复实现：
`/api/topics/show.json`、`latest.json`、`/api/members/show.json`、
`/api/nodes/show.json`、`all.json`、`/feed/{node}.xml`、`/feed/{node}.json`。

2026-11-09 复核发现上一轮「全量审计」不完整，补齐：

| 端点 | 实测 | 实现 |
|---|---|---|
| `GET /api/topics/hot.json` | 200，10 条，`replies` 严格降序，参数全忽略 | `src/app/api/topics/hot.json/route.ts`（V13-02） |
| `GET /api/replies/show.json` | 200，异常参数一律 `[]`，`page/page_size` 忽略 | `src/app/api/replies/show.json/route.ts` + `src/server/legacy-replies.ts`（V13-03） |
| `GET /api/nodes/list.json` | 裸路径 400；带齐 `fields/sort_by/reverse` ⇒ 200 投影 | `src/app/api/nodes/list.json/route.ts` + `src/lib/legacy-node-list.ts`（V13-04） |

仍确认下线、不实现：`/api/topics.json`、`/api/nodes.json`（再次实测 404）。
完整 15 项兼容矩阵（含「未实测 / 无法验证」披露）见
[`docs/LEGACY_API_MATRIX_v0.0.13.md`](docs/LEGACY_API_MATRIX_v0.0.13.md)。
**不宣称「完全兼容原站」**。

### B. 接口数据一致性与隐私（V13-01）

- 新增共用装配器 `src/server/legacy-assemblers.ts`；8 个旧版端点
  不再各自拼装 `member` / `node`，从结构上杜绝「同一节点 stars 不一致」。
- 修复真实偏差：`nodes/show.json` 此前不限制 `status='active'`，
  而 `nodes/all.json` 限制 ⇒ 同一节点在两接口可见性不同。
- `members/show.json` 只公开 active 用户；封禁 / 停用用户自填资料字段
  在内嵌 member 中被置空；载荷不含邮箱 / 口令哈希 / 令牌 / 积分。
- 软删除主题与回复、已删除主题的回复，一律不进入公共接口。
- `topics/*.json` 与 `replies/show.json` 共用 `parseLegacyId` 与
  `loadNodeStars`；排序均有 `id` 兜底，避免顺序漂移。
- 新增护栏 `tests/static/v013-legacy-privacy.spec.ts`、
  `e2e/v013-legacy-api.spec.ts`（跨接口一致性真实 HTTP 断言）。

### C. Feed 完整兼容（V13-06）

- Atom CDATA 处理 `]]>` 拆分与 XML 1.0 非法控制字符 ⇒ 严格解析器可读。
- 6 类 Feed 路径统一 `ETag`（响应体 SHA-256）+ `If-None-Match` ⇒ 304 空 body。
- 新增真实阅读器验收 `e2e/v013-feed-reader.spec.ts`：浏览器 `DOMParser`
  解析、条目 id 唯一稳定、`#replyN` 锚点、时间格式、UTF-8、节点过滤、
  排序、Markdown 无恶意 HTML、站内链接、UI 订阅链接可点击。
- 文档明确区分 Atom 1.0 / JSON Feed 1.0（原站路径）与
  RSS 2.0 / JSON Feed 1.1（站内路径），见 `docs/API_SPEC.md` §14.5。

### D. 登录与点击稳定性（V13-05）

- 复核 `captchaRequired` 两端一致：生产不传即强制验证码；
  隔离测试环境不渲染也不拉取验证码，服务端校验逻辑未删。
- **`clickUntilRequest` 加三道闸门**：宽请求监听先于首次点击注册、
  观察到写请求不再点、有在途请求 / 按钮 pending 不再点；
  非幂等写操作默认**只点一次**，需显式 `allowWriteRetry` 才允许受闸门约束的重试，
  全丢失时显式抛错。防止「修 flake」反而造成重复发帖 / 重复消费积分。
- 新增负向对照 `tests/static/v010-click-until-request.spec.ts`（12 条）。

### E. 功能矩阵真实性治理

- `docs/FEATURE_MATRIX.md` 改为六类状态（已实现且已验证 / 已实现但未验证 /
  部分实现 / 独立实现 / 确认缺失 / 原站行为无法确认），
  增加「功能→页面→API→权限→DB→测试→状态」对应表与范围声明。
- 旧版测试数字明确标注为历史记录，当前验收引用当前证据。
- 根目录 `FEATURE_MATRIX.md` / `API_SPEC.md` 标为历史快照并指向 docs/ 权威版。
- 新增文档真实性护栏 `tests/static/v013-docs-authenticity.spec.ts`。

### F. 发行文档修复

- README：把「已发布版本」与「在研版本」分开列明，避免版本状态混用；
  修正安装包状态、下载链接与最近发布版本等过时断言；
  镜像标签与安装包版本对齐；测试数字标注为历史实测并指向当前基线。
- CHANGELOG：移除把 v0.0.9 作为 `[Unreleased]` 标题的旧写法，
  v0.0.9 段落改标为已发布历史记录。
- API_SPEC：§14.4 列出新增兼容接口，§14.5 区分 Feed 格式，§14.6 登记一致性与隐私口径。
- **R-01 继续披露**，不因版本推进而消失。

---

## [历史] v0.0.9（已发布 Pre-release，以下为当时记录，非当前状态）

> **版本载体已同步到 0.0.9**（7 个载体复验通过）。
> **R-01 维持 DEFERRED**；主人本轮已明确作出**一次性、仅针对 v0.0.9 发行决定**的风险接受，
> 允许在完整披露 R-01 的前提下创建 v0.0.9 Tag 并以**公开 Pre-release**形态发布。
> 这不是把 R-01 标为 FIXED，不是历史清理授权，也不构成素材版权证明。
> 详见 `docs/RISK_DECISION_v0.0.9.md`。
> **24 小时持续运行未完成**（Run 42362649887 被取消，实际观测 4687 秒）；
> 真实通过的是 1 小时冒烟（run 42384566949，1h1m5s）。详见 `docs/SOAK_24H_FINDING_v0.0.9.md`。
> **本轮未执行**：force push / Tag 移动删除 / 已有 Release 删除覆盖 / 远端历史改写 /
> 仓库可见性变更 / artifact 删除。PR #31 已合并；PR #32 为发布修复 PR。

### v0.0.9：公开部署就绪 —— 候选安装链路、真实升级验证、运维可靠性

#### A. P0 候选离线安装链路（任务书 §二「模式 B」）

v0.0.8 暴露的老问题：部署包默认引用 `ghcr.io/.../v2ex-clone:v0.0.8`，
而 v0.0.8 **没有对应镜像** ⇒ 用户安装必然失败。

本轮实现**两种发行模式**并明确区分：

| 模式 | 含义 | 本轮状态 |
|---|---|---|
| **A 正式在线安装** | 固定 SHA 构建 → 推送 GHCR → 验证 digest → 验证匿名 pull → 发布部署 ZIP → 全新环境下载安装 | ⬜ **需单独授权**（需 GHCR 推送 + 正式 Release + Tag） |
| **B 候选隔离安装** | 固定 SHA 构建 → 导出 image tar → 候选 ZIP + SHA256SUMS → 独立环境 `docker load` → 候选标签跑 Compose → 验证迁移/Redis/健康检查/登录/发帖/回复/重启不丢数据 | ✅ **已实现并在 CI 实跑** |

**新增**：
- `scripts/release/build-candidate.sh` —— 强制校验 `HEAD == --sha` 且工作区干净；
  版本载体未同步即拒绝构建；候选镜像**不推送任何远端仓库**。
- `scripts/release/rewrite-candidate-image.mjs` —— 改写候选包内 4 处镜像引用
  （compose / `.env.example` / `install.sh` / `install.ps1`）为候选标签。
- `scripts/release/verify-candidate-install.sh` —— 独立环境完整安装验证。
- `.github/workflows/candidate-verify.yml` —— ubuntu runner 上**真实执行**全链路。

**关键设计**：候选包内 shell 脚本的换行符强制归一化为 LF
（Windows 上 `core.autocrlf=true` 会产出 CRLF，Linux 用户执行 `install.sh` 直接失败）。

#### B. P0 修复 API 错误率统计失效（任务书 §六）

实测发现 v0.0.8 的 API 埋点存在**两个叠加缺陷**：

1. **模块实例隔离** —— Next.js 把 middleware 编译成独立 webpack bundle，
   与路由处理器**不共享模块实例** ⇒ `observability.ts` 的 `Map` 被求值两次 ⇒
   `api.requests` **恒为 0**。
2. **拿不到真实状态码** —— `NextResponse.next()` 返回的是 middleware 自己的
   响应（恒 200），下游真实响应会**替换**它 ⇒ `byStatus` **恒为 `{200: N}`**，
   连真实的 401/403/404 都不计入。

⇒ 「关键接口错误率」在架构上就是**瞎的**，不满足任务书 §六。

**修复**（三处**必须同时存在**）：
- `src/lib/observability.ts` —— 状态挂到 `globalThis`（带版本化存储键）；
- `src/middleware.ts` —— `export const runtime = 'nodejs'`（与路由同进程）；
- `src/instrumentation.ts`（新增）—— Node HTTP 层拦截 `ServerResponse.writeHead`，
  拿**真实** statusCode 与完整耗时。

仅做前两处时 `byStatus` 仍恒为 `{200}` —— 实测确认。

**实测**：`api.requests=13`、`byStatus={'200':4,'401':2,'404':1}`、
`error4xxByRoute` 按路由聚合。

#### C. P0 全新用户安装验收（任务书 §三）

`scripts/release/verify-fresh-install.sh` —— 13 项清单逐条可执行，
**22 项断言全通过**。全新目录 + 显式清空开发机环境变量。

#### D. P0 v0.0.4 → v0.0.9 真实升级验证（任务书 §四）

用**真实发布过的 v0.0.4**（tag `c0e7396`，3 个迁移）为基线 ——
v0.0.5~v0.0.8 均未公开发布，不能用作升级基线。

`scripts/release/generate-upgrade-fixture.mjs` 通过**真实 HTTP 接口**
（而非直接写库）生成 seed 缺失、而升级最易丢失的数据：
通知 / 积分流水 / 感谢 / 投票 / 收藏 / 头像文件。

**实测结果**：数据指纹**逐字节一致**（42 项业务指纹 diff 为空，指纹文件共 49 行）；
schema 变化符合预期（+2 索引 / +1 迁移）；迁移幂等（连跑 3 次仍 4 条）；
v0.0.4 的旧口令哈希在 v0.0.9 **仍可登录**。

#### E. P1 四角色完整 UX 验收（任务书 §五）

`e2e/v009-four-roles-acceptance.spec.ts` —— **12 例全通过**，
每项都用「操作前计数 → 操作 → 操作后计数」验证**真实数据库变化**。

新增 `src/app/api/debug/table-count/route.ts`（仅测试读数）：
复用既有调试鉴权；**只返回行数**；表名走**白名单**（14 张业务表）。

#### F. P1 运维可靠性故障注入（任务书 §六）

`scripts/release/verify-ops-resilience.sh` —— **21 项全通过，0 跳过**。
含数据库断开注入、备份损坏检测（截断 .gz / 空备份 / 被篡改）、真实备份恢复。

#### G. P1 长时间运行（任务书 §七）

任务书禁止「没有实际运行就标注 24 小时完成」，故把长跑实现为
**GitHub Actions 持久运行器**（`soak-test.yml`），并带**时长诚实性门禁**：
实际时长达不到目标 ⇒ job 失败。

`scripts/release/verify-soak.sh` —— 同一脚本在本地（短时）与 CI（长时）都能跑，
**如实报告实际运行时长**与采样次数。

#### H. P0 收紧 .gitignore（凭据泄露风险）

既有规则只覆盖**固定名字**（`.env` / `.env.local` / `.env.test`），
而本轮使用的 `.env.v009` / `.env.e2e009` / `.env.v009upg`
**不匹配任何规则** ⇒ 含真实密钥且会被 `git add -A` 带进仓库。
已改为忽略一切 `.env.*` 并显式放行模板。
**历史核查**：全部 ref 扫描本轮 5 个密钥字面量，**命中数均为 0**。

#### I. R-01 历史合规专项（任务书 §九）

`docs/R01_COMPLIANCE_REVIEW_v0.0.9.md` —— **独立实测**（非照抄旧报告）。
隔离副本清理演练证明：素材可从全部历史移除，且**业务代码逐字节一致**
（405 文件，blob SHA256 不变），清理后 `tsc` 仍通过。

**新发现**：已发布的 4 个 Release ZIP 与 4 个 GHCR 镜像**均不含**受影响素材
⇒ 用户可获得面干净，无需重做。
**但**：4 个已发布 Tag 仍使素材可达；且**改写历史也无法消除已下载/已缓存的内容**。

#### J. CI 实跑暴露并修复的缺陷

| 缺陷 | 发现方式 |
|---|---|
| `build-candidate.sh` 残留 `PYEOF` 行 | CI 实跑（本地 `bash -n` 检不出） |
| `verify-soak.sh` 缺 `--pg-pass` 参数 | CI 实跑 |
| `table-count` 用了未经参数化的 SQL 拼接 | 本仓安全守卫判红 |
| `grep` 正则非法字符范围（`\-/`） | CI 实跑 |
| `soak-test.yml` 未在功能分支注册 | 手动 dispatch 404 |

---

## [Unreleased] — v0.0.8（已合入 master `3dc718c`，尚未发布）

> **版本载体已同步到 0.0.8**（最终 SHA `3dc718c` 固定后一次性同步，7 个载体复验通过）。
> **R-01 未解决 ⇒ 不建 v0.0.8 Tag、不发公开 Release**，只交付候选产物。
> PR #29 已于 2026-11-07 合并（squash），CI 全绿：
> **3060 条跨浏览器用例（15 分片 × 204）全部通过**、19 个 Host 攻击场景全部防御、
> **SMTP 连续 30 次全通过**、63 组合视觉回归零回归。

### v0.0.8：安全加固、稳定性治理、部署可靠性与真实运营能力

#### A. P0 安全加固 —— Host Header Poisoning（任务书 §三）

**审计发现**：v0.0.7 的 `src/lib/redirect-url.ts` 为修复「request.url 按服务器
hostname 重建」而引入的修法，直接采信 `x-forwarded-host` / `host` /
`x-forwarded-proto` 构造**绝对** Location ⇒ 直连或代理未剥离转发头时，
攻击者可控制 303 的**域名与协议**（开放重定向 / 协议降级 / 缓存投毒 /
反代跳错域名）。同类风险还在找回密码邮件链接（`request.url.origin` 回退链）。

**修复**：

1. **303 改用站内相对 Location**（RFC 7231 §7.1.2）—— 浏览器按**实际请求 URL**
   解析 ⇒ host 与协议永远正确，且**不经任何请求头** ⇒ **投毒面为零**；
   反代 / 多域名 / 局域网部署自动正确，localhost 与 127.0.0.1 不可能再混用。
2. **邮件链接 fail-closed** —— 新增 `resolvePublicBaseUrl()`，只信运维配置
   （`PUBLIC_BASE_URL` → `APP_URL`，严格校验协议/主机名/非法字符）；
   未配置 ⇒ **拒绝发信** + 明确错误日志（响应仍统一，枚举防护不受影响）。
3. 删除 `src/lib/redirect-url.ts`。

**证据**：`tools/security/host-attack-matrix.ts` + 专用工作流 ——
**19 个攻击场景**在真实应用上实测（13 个 303 场景 + 4 个密码重置链接投毒 +
2 个 HTML 泄漏）：run `42336954558` **19/19 SAFE，0 VULNERABLE**。
报告：`docs/SECURITY_AUDIT_v0.0.8.md`。

#### B. P0 SMTP 偶发竞态根治（任务书 §四）

**根因**：fake SMTP server 原先跑在 **Playwright worker 进程内** ⇒ 与浏览器协议
处理**共用事件循环** ⇒ worker 繁忙时 SMTP socket 事件被延迟 ⇒ 客户端空闲超时
竞速触发 ⇒ 投递失败 ⇒ 邮件永远不到（v0.0.7 矩阵偶发超时，同一提交重跑即过）。

**修复（确定性就绪 + 事件到达，无 sleep / 无轮询 / 无重试掩盖）**：

- `tests/helpers/fake-smtp-standalone.ts`：**独立进程** server，
  stdout JSON-lines 协议（ready / mail / stopped / error），SIGTERM 优雅退出
  并回报 `openSockets`；
- `e2e/smtp-fixture.ts`：**事件驱动** fixture —— ready 事件后才发请求、
  mail 事件到达才断言（含消费语义防旧邮件重复匹配）、
  stopped 事件校验 `openSockets=0` + `exitCode=0`；进程猝死立即明确失败；
- `e2e/v005-password-reset-flow.spec.ts` 重写：端口契约校验 +
  资源释放断言 + 新增「服务中断后错误可观察」用例；
- `e2e/v008-smtp-stability.spec.ts` + 专用工作流：连续 **30 次**全流程，
  每次记录邮件延迟/耗时/资源状态（默认 testIgnore 排除，避免打乱矩阵 200 条口径）。

**结果**：**30/30 全通过**，邮件延迟 p50=131ms / p95=174ms / max=182ms，
server received=30 / openSockets=0 / exitCode=0。

#### C. P1 运维与部署可靠性（任务书 §六）

- **结构化日志**（`src/lib/observability.ts`）：JSON-lines 输出 ⇒ docker logs /
  journald 直接采集；**脱敏**（password/token/cookie/session/secret/
  authorization/database_url/redis_url/reset_token/api_key 一律 `[redacted]`）。
- **埋点真正生效**（此前是「有工具、无埋点」）：
  - middleware 层统一埋点 ⇒ **全部 API 自动覆盖**（状态码分布 / 4xx / 5xx / 慢请求）；
  - rate-limit 埋点放在唯一的 `rateLimit()` ⇒ 所有限流全覆盖；
  - mailer 投递成功/失败计数（按 purpose 分类）。
- **健康检查**：`/api/health`（存活）、`/api/health/ready`（就绪：DB 必查、
  Redis 配置了才查，200/503，不泄露连接串与错误栈）。
- **运维总览**：`/api/admin/ops`（依赖可用性、磁盘比例、邮件/限流/API 错误率、
  慢请求列表）。
- **备份完整性校验**：`backup.sh` 生成 `.sha256` + gzip 结构校验 + 内容非空校验
  （不过则**删除该备份并失败**）；`restore.sh` **恢复前**三层校验
  （不过则**拒绝恢复**）。
- **运维体检脚本**（`deploy/health-check.sh`）：容器状态/健康、就绪探针、
  PG 与 Redis 可用性、磁盘使用率（阈值 85%）、备份存在性与完整性、
  备份新鲜度（阈值 7 天）；不打印任何口令。
- **容器健康检查**改探 `/api/health/ready` ⇒ 数据库瞬时抖动不再把容器标记
  unhealthy（避免放大故障）。

#### D. P1 测试环境稳定性（任务书 §五）

`docs/POSTGRES_ENV_REPORT_v0.0.8.md`：
本机 PG 反复 crash recovery 的**量化归因** —— 恢复期**逐文件 fsync ≈ 10 秒**
（41 次日志事件），而同盘普通文件 flush-to-disk 仅 **6~26 ms**；
已排除磁盘空间（770 GB 空闲）、卷健康、杀毒软件、内存
⇒ **环境层劣化，非产品缺陷**。

处置：重型测试全部迁往 **Linux CI 隔离容器**；
新增 `tests/static/` **纯静态测试通道**（不依赖数据库 ⇒ 本机 PG 不稳也不误报）。
**未**清空 data 目录、**未**删除业务库、**未**修改现有实例配置、
**未**用 `fsync=off` 绕过（那会削弱数据安全性）。

#### E. P1 视觉回归：基线的时间炸弹（任务书 §八）

**对照实验**：master（未改任何 UI）跑视觉回归**逐字节相同地失败**
⇒ 与本轮改动无关。

**根因**：相对时间文案在 **Server Component** 里用 **Node 时钟**渲染 ⇒
同一份种子数据在不同时刻渲染出**不同长度**的文本 ⇒ 320px 窄视口换行 ⇒
容器高度变化 120px ⇒ 基线随时间漂移。

**修复**：`APP_NOW` 注入**确定性时钟**（未设置 = 真实时钟 ⇒ 生产行为不变；
非法值 ⇒ 明确错误日志）+ 基线自带 `clockAnchor` + 浏览器时钟同步冻结。
原站对照仍 **UNVERIFIED**（不绕过 Cloudflare 反爬）。

#### F. P1 R-01 历史合规只读复核（任务书 §十）

`docs/R01_COMPLIANCE_REVIEW_v0.0.8.md`：

- 受影响对象**全量登记 81 个**（assets 2 / html 46 / screenshots 20 / visual 13）
  —— 含历史截图与差异热力图，**不止** HTML/CSS/JS；
- 可达性：`master` **已不可达** ✅；仍可达 = **4 个已发布 Tag + 6 个远端分支**；
- **新增区分**：`src/app/globals.css` 与原站 `combo.css` 的**声明块交集 = 0**
  ⇒ 本站样式是**独立实现**，清理**不应**包含它；
- 方案 A 细化（受影响 Tag 由 3 个增至 4 个；filter-repo 只含 4 个 evidence 目录）
  + 回滚方案 + GitHub Support 资料清单。

**本轮未执行**任何历史改写 / force push / Tag 移动或删除 / Release 修改 /
仓库删除 / 可见性变更 —— 仍待主人单独授权。

#### G. CI 纪律：三处「假绿」漏洞（任务书 §九）

1. **汇总退出码无人消费** —— e2e-matrix 的汇总判失败时 job 仍是绿的
   ⇒ 新增独立判定步骤把退出码落地为 job 失败；v2ex-parity-probe 同类问题一并修。
2. **语法错误 tsc 抓不到** —— helpers.ts 的注释块错误让 15 个分片
   「0 个用例被收集」却显示 success ⇒ 新增 `tests/static/` 语法护栏
   （TypeScript `parseDiagnostics`，**不依赖数据库**）。
3. **测试前提未验证** —— 攻击矩阵曾「19/19 SAFE」但 **303 从未发生**
   （Playwright 默认 `maxRedirects: 20` **自动跟随**重定向吞掉 Location 头）
   ⇒ 加 `maxRedirects: 0` + 前置探针（P1/P2）证明被测路径确实执行。

**教训**：**「测试全绿」不等于「被测行为被检查到了」。**

#### H. 测试结果

| 项 | 结果 |
|---|---|
| 跨浏览器矩阵 | **15 分片 × 204 = 3060 条全部通过**（run `42341171720`），零失败 / 零跳过 / 零 not run |
| Host 攻击矩阵 | **19/19 SAFE**，0 VULNERABLE（run `42336954558`） |
| SMTP 稳定性 | **30/30 通过**，p50=131ms / max=182ms |
| 单元测试 | 341 + 24（安全）+ 8（时钟）+ 12（观测）+ 3（静态护栏） |
| 视觉回归 | 63 组合，**回归项 0**（冻结时钟后） |
| Docker / 安装 / 原站探测 | 全绿 |

## [Unreleased] — v0.0.7（已合入 master `535c421`，尚未发布）

> **版本载体已同步到 0.0.7**（最终 SHA `535c421` 固定后一次性同步，7 个载体全部复验通过）。
> **R-01 未解决 ⇒ 不建 v0.0.7 Tag、不发公开 Release**，只交付候选产物。
> PR #27 已于 2026-11-07 合并（squash），CI 全绿：
> **3000 条跨浏览器用例（15 分片 × 200）全部通过**、341+12 条单元测试、
> 63 组合视觉回归、Docker 安装验证、原站探测。

### v0.0.7：跨浏览器稳定性、真实 V2EX 视觉对照、测试可靠性和发行质量完善版

#### A. 820 个失败用例的归因（全部有取证证据）

v0.0.6 的 703 个失败产物批量提取错误类型：1022 处
`apiRequestContext.connect ECONNREFUSED 127.0.0.1:3010` + 368 处
`page.goto: Could not connect to server` ⇒ **主体是「长时间压测后服务器不可达」**。

**Linux 分片矩阵**（15 分片 = 3 浏览器 × 5 视口，每片独立 runner VM / 测试库 /
应用端口 / SMTP 端口 / workers=1 / retries=0 / fail-fast=false）把同一批用例
收敛到 **9 个失败**，并暴露 **1 个真实产品缺陷**。

#### B. 唯一的真实产品缺陷（V7-05，严重）

**303 重定向把用户带到错误的 host。**
`new URL(redirect, request.url)` —— Next 在 `next start` 下按**服务器自身 hostname**
（默认 localhost）重建 `request.url`，而非客户端实际请求的 Host 头。

取证（逐步 nav-diag）：baseURL 与注册后 URL 都是 `127.0.0.1`（正确），
提交原生表单（`POST /api/replies`）后被 303 到 **`localhost`**。

后果：① 浏览器出现**两个** `v2_csrf` cookie（middleware 按请求 host 各下发一个）；
② 之后任何写操作携带 A 域 token、服务端读到 B 域 ⇒ `verifyCsrf` 失败
⇒ **403「CSRF 校验失败」**；③ **反代 / 多域名 / 局域网部署下用户被重定向到
打不开的 host**。

修法：新增 `src/lib/redirect-url.ts` —— `buildRedirectUrl(request, path)` 用请求头
构造同源 URL（`x-forwarded-host` 优先于 `host`，`x-forwarded-proto` 决定协议；
Host 缺失回退 `request.url`；协议相对 URL 显式拦为 `/`），replies 路由改用它。
12 条单元测试锁住行为。

#### C. 另外 4 项测试基础设施缺陷（V7-01 ~ V7-04）

| ID | 现象 | 根因 | 修法 |
|---|---|---|---|
| V7-01 | 矩阵把 200/200 全过判成失败（13 分片全红） | Playwright JSON 的 `test.status` 是**期望状态**、`result.status` 才是实际结果 | 按 `result.status` 判定 + **与原生 `stats` 交叉核对**（不一致即 exit 3） |
| V7-02 | Firefox 全视口稳定 403 | 浏览器有两个 `v2_csrf` cookie，`cookies.find()` 取错域那个 | 按**当前 URL 的 host** 精确匹配 domain，失败时退回 `document.cookie` |
| V7-03 | 楼层计数差 1 | `page.waitForURL` 在 URL 已匹配时**立即返回**（实测 1ms） | 轮询等待「楼层数确实 +1」这个真实终态，断言一条不少 |
| V7-04 | 导航被应用自身导航打断 | 删除后 `router.refresh()` 的迟到 RSC（notFound）触发同 URL 导航 | 新增 `gotoResilient` helper（被 "interrupted by another navigation" 打断时重试） |

#### D. 原站对照：查清了为什么不可达

| 环境 | 网络层 | 内容层 |
|---|---|---|
| 开发机 Windows | DNS 正常（128.121.146.109），**TCP/TLS 直连与代理路径均超时** ⇒ 网络层阻断 | — |
| GitHub Actions Linux | **DNS/TCP/TLS 全部正常** | 原站对自动化访问返回 **HTTP 403 + Cloudflare 挑战页**（"Just a moment..."） |

按合规要求**不绕过**访问控制 ⇒ 原站对照维持 **UNVERIFIED**。
探测脚本已能识别挑战页并标记 `blocked: 'anti-bot'`，不再把错误页当成有效对照
（此前会把挑战页的 22 项测量当作原站数据）。

#### E. 发行质量

- **版本载体同步自动化**（`scripts/release/sync-version.mjs`）：7 个载体
  （package.json / deploy/VERSION / .env.example / install.sh / install.ps1 /
  docker-compose.yml / README.md）+ 脏树保护 + 写后复验 + 三模式
  （同步 / --verify / --dry-run）
- **Windows EPERM 补丁审计**（`next-build-retry.cjs`）：8 项要求逐条核对通过，
  并修正「重试耗尽时在 setTimeout 里 throw ⇒ 未捕获异常」

## [Unreleased] — v0.0.6（已合入 master `657f849`，尚未发布）

> ⚠️ **版本号尚未同步**：`package.json`、`deploy/VERSION` 等版本载体仍为 `0.0.4`。
> 遵循 G-VER-01：最终 SHA 固定 + 发布动作一次性同步。
> **R-01 未解决 ⇒ 不建 v0.0.6 Tag、不发公开 Release**，只交付候选产物
> （`v2ex-clone-v0.0.6-candidate-657f849-deploy.zip`，SHA256 已校验）。
> PR #23 已于 2026-11-06 合并（squash），CI 全绿：341/341 单元 + 200/0 E2E
> + 63 组合视觉回归 + Docker + 安装验证。

### v0.0.6：桌面与移动端高保真视觉、跨浏览器兼容、交互一致性

#### A. 视觉回归实测发现并修复的 9 项真实缺陷

本轮的核心方法论是「**先让工具真跑，再看产品对不对**」——
63 组合（7 视口 × 3 浏览器 × 3 页面）实跑 + 截图人工审查 + dev 模式水合诊断。

| ID | 缺陷 | 发现方式 | 影响 |
|---|---|---|---|
| V5-18 | **React #418 水合失败**（3 个核心页面）—— 布局 table 缺 `<tbody>`，浏览器自动插入导致 React 虚拟 DOM 与实际 DOM 不匹配。**生产模式只报错后自愈 ⇒ E2E 照过 ⇒ 长期静默缺陷** | dev 模式诊断 | 整棵树在客户端重建；交互可靠性受损 |
| V5-19 | **窄屏顶栏覆盖节点头部** —— `#Top` 固定 `height: 45px`，而 ≤500px 时 `.site-nav` 会换行 ⇒ 内容溢出向下覆盖深色横幅 | 320px 截图审查 | 移动端头部信息被遮挡 |
| V5-20 | **窄屏节点头部元素重叠** —— `.title` 单行 flex 布局下三元素挤一行 | 320px 截图审查 | 面包屑与主题数/Feed 图标重叠 |
| V5-21 | **回复楼层信息重复渲染** —— 页面与 `ReplyItem` 各渲染一遍 | 主题页截图审查 | 每条回复出现两遍相同信息 |
| V5-22 | **主题页死投票按钮** —— `href="javascript:"` + 未加载 FontAwesome ⇒ 图标不可见、点击无效 | 代码走查 | 假控件（真实投票在 `TopicActions`） |
| V5-23 | **seed 数据不确定** ⇒ 视觉基线失去意义（两次全新 seed 得到 1 条 vs 4 条回复） | 两次全新库对拍 | 基线对比把「数据变了」误判成「视觉回归」 |
| V5-24 | 静态资源 404（`shadow_light.png` 从未入仓） | 浏览器网络监听 | 每次加载必 2 个 404 |
| V5-25 | 回归工具两类误报（font-family 序列化 + rgba alpha 舍入） | 首轮回归输出分析 | 143 项假异常淹没真信号 |
| V5-26 | **旧视觉基线本身是坏的**（Firefox/WebKit 实测值 = 浏览器默认值 ⇒ CSS 根本没加载） | 基线数据核查 | 任何对比都无意义 |

另有 3 项交互缺陷（导航竞态、节点图标占位缺边距、5 处 U+FFFD 编码损坏）同步修复。

#### B. 视觉回归系统与常驻 CI

- **63 组合**（7 视口 × 3 浏览器 × 3 页面）全部测量成功，**零横向溢出**、**三引擎完全一致**。
- **确定性 seed**：mulberry32 PRNG（固定种子）+ 时间锚点 ⇒ 两次全新库对拍**完全一致**。
- **独立完整视觉工作流**（`.github/workflows/visual-regression.yml`）：
  全新环境、7 视口 × 3 引擎、组件几何 + 截图基线、失败截图与 Trace 上传、
  溢出检测、**三类失败分别报告**（回归失败 / 基线缺失 / 原站不可达）。
- **失败语义修正**：基线不存在、基线缺组合**都判为失败**（此前会静默通过）。
- **14 条行为护栏**（`tests/v006-visual-regression-guards.spec.ts`）。

#### C. Windows EPERM 专项诊断（详见 `docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md`）

- **根因定位**：EPERM 发生在 **Next 的 build worker 子进程**里创建 `.next/trace` 的瞬间
  （默认多 worker 8/8 EPERM；单进程第 2 轮成功；限并发仍多进程 2/2 EPERM）。
- **最终兜底**：`scripts/ci/next-build-retry.cjs` —— 文件打开失败自动重试
  （只对 EPERM 重试，不掩盖其它错误）。
- 排查过程固化为 4 个可复现脚本，排除了 12 个变量。

#### D. 原站对照的真实状态（如实登记）

- **实测原站不可达**（`https://www.v2ex.com/` → HTTP 000 超时）。
- ⇒ 12 个页面的原站对照**全部标记 UNVERIFIED**；
  本轮完成的是**本站自身**的 63 组合视觉回归与跨浏览器一致性，
  **不构成**与原站视觉一致的结论。

#### E. v0.0.6 测试基线

| 项 | 结果 |
|---|---|
| 单元测试 | **341 passed / 341**（26 文件） |
| E2E（core） | **200 passed / 0 failed**（3.4m） |
| 视觉回归 | **63 组合**全部成功，三引擎一致，零溢出，基线二次运行**回归项 = 0** |

---

## [Unreleased] — v0.0.4 开发分支（尚未发布）

> ⚠️ **版本号尚未同步（主理人裁决，2026-11-04）**：`package.json`、`deploy/VERSION`、
> `README.md`、`FEATURE_MATRIX.md`、`RELEASE_GATE.md`、`TEST_REPORT.md` **仍统一为
> `0.0.3`，本轮刻意不提前升级**。**本文件出现「v0.0.4」只代表开发分支，不代表已发布的版本号。**
>
> 理由：任务书明令「v0.0.4 期间禁止提前创建最终 Tag，同一版本号不得反复删建或移动 Tag」。
> 在**最终 SHA 固定之前**把版本载体升到 `0.0.4`，会造成「版本号已是 0.0.4、却没有
> 对应 Tag 与 Release」的中间态，且一旦后续改动 SHA 又要改版本号 —— 这正是被禁止的
> 「同一版本号反复移动」。
>
> 因此采用：`[Unreleased]` 段落累积变更 → 合并并固定最终 SHA → **一次性**把版本载体、
> Tag、Draft Release 同步到 v0.0.4。此决策由主理人负责，在
> `docs/RELEASE_PROCESS_v0.0.4.md` 中固化为发布门禁（门禁 G-VER-01，第 9 步）。
> 登记见 `RISK_REGISTER.md` **R-20**（已裁决：开发态保持 0.0.3）。
>
> 本小节只记录**本轮实际做过并验证过的事**。

### 零之前、v0.0.5 开发分支的累计变更（2026-11-06 集成收尾更新）

> ⚠️ **本段只是开发分支的累积记录，不代表已发布的版本号。**
> 版本号同步仍遵循上方主理人裁决：最终 SHA 固定时**一次性**同步。

v0.0.5 走的是「**先补功能、再补验证**」的路线，
本轮新增的核心不是「多了几个按钮」，而是**把「已声称完成」的东西真正验证了一遍**。

#### A. 新增能力

| 能力 | 关键产出 |
|---|---|
| **用户端举报全链路** | `POST/GET /api/reports`（含**部分唯一索引**防重复）、`ReportButton`、「我的举报」页、处理时通知举报者、`REPORT_SUBMIT` 审计 |
| **管理员积分调整** | `POST /api/admin/credits`（仅 admin）+ 后台「积分」tab（二次确认 + 理由必填） |
| **头像与图片体验** | 前端 **Canvas 裁剪器**（零依赖：拖动 / 缩放 / 重置 / 预览）+ 服务端 **EXIF 方向校正** + **元数据剥离**（去 GPS）+ `sharp` 提为**直接依赖** |
| **中文搜索（bigram 分词）** | `src/lib/search-tokenize.ts`（**零扩展依赖**）+ **两阶段搜索**（整串快查 → 无结果时 AND 回退）；实测本机 PG **无** `zhparser`/`pg_jieba` ⇒ 必须自研 |
| **@ 提及通知** | `src/lib/mentions.ts` + 回复时写入 `type: 'mention'` 通知 —— 补齐了一个「**UI 一直有、生成逻辑一直没有**」的半成品 |
| **社区动作频率限制** | `src/lib/community-rate-limit.ts`（**用户 + IP 双维度**，阈值可 env 覆盖） |
| **多浏览器 × 多视口 E2E** | `E2E_CROSS=1` 展开 **3 浏览器 × 5 视口 = 15 个 project** |
| **v0.0.5 升级 / 备份恢复验证** | `scripts/release/verify-upgrade-v005.sh` —— **PASS=17 / FAIL=0**（原地升级 + 幂等 + 备份恢复，**全部实跑**）；`docs/UPGRADE_RECOVERY_v0.0.5.md`（含**实跑中发现的 4 个 Windows 专属缺陷**）|
| **v0.0.5 新增路径性能压测** | `scripts/perf/v005-path-benchmark.ts` —— 搜索 / 通知 / 积分三条路径；`docs/PERF_BENCHMARK_v0.0.5.md`（**实测报告**，含「2 字中文查询命中不了 trigram 索引」的发现与决策）|

#### B. 修复的**真实缺陷**（26 项，全部由实测发现，不是代码审查臆测）

| # | 缺陷 | 影响 |
|---|---|---|
| 1 | 软删除后**版主无法在 UI 恢复主题** | 管理动作不可达 |
| 2 | 软删除后 UI 不刷新 | 用户必须手动刷新 |
| 3 | 重复举报返回 **500 而非 409** | 用户看到「网络错误」 |
| 4 | 积分 tab 对**版主**可见（权限做成内容级） | 权限边界无法断言 |
| 5 | **SMTP 超时完全失效** | 邮件发送可无限挂起 |
| 6 | `SMTP_TIMEOUT_MS` 在模块加载时固化 | 超时行为无法测试 |
| 7 | 邮件日志写入**无限挂起** | **数据库故障时「忘记密码」永远不返回** |
| 8 | `src/lib/smtp-client.ts` 是**死代码**（无生产调用方） | 文档失实 + 生产 SMTP 零覆盖 |
| 9 | 删除主题用 `window.location.reload()` 引发**导航竞态** | E2E 间歇失败 |
| 10 | 后台「举报」tab 文本带数量（`举报（3）`），`exact: true` 匹配不到 | 单跑绿 / 全量红 |
| 11 | `AvatarCropper` 的 `onError` 导致**无限重渲染** | 页面卡死 |
| 12 | **生产环境头像上传后立刻 404**（Next 只服务构建时已存在的静态文件） | 头像功能在生产**完全不可用** |
| 13 | Docker compose **没给 `public/uploads` 挂卷** | 重建容器头像全丢 |
| 14 | `start-test-pg.sh` 稳态判定用 UTF-8 字面量匹配 GBK 日志 | **每次启动 PG 死等 300 秒** |
| 15 | **13–32 字符的合法用户名 @ 提及静默失效** | 用户 @ 了但什么也没发生 |
| 16 | `body { min-width: 820px }` 从未被媒体查询覆盖 | **v0.0.4 声称的「移动端响应式重排」实际从未生效** |
| 17 | 响应式断点（600px）与桌面最小宽（820px）不匹配 | 768px 平板下主区只占 57% |
| 18 | **WebKit 在 HTTP 下拒绝存储带 `Secure` 的 Cookie** | 所有写操作 403 |
| 19 | 一个测试 spec 硬编码了本地连接串 | 本地全绿 / CI 直接 ECONNREFUSED |
| 20 | 发帖 / 回复 API 响应**不含结构化 id** | 调用方只能解析 `redirect` 字符串 |
| 21 | 发布门禁**硬编码**目标版本与迁移条数 | v0.0.5 复用时必然 FAIL ×4 |
| 22 | **CI 与 E2E spec 抢 3025 端口**（远端 run `42142762352` E2E job 失败） | fake SMTP server 重复启动 ⇒ EADDRINUSE |
| 23 | **`global-setup` 的 env 覆盖语义与 `env-loader` 相反** ⇒ 令牌不一致 ⇒ **限流静默失效** ⇒ 429 | 报错完全指不到「限流没被清」这个真正原因 |
| 24 | **4 个 Windows 专属缺陷**（临时目录路径 / env 加载器 / psql GBK / schema 列名） | 升级验证脚本在 Windows 上根本跑不起来 —— 静态审查发现不了 |
| 25 | 本地 CI 复现脚本 `SKIP_BUILD` 检查放在 `.next` 清理**之后** | `SKIP_BUILD=1` 必然失败（BUILD_ID 已被移走），与其设计目的相悖 |
| 26 | **Firefox@320×568 横向溢出 23px** —— Firefox 的布局 table 按内容扩展而不收缩（Chromium / WebKit 愿意收缩，**只跑 Chromium 永远发现不了**） | HotTopics 等布局 table 在 320 视口下横向滚动 |

> 完整定位 / 修法 / 验证证据见 `BUG_REGISTER.md` **V5-01 ~ V5-17** 与测试基建 **V5-T1 ~ V5-T7**。

#### C. 安全护栏（把要求变成**可执行的回归测试**）

新增 `tests/v005-security-audit.spec.ts`（**21 条**）——
新增写端点却忘加限流 / 有人删掉某处的 `guardCsrf` ⇒ **测试立刻红**。

#### D. 新增文档

- `docs/FLOOR_NUMBERING_v0.0.5.md` —— 楼层编号规则
- `docs/SEARCH_BENCHMARK_v0.0.5.md` —— **四方案横向实测 + 性能对照报告**
- `docs/CROSS_BROWSER_VISUAL_REPORT_v0.0.5.md` —— 跨浏览器 × 跨视口实测
- `docs/COMMUNITY_FEATURES_EVALUATION_v0.0.5.md` —— **私信等社区能力评估**（含原站实测：**原站没有私信功能**）
- `docs/UPGRADE_RECOVERY_v0.0.5.md` —— **v0.0.5 安装 / 升级 / 恢复验证报告**（**PASS=17 / FAIL=0 全部实跑**；含**实跑中发现的 4 个 Windows 专属缺陷**—— 静态审查永远发现不了这一类问题）
- `docs/PERF_BENCHMARK_v0.0.5.md` —— **v0.0.5 新增路径性能压测报告**（搜索 / 通知 / 积分；含**压测脚本自身的两次返工**记录与「**2 字中文查询命中不了 trigram 索引**」的实测发现）
- `docs/VISUAL_PARITY_v0.0.6.md` —— v0.0.6 视觉对照体系（12 页面清单 + 17 组件级检查项）

#### E. 测试基线（集成收尾时的权威口径）

| 项 | 结果 |
|---|---|
| 单元测试 | **327 passed / 327（25 文件）** |
| E2E（core） | **200 passed / 0 failed** |
| 跨浏览器 × 跨视口 | **160 / 160 通过**（Chromium / Firefox / WebKit × 5 视口） |
| 类型检查 | ✅ `npx tsc --noEmit` |
| 升级验证 | **PASS=17 / FAIL=0** |
| 性能压测（新增路径） | 搜索 P95 **6ms** / 通知 P95 **1ms** / 积分 P95 **1ms** |
| 发布门禁（dev, target=0.0.5） | **PASS=62 / FAIL=0 / BLOCK=1**（BLOCK = R-01 授权） |
| 远端 CI（PR #22，HEAD `5163244`） | CI ✅ / Docker/Redis 隔离验证 ✅ / 安装验证 ✅（含 E2E job 实跑通过） |

#### F. 发布状态（如实登记）

- **版本载体仍为 `0.0.4`** —— 遵循 G-VER-01：最终 SHA 固定 + 发布动作一次性同步。
- **R-01（Git 历史原站素材）仍未解决** ⇒ 按发布门禁，**不创建公开 Release、不创建 v0.0.5 Tag**；
  本分支交付**候选产物**（ZIP 安装包 + SHA256SUMS，标注 candidate），不冒充正式发行版。
- v0.0.6 的组件级视觉回归工具（`tools/visual/regression.mjs`）与 Firefox@320 溢出修复
  已随本分支合入（自包含增量，CI 全绿），作为 v0.0.6 的开发基座。

---

### 零、v0.0.4 交付状态（2026-11-05 更新）

| 项 | 状态 |
|---|---|
| 单元测试 | ✅ **194 passed / 194**（16 个测试文件） |
| E2E | ✅ **154 passed / 0 failed / 0 skipped**（11 个文件，3.9m） |
| 升级脚本自检 | ✅ **87 项断言全 PASS / 0 FAIL** |
| CI 三 job | ✅ 全绿（run `41949555282`，SHA `bddb3d0`） |
| 发布门禁 `--phase=release` | ✅ PASS=78 / **FAIL=0** |
| **Tag `v0.0.4`** | ✅ 已创建（annotated `aed641d` → `c0e7396`，**未移动**） |
| **Draft Release `v0.0.4`** | ✅ **已创建** —— id `434929894`，两个资产齐全，SHA256 校验通过；发布流水线 run `41991745413` **11/11 job 全绿** |
| GHCR 镜像 | ✅ `ghcr.io/alicia1030su/v2ex-clone:v0.0.4` 已推送并拉取成功 |
| 正式发布 | ✅ **已正式发布（Pre-release）** —— `draft=false`，`published_at=2026-11-05T08:34:24Z`，Release id `434929894` |

> 发布流水线自身的修复过程（护栏 3 / 安全扫描两处 / Tag 死锁 / `resolve-tag` /
> `target_commitish` 403）详见 `docs/SESSION_HANDOFF_v0.0.4.md` **第 9、10 轮快照**。

### 一、修复的真实缺陷（**15 项**，均由真实浏览器 E2E / 真实压测 / 版本库核查 / CI 实跑发现）

| ID | 级别 | 缺陷 | 验证方式 |
|---|---|---|---|
| B-01 | 阻断 | `GET /api/nodes` 生产构建必然 500（原生 SQL 用 `FROM nodes n` 起别名，WHERE 仍由 drizzle 生成 `"nodes"."status"` → PG 42P01） | `e2e/v004-api-contract.spec.ts` 端点冒烟 + `e2e/v004-endpoint-smoke.spec.ts` 全 GET 不 5xx |
| B-02 | 阻断 | `GET /api/topics/[id]` 500（条件片段写成普通字符串被 drizzle 绑定成 `$2` 占位符 → PG 42601） | 同上 + `bench-result.json` 主题详情 API 4810 请求无 5xx |
| B-03 | 严重 | 分页参数 `limit`/`offset` 从未从路由透传到服务层 | `v004-api-contract.spec.ts`「分页参数生效」+ `e2e/pagination.spec.ts` |
| B-04 | 严重 | 「编辑主题」是假按钮（服务端组件无法向客户端组件传函数，`onEdit` 永远 undefined） | `v004-content-interaction.spec.ts` 完整 UI 链路：点击→模态框→填值→保存→展示→刷新 |
| B-05 | 严重 | 回复楼层跳号（`allocateFloor` 双重 `+1`；路由 `floor + attempt` 偏移使实际楼层与计数表脱节） | 修复后连发 6 条得 `41..46` 严格连续；`tests/floor-continuity.spec.ts` 断言严格 `1..n` |
| B-06 | 一般 | 注册赠送积分绕开账本（直接写 `balance: 1000`，破坏「余额 == 账本累计」不变式） | 新注册用户 `balance=1000 / ledger_sum=1000 / rows=1`，账本链 `before=0→after=1000→before=1000→after=1002` 首尾相接 |
| B-07 | 一般 | `/hot` 独立页面缺失（v0.0.3 只有首页侧栏） | 新增 `src/app/hot/page.tsx` 与 `src/app/recent/page.tsx`；压测「热门排序」230 请求 0 错误 |
| B-08 | 严重 | 积分排行榜相关子查询 N+1（每作者执行一次，EXPLAIN 实测 **241.98 秒**） | 改「三个独立聚合 + JOIN」→ 0.74 秒；`0002` 索引后 0.46 秒；压测 p50 1.23 秒（并发 10） |
| **B-09** | 严重 | **运行时上传数据被误提交入仓** —— E2E 跑出的 **18 个头像占位 PNG**（每个 684 字节）被 Git 跟踪，进入公开发布物。**风险性质与 R-01 同类**（运行时数据进入公开发布物） | 提交 `49d66d3`：`.gitignore` 加 `public/uploads/` 规则 + `git rm --cached` 移出索引（**不改写历史、不删磁盘文件**）；验证 `git ls-files "public/uploads/*"` → **0 条**。引入提交逐一定位：`04b107b`（16 个）/ `1b15f79`（1 个）/ `301a8a5`（1 个）。登记 `BUG_REGISTER` V4-14 / `RISK_REGISTER` R-25 |
| **B-10** | 严重 | **`docker-verify.yml` 定义级失败** —— 工作流在定义阶段就失败，**一个 job 都没被创建**（run 0 秒结束、`total_count=0`、报错仅「This run likely failed because of a workflow file issue」）。根因：GitHub 表达式上下文**不支持 `&&`/`\|\|` 三元**（`\|\|` 取默认值支持） | 提交 `2532f5f`：三元判断下沉到 shell 层，`${{ }}` 只用于传值。**陷阱**：YAML 本身能正常解析（1 job / 17 steps），问题只在表达式求值阶段 ⇒ 排查耗时。登记 `BUG_REGISTER` V4-15 |
| **B-13** | 严重 | **`docker-verify.yml` 的 app 健康判定口径不可能成立** —— 第 2 项红灯 `✗ app 未达 healthy（none）`。根因：根目录 `docker-compose.yml` 的 **app 服务没有 healthcheck**（只有 `deploy/docker-compose.yml` 才有）⇒ `State.Health.Status` **永远返回 `none`**。⚠️ **CI 日志证明 app 其实完全健康**（`✓ Ready in 414ms`）—— 是断言读错了 | ✅ **已修** —— 改为「**容器状态 + HTTP 探活**」（`State.Status == running` 且 `curl /` 返回 200）；PG/Redis 仍用 health 状态。**HTTP 探活是更强的证据**（证明 Next.js 真在服务请求，而非只是容器活着）。桩程序对照验证通过 |
| **B-14** | 严重 | **`docker-verify.yml` 的 `[7/9]` 安装包实际部署必然失败** —— ① **端口占用**：`install.sh` L163 的硬性端口检查会因根 compose 的 app 容器仍占 3000 而直接 `die`；② **容器名冲突**：新实例与运行中的实例同名 | ✅ **已修** —— 断言与执行上下文分离，并新增断言保证它不会变成外部镜像 |
| **B-12** | 阻断 | **`tests/floor-continuity.spec.ts` 在 CI 上必然崩溃** —— 单元 `unit` job 红灯 ⇒ `e2e` job 被 `needs: unit` 连带跳过 ⇒ 整个 CI 红灯。根因：硬编码 `readFileSync('.env.test')`（该文件被 gitignore，CI 检出里不存在）+ `:55433/` 端口白名单（CI 的 `DATABASE_URL` 是 5432） | ✅ **已修并经 CI 复验** —— 提交 `8ce5ce9`（护栏 3 修复提交 `634a202`）。**修复前的历史观测**：run `41837212170`（HEAD `930f29e`）`Test Files 1 failed \| 14 passed (15)` / `Tests 185 passed \| 5 skipped (190)`（**分母 190 正确**）。run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 ✅（vitest 15 文件全过，0 skipped），`e2e` job **已真实跑过**。登记 `BUG_REGISTER` V4-17（**VERIFIED**）/ `RISK_REGISTER` R-26 |
| **B-11** | 一般 | **`docker-verify.yml` 迁移物路径断言错误** —— 第 9 项误报「✗ 镜像内缺少迁移文件: `_journal.json`」，而同一步骤前面的 `ls` 已证明它存在。根因：drizzle 的 SQL 在 `/app/drizzle/` 根目录，而 `_journal.json` 与 snapshot 在 `/app/drizzle/meta/` 子目录，初版混用同一路径断言。**性质：验证脚本自身的错误，不是产品缺陷** | 提交 `930f29e`：SQL 与 meta 分成两段断言，meta 段同时断言 3 个 snapshot + `_journal.json`（覆盖面更严）。登记 `BUG_REGISTER` V4-16 |
| **B-15** | 严重 | **节点申请 UI 提交链断裂（V4-20 / R-27）** —— HTML 规范给 `HTMLFormElement` 加了 `[OverrideBuiltins]`：表单内的**命名控件**会**遮蔽原型上的同名属性**。`<form><input name="nodeName"></form>` ⇒ `form.nodeName` 返回 **HTMLInputElement**（不是 `"FORM"`）⇒ Next.js 15.5 内置的 React 19 水合代码（`react-dom-client.production.js` 的 `canHydrateInstance`）中 `instance.nodeName.toLowerCase()` 抛 `TypeError` ⇒ 水合失败（React #418）⇒ **事件处理器不绑定** ⇒ 表单走浏览器原生 GET 提交 ⇒ **写操作彻底失效**（**API 路径通过、纯 UI 路径失败**） | ✅ **已修并本地实测验证** —— 提交 `bddb3d0`：表单命名属性改名以消除遮蔽（`NodeRequestForm.tsx` 的 `nodeName` → `node_slug` / `nodeTitle` → `node_title`，`name` 与 `id` 均改；`NewTopicForm.tsx` / `TopicEditForm.tsx` 的 `name="title"` → `name="topic_title"`，`id="title"` 有意保留供 E2E 定位；`e2e/v004-four-roles-ui.spec.ts` 与 `e2e/helpers.ts` 选择器同步）；**新增** `tests/form-name-shadowing.spec.ts`（4 条防回归断言，扫全仓 `src/`）。**实测**：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿；`/nodes/request` 的 React #418 **由 2 次归零**；提交恢复为 `POST /api/node-requests` ✅、URL 停在 `/nodes/request` ✅、成功 toast 出现 ✅。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`。****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。登记 `BUG_REGISTER` **V4-20** / `RISK_REGISTER` **R-27** |

### 二、性能优化（EXPLAIN ANALYZE + 真实压测实测，10 万主题 / 100 万回复）

| 端点 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| 搜索 API | 3207ms | **41ms** | `pg_trgm` GIN 三值索引（ILIKE 前导通配符无法用 B-tree） |
| 节点列表 API | 1543ms | **67ms** | 相关子查询 → 聚合 JOIN；`topics.last_reply_at` 已是汇总字段，无需 join 100 万 replies |
| 排行榜 API | 超时（>30s） | **~1.2s**（并发 10） | 见 B-08 |

### 三、新增迁移

- `drizzle/0002_v004_perf_indexes.sql`：5 个 btree + 2 个条件性 pg_trgm GIN 索引；
  `CREATE EXTENSION` 用 DO 块捕获权限不足（跳过索引而不让迁移失败）；
  全部 `IF NOT EXISTS`，连跑 3 次幂等，全新库迁移实测通过。

### 四、新增能力与工程化

| 项 | 内容 | 证据 |
|---|---|---|
| 升级脚本自动同步镜像 tag | 重写 `deploy/update.sh`（+688 行）：自动改写 `.env` 的 `V2EX_IMAGE`、失败回滚、备份失败中止、非法版本号拒绝、镜像未变化时告警中止（退出码 3） | `b0d68c2`；`scripts/release/verify-update-script.sh` **87 项断言全 PASS / 0 FAIL**（本轮实测；历史为 62 项） |
| 升级脚本沙箱自检 | **不依赖 Docker** 的自检脚本：`mktemp -d` 沙箱 + 假 `deploy/.env` + 真实 `backup.sh` 副本 + 记录调用参数的 docker stub，跑**真实的** `update.sh` 并断言 8 类行为 + 「仓库真实文件未被改动」校验和 | `scripts/release/verify-update-script.sh`（749 行），实测 `PASS=62 FAIL=0` |
| Docker / Redis 取证通道 | 新建 `.github/workflows/docker-verify.yml`（9 项验证），含 `[R-17a]` Redis 中断恢复、`[R-17b]` PG 中断恢复、`[R-17c]` 缓存失效与内存观测 | `b0d68c2` + `2532f5f` + `930f29e`；**首轮实跑已通过第 9 项的 6 个子断言**（非 root、8 项 devDependency 未检出、3 个运行时文件已检出、5 个 env/凭据文件未检出、迁移 SQL 完整、体积打印） |
| 发布前只读门禁 | `scripts/release/preflight.sh` 双模式（`--phase=dev` / `--phase=release`）：版本一致性 / 流水线闸门 / 迁移幂等 / 安装包结构四类，**只读、不写、不联网** | `docs/RELEASE_PROCESS_v0.0.4.md` §14 |
| 视觉汇总脚本入仓 | `tools/visual/summarize-visual-diff.py` + `docs/evidence/visual/geometry-summary.json`（三套口径机器可读，**52/52 可复算**） | `1b15f79` |

### 五、测试与证据（**权威口径**）

| 项 | 权威值 | 实测命令 / 证据 |
|---|---|---|
| **单元测试** | **194 条 / 16 个文件**，**194 passed / 0 failed / 0 skipped**，**连续 4 轮全绿**。**本轮隔离实例实测 81.68s**；历史轮次 170~210s（共享实例 55433 口径）。⚠️ **修复前基线为 190 条 / 15 文件**（新增 `tests/form-name-shadowing.spec.ts` 的 **4 条防回归断言** ⇒ 190 → 194） | `ENV_FILE=.env.test npx vitest run`；`docs/evidence/ci/test-baseline-v0.0.4.md` |
| **单元测试（CI）** | ✅ **CI 已转绿** —— run `41860242099` 与 `41873009808` 的「类型检查 / 单元测试」job 均 success，vitest 15 文件全过（`Test Files 15 passed (15)` / `Tests 190 passed (190)` / 0 skipped）。**修复前的历史观测**（run `41837212170`，HEAD `930f29e`）：`185 passed \| 5 skipped (190)` —— **分母 190 正确**，5 条因 `floor-continuity` 崩溃而跳过；**已由 `8ce5ce9` 修复并经 CI 复验**。✅ **V4-20 修复后的 194 条（16 文件）已由 CI 复验通过** —— run `41949555282`（SHA `bddb3d0`）：`Test Files 16 passed (16)` / `Tests 194 passed (194)` / 0 skipped | `docs/evidence/ci/ci-status-v0.0.4.md` §0 |
| **真实浏览器 E2E** | **154 条 / 11 个文件**（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`）。✅ **当前权威值 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实测全绿。**本地历史轮次口径**：153 passed / 0 failed / 0 skipped，连续 2 轮全绿（4.5m/轮，基于 153 条口径、早于 `ed385cf`）。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`，唯一失败为 `e2e/v004-four-roles-ui.spec.ts:122` 节点申请 UI 提交链断裂（**真实产品缺陷**，V4-20 / R-27）—— **已由 `bddb3d0` 修复并本地实测验证**；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）** | `ENV_FILE=.env.test LOCAL_BASE=http://localhost:3010 npx playwright test`；`docs/evidence/e2e/e2e-full-run-v0.0.4.md` |
| **升级脚本自检** | **87 项断言全 PASS / 0 FAIL**（本轮实测；历史为 62 项） | `bash scripts/release/verify-update-script.sh` |
| **视觉对照** | 4 视口 × 17 页面 = **68 条**；**40 有对照 / 28 无对照**；严格口径桌面 Δx=0 **52/52**、Δw=0 48/52 | `tools/visual/summarize-visual-diff.py` + `docs/evidence/visual/geometry-summary.json` |
| **负载压测** | 13 场景 / 24785 请求，**0 个 5xx**；数据集 351 万行（10000 用户 / 1000 节点 / 100000 主题 / 1000000 回复） | `scripts/loadtest/seed-large.ts` + `tools/loadtest/bench.mjs` + `bench-result.json` |

#### 5.1 「185 vs 190」口径裁决（**权威值 = 194 条 / 16 文件 / 0 failed / 0 skipped**；修复前基线 = 190 条 / 15 文件）

⚠️ **「185」有两个不同来源，绝不可混用**：

| 数字 | 来源 | 含义 | 归属 |
|---|---|---|---|
| **194** | V4-20 修复后本地实测（`ENV_FILE=.env.test npx vitest run`） | `Test Files 16 passed (16)` / `Tests 194 passed (194)` —— **总数即 194**（新增 `tests/form-name-shadowing.spec.ts` 的 4 条防回归断言） | ✅ **v0.0.4 当前权威基线** |
| **190** | V4-20 **修复前**的本机连续 4 轮实测（`ENV_FILE=.env.test npx vitest run`） | `Test Files 15 passed (15)` / `Tests 190 passed (190)` —— 当时的总数即 190 | ✅ **修复前基线**（190 + 4 = 194） |
| **185**（作为**通过数**） | **修复前的历史观测**：CI run `41837212170`（HEAD `930f29e`） | `Tests 185 passed \| 5 skipped (190)` —— ⚠️ **分母仍是 190**；5 条因 `floor-continuity` 在 CI 崩溃而跳过 | ✅ **历史快照**（红灯已由 `8ce5ce9` 修复，run `41860242099` / `41873009808` 单元 job 已 ✅） |
| **185**（作为**总数**） | CI run `41760677505`（master @ `37710fb4`，**14 个** spec 文件） | `Tests 185 passed (185)` —— 当时总数就是 185 | ⏪ **v0.0.3 历史快照**，已过时 |

**结论**：
1. **v0.0.4 的用例总数在 V4-20 修复后为 194**（16 个文件）—— **修复前为 190**（15 个文件）——
   CI 的 `185 passed | 5 skipped (190)` **分母就是 190**，**不构成「总数有争议」**。
   与 v0.0.3 的**总数差异**来自 `tests/floor-continuity.spec.ts`（5 条，提交 `1b15f79` 引入）：
   `185 (master, 14 文件) + 5 = 190 (V4-20 修复前, 15 文件)`；
   V4-20 修复再 +4（`tests/form-name-shadowing.spec.ts` 的 4 条防回归断言）：
   `190 + 4 = 194 (当前, 16 文件)`。
2. **185 不是「v0.0.4 的用例数」** —— 它要么是 CI 上的**通过数**，要么是 **v0.0.3 master 的历史总数**。
3. ✅ **CI 单元测试已转绿**（run `41860242099` / `41873009808`，SHA `2773cd1`）：`Test Files 15 passed (15)` /
   `Tests 190 passed (190)` / **0 skipped**，`e2e` job **已真实跑过**（不再被 `needs: unit` 连带跳过）。
   **修复前的历史观测**（run `41837212170`，HEAD `930f29e`）为 `Test Files 1 failed | 14 passed (15)` /
   `Tests 185 passed | 5 skipped (190)`，根因是 `tests/floor-continuity.spec.ts` 硬编码
   `readFileSync('.env.test')` + `:55433/` 端口白名单 —— `.env.test` 被 gitignore ⇒ CI 检出里没有该文件，
   而 CI 的 `DATABASE_URL` 是 5432 ⇒ 两条路都走不通 ⇒ ENOENT 崩溃 ⇒ 5 条 skipped ⇒
   `unit` job 红灯 ⇒ **`e2e` job 被 `needs: unit` 连带跳过**。
   **已由 `8ce5ce9` 修复并经 CI 复验**（护栏 3 修复提交 `634a202`）——
   登记 `BUG_REGISTER` V4-17（**VERIFIED**）/ `RISK_REGISTER` R-26（🟢 已修复并经 CI 复验）。
4. ⚠️ 静态 grep 得出 **180**（少于 190），因 `admin-permissions.spec.ts` 用嵌套 for 循环生成用例 ——
   **口径必须取 Vitest 运行时的 `numTotalTests`**。三方交叉校验见 `docs/evidence/ci/test-baseline-v0.0.4.md` §0.1 / §0.2。
5. ⚠️ **核对 CI 必须看 `Test Files` 行，不能只看 `Tests` 行**（`1 failed + 5 skipped` ≠ 「少了几条」）。
6. ✅ **V4-20 修复后的 194 条（16 文件）已由 CI 复验通过** —— run `41949555282`（SHA `bddb3d0`）：`Test Files 16 passed (16)` / `Tests 194 passed (194)` / 0 skipped；E2E 同 run `154 passed (2.5m)` / 0 failed。

#### 5.2 E2E 用例数口径（**154**）

分解（`npx playwright test --list` 实测 `Total: 154 tests in 11 files`）：
原有 6 文件 67 条 + v004 四文件 **79** 条 + 四身份 UI **8** 条 = **154 条 / 11 文件**。

✅ **当前权威实测结果 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）**（V4-20 修复后本地实跑）。
**修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。

`ed385cf`（补齐八项 UI 缺口）的 **增量为 +1** —— 新增的「关注（UI）：真实点击关注/取消，刷新后状态持久化，
关注列表出现该用户」落在 `e2e/v004-account-admin.spec.ts`（该文件由 20 条增至 21 条），
`v004-four-roles-ui.spec.ts` 仍为 8 条。

历史数字 **144**（`67 + 77`，更早时点）、**152**（新增 DOM 实证用例之前的时点）、
**153**（`ed385cf` 之前的时点，`v004-account-admin` 为 20 条）各有其时点，均非错误，**当前权威值为 154**。
⚠️ `v004-endpoint-smoke.spec.ts` 条数随 GET 路由数浮动 ⇒ **正式发布前须重新 `--list` 固定口径**。

> ⚠️ 口径待复核（主理人）：本轮任务书给出的分组写法是「**67 + 78 + 9 = 154**」（即把 +1 记在「四身份 UI」组）。
> 但**按 `ed385cf` 的实际 diff 与 `--list` 实测逐文件计数**，+1 落在 `v004-account-admin.spec.ts`（20 → 21），
> 因此分组应为「**67 + 79 + 8 = 154**」。**总数 154 与任务书一致**，仅「哪一组 +1」的归属不同。
> 本节采用**实测口径**，请主理人确认是否按此统一。

#### 5.3 视觉结论的边界（**不得宣称「像素级复刻完成」**）

- 严格口径 Δx=0 **52/52** 只覆盖**几何位置**一个维度。
- **六类区分必须分别判定**：几何位置 / 组件宽高 / 视觉样式 / 动态内容 / 缺失组件 / 实际交互。
  其中组件宽高 Δw=0 仅 **48/52**，动态内容因原站是真实社区数据而本地是 seed 数据**必然不同**，
  缺失组件与实际交互**未覆盖**（28 条无原站对照）。
- **分母说明**：68 条中 **40 条有对照、28 条无对照**（`no-auth-reference` 6 个页面 × 4 视口 = 24 条
  + `no-origin-equivalent` 1 个页面 × 4 视口 = 4 条）。无对照项**不拿游客态冒充**。
- 移动 375 视口的 Δx=0 仅 10/52，是**有意的响应式重排**（原站桌面版 `min-width:600px` 横向滚动），
  **不是复刻失败**。

### 六、风险状态（收尾轮实测同步；详见 `RISK_REGISTER.md`）

| ID | 风险 | 收尾轮新状态 |
|---|---|---|
| **R-01** | 原站版权素材经 Git 历史持续暴露 | 🔴 **DEFERRED（维持）** —— 只读复核：风险未消除；隔离演练证明方案技术可行且不损坏项目，但与「不得移动已发布 Tag」的约束存在**待主人裁决**的冲突 |
| **R-16** | Docker 容器与安装包未实跑 | 🟢 **已闭环** —— `docker-verify` **九项全部 completed / success**，九项汇总表全 PASS（run `41871503684`，SHA `2773cd1`）。修复提交：`827eef7`（安装模拟改走首次安装路径）、`2773cd1`（安装模拟前 unset job 级 env，修 compose 插值泄漏导致的假绿） |
| **R-17** | Redis 故障恢复 / 缓存失效 / 内存观测未验证 | 🟢 **已闭环** —— 同 run `41871503684` 九项全绿，含 `[R-17a/b/c]` 三个专项（Redis / PG 中断恢复、缓存失效与内存观测） |
| **R-18** | 升级路径断点（`update.sh` 不更新镜像 tag） | 🟢 **已修并验证** —— `b0d68c2`；62 项自检断言全 PASS |
| **R-19** | `release.yml` tag 白名单不含 `v0.0.4` | 🟡 **部分已修（维持）** —— 白名单**发布时人工加入**，不会自动加 |
| **R-20** | 版本载体全部为 `0.0.3` | 🟢 **已裁决（维持）** —— 开发态保持 0.0.3，最终 SHA 固定后一次性同步 |
| **R-21** | 四身份 UI 验收缺口（管理员无 `/admin` 入口等） | 🟢 **已修复**（`ed385cf`）—— 管理员入口 / 关注 / 节点申请审批 / 通知已读全部补齐，**待主理人终验确认** |
| **R-22** | 单测建库超时 | 🟢 **已定案并复验** —— 三次归因勘误后定案（crash recovery / I/O 积压态），稳态 `CREATE DATABASE` **2.0~2.3s**；`hookTimeout` 提到 120s；连续 4 轮全绿 |
| **R-23** | 关注链路断言被静默跳过 | 🟢 **已修复并实跑通过** —— 修复前的 152 passed / 1 skipped 如实保留在证据文件，不回写历史 |
| **R-24** | 关注功能无 UI 入口 | 🟢 **已修复**（`ed385cf`）—— 关注按钮可真实点击、刷新后状态持久化，**待主理人终验确认** |
| **R-26** | CI 上单元测试红灯（`floor-continuity` 崩溃 ⇒ `e2e` job 连带跳过） | 🟢 **已修复并经 CI 复验** —— 提交 `8ce5ce9`（护栏 3 修复 `634a202`）；run `41860242099` 与 `41873009808` 的单元 job 均 ✅（vitest 15 文件全过、0 skipped），`e2e` job **已真实跑过** |
| **R-25** | 运行时上传数据被误提交入仓 | 🟡 **已缓解 —— 历史仍可达，与 R-01 同源** —— `.gitignore` + `git rm --cached` 已执行；18 个占位 PNG **仍在 Git 历史**，彻底消除需授权改写历史 |
| **R-27** | 节点申请 UI 提交链断裂（**本轮唯一红灯 —— 已解除**） | 🟢 **已修复并本地实测验证**（提交 `bddb3d0`）—— 根因：HTML 规范的 `[OverrideBuiltins]` 使表单内**命名控件遮蔽 `form.nodeName`** ⇒ react-dom 水合代码 `canHydrateInstance` 中 `instance.nodeName.toLowerCase()` 抛 `TypeError` ⇒ 水合失败（React #418）⇒ 事件处理器不绑定 ⇒ 原生 GET 提交 ⇒ 写操作失效。**修复**：表单命名属性改名 + 新增 `tests/form-name-shadowing.spec.ts`（4 条防回归断言）。**实测**：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿，React #418 **归零**，`POST /api/node-requests` 正常。**修复前的历史快照**：CI run `41873009808` = `153 passed \| 1 failed \| 154 total`。****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。登记 `BUG_REGISTER` **V4-20** |

### 七、不包含（未实现，如实标注）

- **容器级升级实跑** —— 升级脚本自检（87 项断言，本轮实测）已在沙箱通过，但**真实容器级升级仍需带 Docker 的环境复跑**。
- **真实 SMTP 投递** —— 未配置，仅做静态核查。
- **多浏览器 E2E（Firefox / Safari）** —— 本机仅 Chromium / Edge。
- **原站需登录的 7 个页面 × 4 视口 = 28 条视觉对照** —— 无权访问他人账号，不拿游客态冒充。
- ~~**节点申请 UI 提交链断裂（R-27 / V4-20）**~~ —— ✅ **已由 `bddb3d0` 修复并本地实测验证**，不再属于「不包含」项。
  根因是 HTML 规范的 `[OverrideBuiltins]` 使表单内**命名控件遮蔽 `form.nodeName`** ⇒ react-dom 水合代码抛
  `TypeError: nodeName.toLowerCase is not a function` ⇒ React #418 水合失败 ⇒ 事件处理器不绑定 ⇒ 表单走原生 GET 提交。
  实测：单元 **194/194（16 文件）**、E2E **154/154（11 文件，3.9m）** 全绿，`/nodes/request` 的 React #418 **归零**，
  提交恢复为 `POST /api/node-requests`、URL 停在 `/nodes/request`、成功 toast 出现。
  **修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`；****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。
- **R-25 的历史残留** —— 18 个公开占位 PNG **仍在 Git 历史里**（内容无害：无用户数据、无凭据），
  彻底消除需**主人单独授权**改写历史。
- **远端 Git 历史改写** —— 仅在隔离副本演练成功（`docs/HISTORY_CLEANUP_DRILL_v0.0.4.md`），
  状态 **DEFERRED，待主人单独授权**；仓库保持 Public。

---

## [0.0.3] - 2026-11-04

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。
>
> 本小节只记录**本轮实际做过并验证过的事**。未实现的能力列在「不包含」，
> 不以任何形式（包括占位按钮、静态演示数据）冒充已实现。

### 数据库

- 新增 **8 张表** + `topics`/`replies` 各 **5 个新字段**（26 表 / 12 枚举）：
  - `edit_history` —— 主题与回复的编辑历史快照（**只 INSERT，不可变**）
  - `password_reset_tokens` —— **只存 sha256 哈希**；含 `expires_at`/`used_at`/`revoked_at` 三重状态
  - `credit_ledger` —— 积分流水账本（含 `balance_before`/`balance_after` 快照与幂等键）
  - `daily_checkins` —— 每日签到（`(user_id, checkin_date)` 唯一）
  - `reports` —— 举报与处理记录
  - `node_requests` —— 节点创建申请
  - `avatars` —— 头像文件元数据
  - `email_logs` —— 邮件发送日志（**收件人脱敏**）
  - `topics`/`replies` 新增 `deleted_at`/`deleted_by`/`deleted_reason`/`edited_at`/`edit_count`
- 软删除**沿用已有的 `topic_status` 枚举**，不新增枚举值 —— 避免破坏 v0.0.2 已有数据。
- 迁移 `0001_striped_magdalene.sql` 做**完全幂等化**：
  `CREATE TABLE`/`CREATE INDEX`/`ADD COLUMN` 加 `IF NOT EXISTS`；
  `CREATE TYPE`/`ADD CONSTRAINT` 包入 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  （PostgreSQL 不支持 `CREATE TYPE IF NOT EXISTS`）。
- **迁移幂等性实测**：连续应用 3 次全部 `exit=0`，最终 26 表 / 38 约束。

### 主题与回复系统

- 主题**编辑 / 软删除 / 恢复**，回复**编辑 / 软删除 / 恢复**
- 主题**锁定 / 解锁 / 置顶 / 取消置顶**（仅 moderator/admin，全部写 `moderation_logs`）
- **可配置编辑时间限制**（`TOPIC_EDIT_WINDOW_MINUTES`，默认 60 分钟；管理角色不受限）
- **编辑历史**：每次编辑写入前后快照，仅作者本人或 staff 可查看
- **回复引用**（`replies.quoteId`）与楼层锚点跳转
- **主题投票**、**回复感谢** —— 唯一索引保证幂等，改票按差额 ±2 调整汇总
- **已删除内容不泄露**：列表与详情默认过滤；仅 staff/作者可用 `?includeDeleted=true` 显式查看
- 楼层号用 `floor_counters` 原子 UPSERT 分配 —— **12 并发回复楼层号无重复**

### 用户与账户系统

- **邮件找回密码**：防邮箱枚举（邮箱存在与否**响应完全一致**）；
  按 IP + 按邮箱哈希**双重限流**；**未配置 SMTP 时如实返回「未送达」，绝不假装已发送**
- **一次性重置令牌**：只存哈希；过期/撤销/已使用三重防护；
  消费用 `UPDATE ... WHERE used_at IS NULL` —— **8 并发消费只有一个成功**
- **改密后旧会话全部失效**（删除该用户 `sessions` 记录）
- **零依赖 SMTP 客户端**（`src/lib/mailer.ts` 的 `deliverViaSmtp()`）—— 不引入 `nodemailer`，避免扩大供应链面
  > **v0.0.5 更正**：此前文档标注的 `src/lib/smtp-client.ts` 是一个**没有生产调用方的死代码**
  > （真正的生产实现在 `src/lib/mailer.ts`）。本轮已**删除该死代码**，并把协议级测试改为
  > **直测生产路径**，同时修复了生产实现里的 3 个真实缺陷。
- **头像上传**：magic number 嗅探（**不信任 MIME 声明**）、大小上限、
  **服务端生成随机存储路径**（防路径穿越与覆盖）
- **修改资料**（`PATCH /api/users/me`）：只改本人；`url` 仅允许 http/https（防 `javascript:` 伪协议）
- **关注 / 取消关注**、**关注用户的主题列表**、**通知已读/全部已读/删除**

### 社区积分与互动机制

- **不可篡改的积分账本**（`credit_ledger`）：只 INSERT，含变动前后余额快照与幂等键
- **并发安全**：`SELECT ... FOR UPDATE` 行锁 + 幂等键唯一索引
  —— **30 并发扣 10 分恰好成功 10 次，余额为 0（未变负）**
- **余额不足拒绝扣费**并回滚，绝不产生负余额
- **每日签到**（同一天只发一次；连续签到天数递增）、**积分排行榜**、**活跃度统计**
- 管理员调整积分并写审计日志
- ⚠️ **积分额度为独立实现**：可观察依据只有 `users.balance` 字段注释与 `credit_ledger` 枚举，
  具体数值无从确证，故全部做成可配置（`TOPIC_CREDITS`/`REPLY_CREDITS`/`CHECKIN_CREDITS` 等），
  **不声称复刻原站真实数值**。

### 节点与内容分发

- **节点分类 / 子节点 / 面包屑**（面包屑含环检测，最多 10 层）
- **节点创建审批**：普通用户申请 → 管理员审批 → 真正创建节点并回填 `approved_node_id`
- **节点主题数与最新回复统计**（实时查询，不依赖可能滞后的缓存字段）
- **搜索**：参数化查询（**绝不拼接 SQL**）、分页上限 100、
  排序 `relevance`/`createdAt`/`repliesCount`、按节点/作者/时间范围过滤
- **Feed**：全站 RSS 2.0 / Atom 1.0 / JSON Feed 1.1 + 节点 RSS 2.0
  —— 全部输出**真实数据库内容**，软删除主题不出现，Content-Type 精确

### 后台管理

- **13 个管理 API**，统一走 `adminGuard`/`adminGuardWrite` 守卫：
  未登录 → **401**，角色不足 → **403**
- 用户列表/搜索/角色变更/封禁/解封、举报列表与处理、待审核聚合、
  内容隐藏与恢复、节点审批、操作日志、系统配置（**凭据一律脱敏**）、社区统计
- **不提供未经验证的危险操作** —— 没有删除用户、执行任意 SQL、修改配置的接口
  （`tests/admin-permissions.spec.ts` 会扫描路由目录验证这一点）
- 管理员**不能把自己降级**（防系统锁死）；moderator **不能封禁 admin**
- **封禁用户立即失效其全部会话**

### 视觉与响应式

- 新增 **600px / 500px 断点**（沿用原站 `combo.css` 的断点值），此前本地**零 `@media`**
- ≤600px：解除 `.content` 的 `min-width:600px`（窄屏横向滚动的根因）、
  `#Main` 占满、`#Rightbar` 改 flex `order` 排在主区之后、表单元素占满宽度
- `.fa` 图标类由 `float:left` 改为 `inline-block`（与原站 `combo.css` 对齐）
- **键盘可访问性**：`:focus-visible` 焦点可见；尊重 `prefers-reduced-motion`
- 视觉差异量化：1280/1920 视口 **Δx 一致率 96.9%**（几何量测，非像素相似率声明）

### 文档

- 新增 `FEATURE_MATRIX.md`（58 项逐项标注实现位置与证据）、
  `API_SPEC.md`（55 路由 / 72 端点，由源码提取）、
  `DATABASE_SCHEMA.md`（26 表 / 12 枚举，由运行中的数据库读取）、
  `docs/VISUAL_DIFF_REPORT.md`、`TEST_REPORT.md`、`docs/UPGRADE-v0.0.3.md`
- README 版本号与真实实现对齐（此前仍写 v0.0.1）

### 测试

- 单元测试 **185/185 全绿**（v0.0.2 基线 117 条全部保留 + 新增 68 条），零回归
  —— ⚠️ **这是 v0.0.3 的历史总数**（master @ `37710fb4`，14 个 spec 文件）；
  v0.0.4 的权威基线是 **194/194（16 文件）**（V4-20 修复前为 190/190（15 文件）），口径澄清见文首 `[Unreleased]` §5.1
- 新增 5 个测试文件，覆盖正常流程/非法输入/越权/重复请求/并发/数据一致性
- 真实 HTTP 端到端验证（真实 `next start` + 真实 PostgreSQL）：
  投票幂等、感谢自己的回复被拒、签到幂等、未登录 401、越权 403、
  **软删除主题对普通访问者返回 404（不泄露）**

### 不包含

- **未实现**：举报的前端入口、节点申请的前端页面、站内 Feed 聚合页、
  PostgreSQL 全文搜索、多语言、私信
- **部分实现**：邮件**真实投递**（SMTP 客户端与令牌流程已实现并测试，
  但本机未配置真实 SMTP 服务器，未验证真实送达）；
  头像**自动裁剪**（未安装 `sharp`，当前降级为保存原图）
- **未执行**：镜像漏洞扫描（Trivy/Grype，本机无 Docker）、多浏览器视觉回归、
  基础负载测试（k6）
- **未做**：原站移动版比对（无原站移动版证据；本项目窄屏为独立替代实现）

## [0.0.2] - 2026-11-04

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。
>
> **本小节只记录「供应链 / CI/CD / 容器 / 文档」四个方面本轮实际做过的事。**
> 应用层（业务逻辑、接口、界面）的变更由对应负责人另行补充 ——
> 本节**不代为声明**，以免夸大。

### 供应链

- **修复** 4 个 moderate 依赖漏洞（`npm audit` 由 4 降为 **0**）：
  `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`
  （GHSA-67mh-4wv8-2f99，「esbuild 开发服务器可被任意网站跨域读取响应」）。
  通过 `overrides` 把 `@esbuild-kit/core-utils` 下的 esbuild 钉到 `^0.25.0`，
  实际解析为 **0.25.12**（受影响范围 `<=0.24.2`）。
- **未降低扫描等级**：发布流水线的漏洞门禁（critical / high 即中止发布）**一个字未改**；
  漏洞数是**降下来的**，不是被藏起来的。
- 修复后**迁移能力实测未损坏**：`drizzle-kit generate` 与 `drizzle-kit migrate` 均成功，
  `tsc --noEmit` 0 错误，`vitest` **103/103** 全绿，`next build` 成功。
- 补充证据：该漏洞路径在生产**结构性不可达** ——
  `drizzle-kit` 虽声明了 `@esbuild-kit/esm-loader` 依赖，但**从不 import 它**；
  它实际加载的是 `drizzle-kit/node_modules/esbuild`（0.25.12，本就安全）。

### 容器与部署

- **修复** 生产镜像携带全部 devDependencies 的问题：
  Dockerfile 的运行层此前 `COPY --from=builder /app/node_modules`，把含
  `@playwright/test`、`vitest`、`typescript`、`@types/*` 的**完整** `node_modules`
  （本机实测 530 MB）打进了生产镜像 —— 同时把漏洞版 esbuild 也一起带了出去。
  现改为在运行层执行 `npm ci --omit=dev`，按依赖图只装生产依赖。
- 为此把 `drizzle-kit` 与 `tsx` 从 `devDependencies` **上移到 `dependencies`** ——
  它们不是测试工具，而是容器 entrypoint 的**真实运行时依赖**
  （阶段 1 迁移、阶段 2 首次初始化分别直接调用它们）。
  实测 `npm ci --omit=dev` 后 `drizzle-kit/bin.cjs`、`tsx/dist/cli.mjs`、
  `next/dist/bin/next` 三个路径均存在。
- **修复** `playwright-core`（14 MB）仍进生产镜像的问题。
  根因是 `next@15.5.28` 把 `@playwright/test` 声明为 `peerOptional`，
  npm 会自动安装 optional peer —— `--omit=dev` 裁不掉，
  `--omit=peer` 也**无效**（实测仍装 73 包 / 429 MB）。
  改为安装后显式删除，并加**防回归护栏**：删除后断言三个 entrypoint
  路径仍在，否则**构建当场失败**（而不是等容器启动时才炸）。
  依据：实测 next 的运行时代码（`dist/server/**`）**零处**引用 playwright，
  仅 `next test` / `experimental-test` 引用 —— 本项目不使用这些路径。
- **实测验证裁剪后的生产依赖闭包真的能跑**（无需 Docker）：
  - `npm audit --omit=dev --audit-level=moderate` → **found 0 vulnerabilities**
  - 依赖体积 429 MB →（删 playwright 后）**411 MB**
  - 裁剪后 `next build` ✓ Compiled successfully
  - 裁剪后 `next start` + 真实数据库：`/` `/signin` `/signup` `/nodes`
    `/api/captcha` `/t/1` **全部 200**，日志 `MODULE_NOT_FOUND` 计数 **0**
  - 裁剪后 `drizzle-kit migrate` ✓ 18 张表；`tsx` 跑 seed ✓ 完成
  - 漏洞版 esbuild 0.18.20 **已不在**生产依赖闭包内（解析为 0.25.12）
- 生产镜像**不含**原站版权素材、`.env`、凭据文件 —— 由发布流水线的
  「核验镜像不含敏感文件」步骤在真实镜像上 `docker run` 实测。

### CI/CD

- **修复** `ci.yml` 全部 action 使用 node20 版本、会在启动阶段直接失败的问题。
  GitHub 已于 2026-09-23 移除 runner 的 Node 20 运行时，且
  `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` 退避开关同时失效。
  `ci.yml` 的 `actions/checkout@v4` / `setup-node@v4` / `upload-artifact@v4`
  已全部升级到 node24 版本（`@v7`）—— 与 `release.yml` 对齐。
- **修复** 发布流水线的 `dry_run` 开关**从未生效**的问题。
  该开关此前被声明、被输出、被打印，但**没有被任何 `if:` 消费**，
  导致手动触发时勾选「仅验证」依然会推送镜像并创建 Release。
  现已让 `dry_run=true` 真正做到：不登录 GHCR、不推送镜像、
  跳过 `publish-release` 与 `verify-release`；同时镜像经 artifact 传给
  `deploy-verify`，保证「只验证」仍能跑真实镜像。
- **收紧** 发布触发条件：`push` tag 的通配由 `v*` 改为**显式白名单**。
  理由：`v*` 会把任意形如 `vX.Y.Z` 的 tag 都变成发布触发器，
  而发布流水线带 `packages:write` 与 `contents:write`。
  当前白名单为 `v0.0.2` —— 每次发版需手动加入新版本号，这是**刻意的摩擦**。
- 审计结论（**无改动**）：两个 workflow 均**无** `pull_request_target`、
  **无** `workflow_run`；`release.yml` **无** `pull_request` 触发器 ——
  **未经审查的 PR 代码无法触及任何写权限 job**。
  顶层权限为 `contents: read`，仅 `build-image`（`packages: write`）
  与 `publish-release`（`contents: write`）按需提升。

### 文档

- 新增 [`docs/UPGRADE-v0.0.2.md`](docs/UPGRADE-v0.0.2.md) ——
  v0.0.1 → v0.0.2 的升级步骤、验证清单、回滚说明、已知问题。
- 新增 [`docs/RELEASE_GATE_v0.0.2.md`](docs/RELEASE_GATE_v0.0.2.md) ——
  v0.0.2 的发布门槛检查单（缺陷 / 供应链 / CI 权限 / 产物 / 部署 / 安装 / 合规 / 密钥 / 文档）。
- 新增 [`docs/SECURITY_EXCEPTIONS.md`](docs/SECURITY_EXCEPTIONS.md) ——
  已评估并接受的风险例外登记表，每条含可复核证据与**到期日**。
- 更新 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ——
  镜像地址更新为 `ghcr.io/alicia1030su/v2ex-clone:v0.0.2`；
  新增「GHCR 可见性说明」小节（public 包可匿名拉取；
  `denied` 的三种处理方式）；回滚小节补充「**tag 不可移动，已发布版本一律不覆盖**」；
  已知限制新增 3 条（生产镜像不含测试工具链 / 镜像体积与非 root 本机未实测 /
  Windows 只有 `install.ps1`）。
- 发行包版本号统一更新为 `0.0.2`（`deploy/VERSION`、`deploy/.env.example`
  的 `V2EX_IMAGE`、`deploy/docker-compose.yml` 的镜像默认值，
  以及 `install.sh` / `install.ps1` / `update.sh` 等脚本内的默认值）。

### 已知限制

本节**只列本轮新增或变化了的限制**；v0.0.1 已有的限制见下方 v0.0.1 小节。

- **生产镜像不再包含测试工具链** —— 若曾在生产容器里跑 `npx vitest` / `npx playwright`，
  现在会报「找不到模块」。这是**预期行为**，测试应在源码仓库或 CI 里跑。
- **镜像体积与非 root 运行的实测未能在本机完成** —— 开发环境没有 Docker。
  由 CI 的 `docker` job 与发布流水线在真实 Docker 环境验证；
  见 `docs/SECURITY_EXCEPTIONS.md` E-05。
- **Windows 发行包只有 `install.ps1`** —— `backup.sh` / `restore.sh` / `update.sh` /
  `start.sh` / `stop.sh` 均无 `.ps1` 对应版本，Windows 用户需按
  `docs/UPGRADE-v0.0.2.md` §3.2 / §5.4 的手工步骤操作。
- **Git 历史中的原站版权素材仍未清理** —— 本轮**未执行**（需单独授权改写历史或移动 tag）。
  详见 `docs/SECURITY_EXCEPTIONS.md` E-02 与 `RISK_REGISTER.md` R-01。

### 不包含

- 本轮**未**引入任何新的用户可见功能。
- 本轮**未**新增数据库迁移 —— v0.0.2 的数据库结构与 v0.0.1 相同。
- 本轮**未**接入任何大模型 API，因此**不存在** API Key 轮换与配额告警的运维负担。
  （若将来接入，必须先补齐密钥托管位置、轮换周期与配额告警阈值。）
- 本轮**未**执行任何远端写操作（未 push、未创建 tag、未创建 Release、未运行远程 workflow）——
  这些由仓库主人执行。

## [0.0.1] - 2026-11-03

> 早期开发预览版（Pre-release）。功能尚未完备，**不建议用于生产环境**。
> 界面与原站存在差异，**不保证与 V2EX 完全一致**。

### 新增

**账号体系**

- 注册、登录、退出、会话保持、修改密码全链路打通。
- 用户名唯一性由数据库唯一索引在 `lower(username)` 上强制，大小写不敏感。
- 账号状态分级（`active` / `suspended` / `banned`），登录时校验，被封禁账号返回 403。
- 服务端生成 SVG 验证码（320×80）：答案只存哈希、字段名哈希化、一次性消费。
- 用户个人主页（`/member/[username]`）。

**内容体系**

- 节点（分类）：节点列表、节点详情、子节点树、节点创建（管理员直生效 / 版主进待审）、节点审核、节点收藏。
- 主题：发布、列表（首页 / 节点页）、详情、浏览计数、Markdown 渲染。
- 回复：发布、楼层号分配、回复计数同步、分页；主题锁定时拒绝回复。
- 收藏：主题与节点两类独立收藏语义，支持取消收藏，收藏列表页 `/bookmarks`。
- 通知：回复通知自动生成、未读计数、通知列表页 `/notifications`。
- 搜索：顶栏 AJAX 联想建议、搜索结果页，支持主题 / 节点 / 会员三类检索。

**管理与权限**

- 三级角色体系：`user` / `moderator` / `admin`，操作级权限校验。
- 基础后台管理：`/admin` 概览、待审节点列表、操作日志（`moderation_logs`）。
- 运维 CLI（`npm run admin`）：`set-password` / `set-role` / `list-admins`，
  需 `ADMIN_CLI_TOKEN` 授权、`--reason` 必填、写入审计日志、拒绝降级最后一个管理员。

**数据与基础设施**

- PostgreSQL 17 持久化，18 张表，Drizzle ORM 迁移（`drizzle-kit migrate`）。
- Redis 7 可选接入；**未配置 Redis 时自动降级到 PostgreSQL**（语义等价，性能略低）。
- 键值抽象层（`src/lib/kv.ts`）统一 `get / set / del / incrWindow / clearAll`，
  Redis 与 PostgreSQL 两种实现行为一致。
- Docker 多阶段镜像（deps → builder → runner）+ Docker Compose 编排。
- 容器启动**三阶段分离**：迁移 → 首次初始化 → 启动应用（`scripts/docker-entrypoint.sh`）。
- PostgreSQL 与 Redis 配置 healthcheck，app 服务等待两者健康后再启动。
- Compose 默认**不向宿主机暴露**数据库与缓存端口，仅在内部网络可达。
- GitHub Actions CI 三个 job：类型检查 / 单元测试、E2E、Docker 镜像构建与启动验证。

**文档**

- 新增安装手册 `docs/INSTALL.md`、部署手册 `docs/DEPLOYMENT.md`、发布检查清单 `docs/RELEASE_CHECKLIST.md`。
- 新增本文件 `CHANGELOG.md`。

### 修复

- **seed 覆盖已有账号口令**：seed 改为「只初始化、不修改」，账号已存在时不覆盖其口令与角色；
  首次初始化由 `kv_store` 中的初始化标记守卫，重启与重新部署不再重置管理员口令、不再重复写入演示数据。
- **Docker 镜像构建失败**：数据库连接池改为惰性初始化并始终缓存在 `globalThis`，
  构建期不再需要数据库连接；同时修正 Dockerfile 的拷贝清单（补入 `src/db`，修复容器启动时 seed 崩溃）。
- **楼层号计数器漂移**：新增 `allocateFloor` 自愈逻辑，计数器与实际楼层不一致时自动重建，
  修复并发回复下楼层号重复导致回复接口 500 的问题。
- **配置 Redis 时「清空限流」静默失效**：限流计数器随实现存放在 Redis 或 PostgreSQL，
  原实现只清数据库表，导致配了 Redis 时清空操作静默无效（端点返回 200 但配额未清）；
  KV 抽象新增 `clearAll`，两种后端都能真正清空。
- **verify.sh 跨平台化**：移除写死的本机 Windows 路径，数据库操作统一走 Node 脚本
  （不再依赖 `psql` / `pg_dump` 命令行工具），进程管理区分 Windows（`taskkill`）与 POSIX（`kill`）。
- **verify.sh 端口匹配错误**：`netstat` 输出中端口后跟空白再跟状态列，原匹配模式 `":$PORT"`
  会误匹配 `:30301` 之类的端口，导致残留旧服务占端口、E2E 打到连着别的数据库的旧实例；
  已修正为 `":${PORT}[[:space:]]"` 并增加端口就绪断言。
- **`.gitignore` 规则未命中视口子目录**：gitignore 的 `*` 不跨越目录分隔符，
  原规则 `docs/evidence/screenshots/ref-*.png` 从未生效，30 张原站参考截图一直被 Git 跟踪；
  改为 `docs/evidence/screenshots/**/ref-*.png` 后才真正覆盖任意深度的视口子目录。
- **CI 限流参数被调高**：为「让测试跑快点」而调高限流阈值会导致限流用例永远等不到 429；
  已改回与生产一致的默认值，限流覆盖恢复正常。

### 安全

- **CSRF 防护**：显式双提交 Cookie 模式 —— 服务端下发 `v2_csrf` Cookie，
  页面把同一 token 注入表单隐藏字段 / 请求头，写操作时用 `timingSafeEqual` 比对。
- **XSS 清洗**：正文渲染前经 `sanitize-html` 白名单过滤（标签、属性、协议、样式），
  拒绝 `javascript:` 协议与 `data:image/svg+xml`，移除 `on*` 事件处理器，
  外链自动补 `rel="noopener noreferrer"`。
- **开放跳转防护**：`sanitizeRedirect` 仅允许站内相对路径，拒绝外部绝对 URL 与协议相对 URL。
- **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`。
- **密码哈希**：scrypt + 随机 salt，不存储明文，不使用 bcryptjs 之外的弱方案。
- **会话安全**：服务端 session 表 + HttpOnly / SameSite=Lax Cookie。
- **限流**：登录、注册、发帖、回复、建节点均有限流；
  登录与注册按「IP + 账号名」双维度计数，Redis 缺失时降级到 PostgreSQL，限流不会因缺 Redis 而失效。
- **验证码哈希化一次性**：答案与字段名均只存哈希，校验后立即作废，服务端不保存明文答案。
- **数据库端口默认不暴露**：Compose 中 PostgreSQL / Redis 仅在内部网络可达。
- **运行时开关收敛**：`DISABLE_CAPTCHA` 仅在 `APP_RUNTIME_ENV=test` 且 `TEST_ENV_ISOLATED=1` 的
  隔离测试环境生效，生产与预发环境即使误配也强制启用验证码。
- **调试端点鉴权**：`/api/debug/*` 需显式开关 + `DEBUG_ENDPOINT_TOKEN` 令牌（恒定时间比较），
  未配置令牌时一律返回 404。
- **管理员口令强度**：生产环境必须显式设置 `SEED_ADMIN_PASSWORD`（≥12 位），否则 seed 直接报错退出，
  不接受任何弱默认口令。
- **示例配置无凭据**：`.env.example` 不提供任何可用的默认口令，Compose 中必需变量缺失即启动失败。

### 已知限制

- **未经生产环境验证**：本版本仅在开发机与 CI 的隔离容器中验证过，
  未做过压力测试、未做过长时间运行稳定性验证、未在真实生产环境跑过。
- **Redis 路径未在真实 Redis 上做过长时间验证**：CI 使用 service container 提供 Redis，
  单元与 E2E 覆盖了清空限流在 Redis 下的行为，但未做性能与边界行为的长期观测。
- **未实现的交互**：投票（顶 / 踩）、回复感谢（❤️）、通知已读标记、引用回复 ——
  对应的数据表与计数字段已建，但**点击交互未接通**，页面上不提供可用的按钮。
- **未实现的完整流程**：邮件找回密码（页面已复刻入口，后端邮件发送未实现）、
  关注用户与关注流（`follows` 表已建，首页无「关注」tab）、
  积分排行榜与每日登录加分（`users.balance` 字段与发帖 +10 已实现）。
- **未实现的输出格式**：节点 RSS / JSON Feed 仅复刻了入口位置，没有真正的生成器。
- **未实现的内容扩展**：主题标签、附件上传、私信、头像上传。
- **主题编辑与删除**：仅有软删除字段与后台可见性，缺 UI 与 API。
- **第三方登录**：Google / Solana 需要外部凭据与钱包签名，无可用测试账号，UI 以禁用态呈现。
- **演示账号只在非生产环境创建**：`SEED_DEMO_USERS=1` 时创建 `lisi` / `wangwu` / `zhaoliu` / `moderator`；
  生产环境（`APP_RUNTIME_ENV=production`）自动禁用演示账号创建。
- **版本号与界面差异**：v0.0.1 是**开发预览版**，页面与原站存在差异，
  **不保证与 V2EX 完全一致**。

### 不包含

以下能力在 v0.0.1 中**完全未实现**，不提供任何形式的假实现（无占位按钮、无假接口、无静态演示数据）：

| 能力 | 说明 |
|---|---|
| 主题编辑 | 作者无法编辑已发布主题 |
| 主题删除 | 作者无法删除已发布主题 |
| 回复感谢（thank） | `thanks` 表与计数已建，点击交互未接 |
| 关注用户 / 关注流 | `follows` 表已建，无 UI |
| 积分排行榜 | 无排行榜页面 |
| 每日登录加分 | 无此逻辑 |
| RSS 输出 | 无 RSS / JSON Feed 生成器 |
| 邮件找回密码 | 页面已复刻，邮件流程未实现 |
| 主题标签 | 无标签体系 |
| 附件上传 | 无上传能力 |
| 私信 | 无站内信 |
| 头像上传 | 使用默认头像 |
| 第三方登录 | Google / Solana 未接入 |
| 投票（顶 / 踩） | `votes` 表已建，交互未接 |

[0.0.2]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.2
[0.0.1]: https://github.com/alicia1030su/v2ex-clone/releases/tag/v0.0.1
