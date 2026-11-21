# v0.0.20 会话交接：附件安全、灾难恢复与回复容量

> 分支：`release/v0.0.20-stable`
> worktree：`C:/Users/TYMO001/WorkBuddy/ai/_worktrees/v0020-release`
> 代码冻结基线 HEAD：`49455eb4`（后续仅文档/门禁修正，最终 SHA 以 Git 门禁为准）
> 日期：2026-11-21（GMT+8）
> 状态：**v0.0.20 候选验收中，未发布。**

## 一、授权边界

- v0.0.20 **尚未取得专属 A3/B1 授权**；v0.0.19 的一次性授权不延续。
- 未创建 Tag、未推送正式 GHCR 镜像、未创建公开 Release。
- R-01 保持 **DEFERRED / A3**；保留历史与披露不等于取得第三方素材授权。
- 不 force push、不改写历史、不移动或删除 Tag、不覆盖已发布 Release。
- 24 小时单实例连续运行仍为 `not-completed`，1 小时冒烟不替代 24 小时验证。

## 二、本轮实现

### P0-A 附件统一授权

- 用户上传文件从 `public/uploads` 迁往私有 `/app/data/uploads`。
- `/uploads/*` 统一经过数据库授权；Next Image optimizer 对附件 URL fail-closed。
- 附件状态 `active / superseded / deleted / purged` 与当前引用表共同决定可见性。
- 公共附件也使用 `private, no-store`，软删、隐藏节点和替换头像后立即撤销。

### P0-B 可回滚灾难恢复

- 新 bundle 使用 PostgreSQL custom-format dump 与 `pg_restore --single-transaction`。
- `manifest.env` 不再被 `source`，改为严格白名单解析。
- 恢复过程包含 scratch DB 重放、恢复前安全备份、旧卷逐文件校验、受控复制切换与 recovery marker。
- PostgreSQL 与 uploads Volume 明确按非跨资源原子边界处理；不确定状态不自动拉起 app。
- 新增恢复后附件双向对账，并把对账放在放流量之前。

### P0-C 附件状态机

- `reply_image_links` 表达当前引用，历史 `reply_id/used_at` 不再承担授权语义。
- 编辑移除、重新引用、删除与 purge 使用统一 advisory lock 顺序。
- purge worker 采用两阶段提交、锁超时重领与 tombstone；物理删除失败不会误写 purged。
- 迁移仅按严格 Markdown 语法保守回填历史引用。

### P0-D 部署运维与 P1 容量

- 根 Compose 与发行 Compose 的 uploads 卷统一为 `/app/data/uploads`。
- `health-check.sh`、`update.sh`、旧版上传迁移与归档攻击面校验同步收口。
- 父回复链改为递归 CTE 批量加载，10000 回复真库与七种浏览器展示模式通过。
- 新增 purge queue 到期索引与 `EXPLAIN ANALYZE` 取证工作流。

## 三、当前测试基线

- 类型检查：通过。
- 单元与静态测试：候选 CI 复跑中；历史版本数字不得当作本版结论。
- 生产镜像附件授权攻击矩阵：35/35 通过。
- 真实 Docker 灾难恢复韧性矩阵：通过。
- 10000 回复容量与查询计划工作流：通过。
- Docker/Redis 九项验证：通过。
- 三浏览器 E2E 与视觉回归：上一代码提交通过，最终候选复跑中。
- 双基线升级：`v0.0.4 → v0.0.20` 与 `v0.0.19 → v0.0.20` 各 18 项，合计 36/36 通过。
- 升级细节见 `docs/UPGRADE_VERIFICATION_v0.0.20.md`。
- 测试报告见 `docs/TEST_REPORT_v0.0.20.md`。

## 四、Go/No-Go

- **当前 No-Go（正式发布）**：缺少 v0.0.20 专属 A3/B1，且最终候选全量门禁尚未全部归档。
- **候选验证 Go**：可继续执行版本同步后的 CI、候选 ZIP 隔离安装与异机恢复验证。
- 24 小时连续运行未完成，不得在最终报告中写成“长期稳定性已验证”。
