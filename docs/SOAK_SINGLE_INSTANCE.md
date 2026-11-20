# 单实例连续运行验证工具（v0.0.18）

> **当前状态：24 小时单实例连续验证 = `not-completed`。**
> 本版本只交付工具、工作流与真实短时运行证据，不宣称完成 24h。
> 分段累计 ≠ 单实例连续；GitHub-hosted runner 单 job 上限约 6 小时。

## 1. 它证明什么

`scripts/soak/single-instance.mjs` 在观测期内反复同时核对：

1. `/api/health/ready`：HTTP 200、`status=ready`、数据库就绪；配置了 Redis 时 Redis 必须就绪；
2. `/`：关键页面 HTTP 200；
3. `/api/admin/ops`：应用实例 ID、PID、启动时间、运行时长、数据库/Redis/PostgreSQL 状态；
4. OS 进程身份：Linux 使用 boot ID + `/proc/<pid>/stat` 启动 ticks；Windows 使用进程 StartTime；
   macOS 使用 `ps lstart`；
5. PostgreSQL 数据指纹：对 `users` / `topics` / `replies` 全行内容做确定性 MD5 聚合；
6. 中途备份恢复探针：`pg_dump` → 新建随机临时库 → `pg_restore` → 指纹比对 → 删除临时库。

应用侧 `instanceId/pid/startedAt` 与 OS 进程启动身份必须全程不变。仅 PID 相同不足以排除
PID 复用；仅应用实例 ID 相同也不足以证明 HTTP 一定由被监控进程提供。

`APP_REPLICAS` 必须显式声明为 `1`。未声明或多副本时无法宣称单实例通过。

## 2. 状态与退出码

| status | 含义 | 退出码 | claim24h |
|---|---|---:|---|
| `pass` | 同一实例连续 >= 24h，全部必需证据齐全且无失败 | 0 | `true` |
| `fail` | HTTP/依赖失败、实例漂移、指纹不一致、备份恢复失败 | 1 | `false` |
| `not-completed` | 不足 24h，或指纹/探针缺失，不能下完成结论 | 3 | `false` |
| 参数错误 | 非法 URL、时长、路径或运行器上限 | 2 | `false` |

**禁止**把 `not-completed` 改写成 PASS，也禁止把多段 `not-completed` 相加后宣称单实例 24h。

## 3. 在获授权的持久环境运行 24h

前置条件：

- 应用已构建并运行，`APP_REPLICAS=1`；
- 隔离测试环境已设置 `APP_RUNTIME_ENV=test`、`TEST_ENV_ISOLATED=1`、`DISABLE_CAPTCHA=1`，
  因为工具使用管理员账号密码登录；**不得为运行本工具在生产环境关闭验证码**；
- 管理员账号可访问 `/api/admin/ops`；
- 已安装 `psql`、`pg_dump`、`pg_restore`、`createdb`、`dropdb`；
- PostgreSQL 账号有创建/删除**临时库**的权限；
- 运行器不会在 24h 内回收进程。

```bash
SOAK_ADMIN_USERNAME=admin \
SOAK_ADMIN_PASSWORD='...' \
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=v2ex PGDATABASE=v2ex_soak \
PGPASSWORD='...' \
node scripts/soak/single-instance.mjs \
  --base http://127.0.0.1:3000 \
  --duration-ms 86400000 \
  --interval-ms 60000 \
  --out soak-evidence
```

口令通过环境变量传入，不写入命令行参数、样本或摘要。Cookie 只驻留进程内存。
数据指纹只输出 MD5，不输出用户数据、口令哈希或连接串。

## 4. GitHub Actions 分段工作流

`.github/workflows/soak-single-instance.yml` 仅支持 `workflow_dispatch`：

- 最长 330 分钟，job 超时 340 分钟；
- 每段新建隔离 PostgreSQL / Redis、迁移、种子、构建并启动一个新应用实例；
- `scripts/soak/run-workflow-segment.mjs` 用 Node 完成启动、就绪等待、工具调用与清理，
  不在 workflow 中拼接多行 shell；
- 330 分钟段会以 `not-completed` / 退出码 3 结束，step 预期判红；
- `if: always()` 仍上传 `summary.json`、`samples.jsonl` 与日志尾部。

该工作流用于验证工具链路与采集单段证据，**不是** 24h 通过门禁。

## 5. 证据格式

输出目录包含：

- `samples.jsonl`：逐次采样，含 HTTP 状态/耗时、应用实例身份、OS 进程资源、错误码；
- `summary.json`：真实观测时长、实例身份、采样数、峰值资源、指纹、备份恢复探针、
  `status`、`claim24h` 与原因码；
- Actions 分段另有 `app-log-tail.txt`。

未采集到的资源写 `null` / `available:false`，绝不写成 `0`。
已有非空证据目录默认拒绝覆盖；确需重跑时显式加 `--overwrite`。

## 6. 边界与风险

- 静态/短时测试不能证明 24h 稳定性；必须由持久环境真实跑满；
- 数据指纹覆盖三张核心表，不覆盖对象存储、Redis 值或全部业务表；
- 全行指纹在数据量较大时有性能成本，应使用隔离的小型验证库；
- 备份恢复探针只操作随机命名的临时库，但数据库账号权限仍应最小化；
- 本地 Windows 无 Docker daemon，因此真实 Docker 长跑需 GitHub runner 或其它授权环境；
- R-01 仍为 `DEFERRED`，本工具不改变该风险裁决。

## 7. 测试

```bash
node node_modules/vitest/vitest.mjs run \
  --config vitest.static.config.ts \
  tests/static/v018-soak-tool.spec.ts
```

覆盖：真实 OS 进程采样、真实 HTTP 短时运行、实例漂移、HTTP 失败、时长不足、
数据指纹不一致、合成 24h 判定边界、备份恢复命令链、工作流上限与文档接线。
