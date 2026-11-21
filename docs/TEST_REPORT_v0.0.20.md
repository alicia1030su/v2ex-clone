# v0.0.20 测试与验收报告（候选态）

> 状态：**候选验收完成，尚未发布**
> 候选源码 SHA：`bbdb74ee45023e5e028e7c732d37abbde60e20e6`
> 发布授权：**未取得 v0.0.20 专属 A3/B1**

## 一、最终门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| TypeScript / 单元 / 静态 | PASS | 94 文件 / 1122 单元；43 文件 / 501 静态；0 failed |
| 主 CI（API 契约、双基线升级、Docker 构建） | PASS | run `44954286774` |
| Chromium E2E | PASS | 296 passed |
| 三浏览器跨视口 E2E | PASS | 15/15 分片（Chromium / Firefox / WebKit × 5 视口） |
| 组件级视觉回归 | PASS | 7 视口 × 3 浏览器 × 3 页面 |
| Docker/Redis 九项验证 | PASS | run `44954286802` |
| 生产镜像附件授权攻击矩阵 | PASS | 36/36，run `44954286735` |
| 真实容器灾难恢复韧性 | PASS | run `44954283248` |
| 10000 回复与查询计划 | PASS | run `44954283268` |
| 候选 ZIP + 镜像隔离安装 | PASS | run `44955667387` |
| 候选包四角色真实用户验收 | PASS | 41 PASS / 0 FAIL，run `44955671099` |
| 发布预演（只读） | PASS | 5/5 环节，含全部负向对照，run `44955674157` |
| 1 小时连续运行 | PASS | 3600 秒 / 60 次采样，run `44942159665` |
| 24 小时单实例连续运行 | **未完成** | 保持 `not-completed`，不以 1 小时替代 |

## 二、P0-A 附件授权

- 生产镜像运行层不存在 `/app/public/uploads`。
- uploads named volume 挂载到 `/app/data/uploads`，未挂载到 public。
- 当前头像、pending、公开 active、软删回复、hidden 节点、locked 主题、superseded、deleted、purged 全部按匿名 / 所有者 / 其他登录用户验证。
- 普通路由、Nginx 反向代理与 Next Image optimizer 均未发现授权绕过。
- 所有附件响应均为 `private, no-store` 或 404。
- 200 次附件 GET 延迟：**P50 3.8ms / P95 5.1ms / P99 6.2ms**。

## 三、P0-B 灾难恢复

- PostgreSQL custom-format dump + `pg_restore --single-transaction`。
- `manifest.env` 严格白名单解析，不执行不可信命令替换。
- scratch DB 重放、恢复前安全备份、旧卷逐文件校验、受控复制切换、recovery marker 与恢复后对账均已落地。
- 实跑通过：数据库断连、磁盘不足、卷切换后 SIGTERM、Docker daemon 重启。
- SIGTERM 返回 143；失败后目标指纹不变；旧 uploads 卷保留；恢复后附件对账通过。
- **边界**：PostgreSQL 与 Docker Volume 不是跨资源原子事务；不确定状态保留人工恢复点，不伪装自动回滚。

## 四、P0-C 附件状态机

- 覆盖 pending、绑定、编辑移除、重新引用、多回复、跨用户、旧 URL、软删、hidden、worker 崩溃重领、claim 锁竞争、宽限期与恢复后对账。
- 删除幂等；worker 重试不误删新有效附件；物理删除发生在 tombstone 之前但公开可见性已立即撤销。
- `v0.0.4 → v0.0.20` 与 `v0.0.19 → v0.0.20` 双基线升级各 18 项，合计 36/36 通过。
- 45 项业务指纹升级前后逐字节一致；v0.0.19 历史回复图片按严格 Markdown 引用回填为 active。

## 五、P0-D 与 P1

- 根 Compose 与发行 Compose 的 uploads 卷统一。
- `health-check.sh` 完整 bundle 校验、归档攻击面检查与附件对账通过。
- `update.sh` 校验私有卷挂载、属主、可写性并拒绝 legacy public 上传目录。
- v0.0.19 纯数据库 dump 只能走显式 DB-only 兼容路径。
- 10000 回复、七种展示模式、首屏与末页浏览器验证通过。
- 父回复链查询计划执行约 46ms；purge queue 到期索引真实存在。

## 六、候选产物

- `v2ex-clone-v0.0.20-candidate.zip`：195,484 字节
  - SHA256：`36cb1953b6fb2342f2989b1b6e0fd393ee802ca34307b0e6914135366ecb4287`
- `v2ex-clone-v0.0.20-candidate-image.tar`：248,896,512 字节
  - SHA256：`17af9f78712ace3c595ecbf362feaa0eeea3c23d33d9b905a5e5782b450e40d8`
  - 本地镜像 ID：`sha256:cd041ece87248aac441b265fba2d0b9b0e65828e7213a170ef265917d26edc2d`
- 候选镜像**未推送 GHCR**；候选产物保存在 GitHub Actions Artifact。

## 七、Go / No-Go

- **候选验收：GO**。安装、四角色、恢复、附件安全、性能与发布预演均通过。
- **正式发布：NO-Go（当前）**。缺少 v0.0.20 专属 A3/B1，且 24 小时单实例连续运行未完成。
- R-01 保持 `DEFERRED / A3`。
- 未创建 Tag、未推送正式 GHCR 镜像、未创建公开 Release、未改写历史。
