# v0.0.20 升级验证报告（双基线）

> 验证对象：`v0.0.4 → v0.0.20` 与 `v0.0.19 → v0.0.20`
> 验证脚本：`scripts/release/verify-upgrade-v0020.sh`
> 本地实跑环境：隔离 PostgreSQL 17（127.0.0.1:55440），非开发库

## 结论

两条基线均通过，汇总 **PASS=36 / FAIL=0**（每条基线 18 项）：

| 基线 | 升级前迁移 | 升级后迁移 | 索引数 | 业务指纹 | 结果 |
|---|---:|---:|---:|---:|---|
| v0.0.4 | 3 | 7 | 76 → 94 | 45 项逐字节一致 | PASS |
| v0.0.19 | 6 | 7 | 89 → 94 | 45 项逐字节一致 | PASS |

## 本版专项验证

- `0006_v020_attachment_lifecycle.sql` 成功应用，且连续重跑 3 次均幂等。
- `reply_images.state / purge_after / purged_at` 三列存在。
- `reply_image_links`、`attachment_purge_queue` 两张表存在。
- `reply_images_state_check` 约束存在。
- `reply_image_links_attachment_idx`、`attachment_purge_queue_due_idx` 两个复合索引存在。
- v0.0.19 基线的历史回复图片按严格 Markdown 引用回填为 `active` 当前链接。
- v0.0.4 基线没有历史 `reply_images`，未产生猜测性附件链接。
- 备份后恢复到独立数据库，结构指纹与业务指纹均与升级后数据库完全一致。

## 边界

- 本报告证明数据库层升级、数据保真、迁移幂等与数据库备份恢复。
- 容器级升级、附件卷切换与异机恢复由候选安装、附件攻击矩阵和 DR 韧性工作流分别取证。
- 24 小时单实例连续运行仍未完成；1 小时冒烟不替代 24 小时验证。
