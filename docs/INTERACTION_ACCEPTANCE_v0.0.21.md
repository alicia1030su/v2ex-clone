# v0.0.21 交互验收报告

> 状态：交互契约 **completed**；官方视觉像素一致性仍为 **UNVERIFIED / No-Go**。
> 源码候选：`3d88b56dba90a122556036b7f547074355bd248d`。
> QA 交互测试提交：`a121fdab7bfc04a2f7062fd4182b4f5c2c7cf4cf`。
> 运行时：Node `22.23.4`、Windows 11、Playwright 1.64.1、Edge/Chromium、单 worker。
> 数据库：既有隔离 PostgreSQL `127.0.0.1:55440/v2ex_test_base`；Redis 为空，走 PgKV。

## 1. 执行门禁

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript `--noEmit` | PASS | `docs/evidence/v0.0.21/interaction/guard9-final/` |
| visual matrix static | PASS，3/3 | 540 条唯一记录、P0 UNVERIFIED 阻断、无视觉百分比声明 |
| 新增 interaction contract | PASS，15/15，0 skipped | `docs/evidence/v0.0.21/interaction/results.json` |
| visual contract | PASS，95/95，0 skipped | `docs/evidence/v0.0.21/visual-contract/results.json` |
| 资源守护 | PASS | 所有 Next/Playwright 重任务经 `tools/dev-memory/run.mjs`，串行执行 |
| 资源报告 schema | PASS，210/210 | preflight/lease/monitor/cleanup JSON 经 Ajv 校验，0 invalid |

最终交互运行监控：峰值树 RSS **1456.8 MiB**、wall-clock **36123.4 ms**、退出码 **0**、cleanup 非 ABORTED。最终视觉契约运行监控：峰值树 RSS **1299.7 MiB**、wall-clock **61378.5 ms**、退出码 **0**、cleanup 非 ABORTED。

## 2. 交互通过矩阵

| 场景 | 结果 | 真实路径 |
|---|---|---|
| 搜索建议与提交 | PASS | 输入 `claude` → 建议出现 → Enter → `/go/search?q=claude` |
| 登录成功/失败 | PASS | 错误密码显示错误；正确 seed 账号进入设置页 |
| 注册校验与成功 | PASS | 两次密码不一致可见错误；唯一用户完成注册 |
| 找回密码校验 | PASS | 非法邮箱显示格式错误；未知邮箱返回防枚举提示 |
| 七种回复模式 | PASS | classic/quote/badge/nested/tree/lines/excerpt 全部即时切换 |
| 主题发布/编辑/删除 | PASS | UI 发布 → 编辑保存 → 删除后游客 404 |
| 赞同 | PASS | 真实按钮 `aria-pressed` 状态切换 |
| 收藏/书签 | PASS | 收藏状态更新并在 `/bookmarks` 展示 |
| 感谢 | PASS | 跨用户感谢后按钮变为取消感谢 |
| 举报 | PASS | 内联表单提交后显示已举报 |
| 通知已读 | PASS | 单条未读数减一；全部已读后未读 0 |
| 设置保存/校验 | PASS | 资料保存并刷新保持；密码不一致显示可见错误 |
| 管理员/版主入口 | PASS | 管理后台、用户/举报 tab 与角色可见性 |
| 明暗主题 | PASS | dark/light 即时生效且刷新保持 |
| 键盘 | PASS | Tab 聚焦搜索、Enter 提交、Space 投票 |
| 200% CDP scale | PASS | `/`、`/signin`、`/t/1` 无横向溢出 |
| 窄屏触摸 | PASS | 375×812 touch 搜索、主题切换、主题页无溢出 |

## 3. 失败与修正记录

以下是 QA 测试代码问题，均已修正后复跑，未修改产品源码：

1. 首次 wrapper 位于系统临时目录，无法解析 `dotenv`；改为读取同一 `.env.test` 的受控 env 加载器。
2. 找回密码测试误匹配 Next route announcer 的空 `role=alert`；改为精确 `.problem`/`.toast`，并仅对目标表单设置 `novalidate` 以触发客户端邮箱校验。
3. 通知初始可能只有一条未读，单条已读后“全部已读”按钮按设计禁用；改为构造两条通知，再验证单条减一与全部归零。
4. `getByLabel('新密码')` 同时匹配“确认新密码”；改为 `exact: true`。
5. 测试口令字面量被凭据门禁拒绝；改为从 `SEED_DEMO_PASSWORD` 读取。

最终结果为 **15 passed / 0 failed / 0 skipped**，不是用早期部分运行冒充。

## 4. 视觉与发行边界

- 95 条视觉契约通过只证明内部布局、运行时噪声和焦点路径，不证明官方像素一致性。
- `docs/VISUAL_FIDELITY_MATRIX_v0.0.21.md` 的 540 条记录仍全部 `UNVERIFIED`，P0 阻断保持。
- 本报告不构成 24h soak、完整跨浏览器矩阵、完整 CI 或正式发行授权。
