# E2E 用例数口径定义（v0.0.4）

> 目的：解决验收核查 D-08「144 条 / 78 条 / 145 条 / 静态 36 条多个数字并存」。
> 权威依据：`docs/evidence/e2e/test-list-v0.0.4.txt`（`npx playwright test --list` 的真实输出）。

## 一、三种计数口径（不要混用）

| 口径 | 数字 | 定义 | 用途 |
|---|---|---|---|
| **静态声明数** | 源码里 `test(` / `test.describe` 内的用例声明 | 含循环，一个 `for` 循环只算 1 条 | 读代码时的粗略估计，**不作为验收数字** |
| **运行时展开数**（权威） | `playwright test --list` 的 `Total:` | 循环展开后的真实用例数 | ✅ **唯一验收口径** |
| **历史描述数** | 提交信息 / 阶段报告里的「144 条」 | 第四阶段收尾时的快照 | 历史记录，已被后续新增用例超越 |

## 二、当前实测（`--list` 输出，2026-11-05 重新取证）

```
Total: 154 tests in 11 files
```

| 分组 | 文件 | 运行时用例数 |
|---|---|---|
| 原有 6 文件（v0.0.3 遗留） | `auth` 8 / `feature` 16 / `pagination` 6 / `security-regression` 19 / `security` 10 / `topic` 8 | **67** |
| v0.0.4 新增 4 文件 | `v004-account-admin` **21** / `v004-api-contract` 17 / `v004-content-interaction` 10 / `v004-endpoint-smoke` 31 | **79** |
| 四身份 UI（第二/三轮） | `v004-four-roles-ui` | **8** |
| **合计** | **11 文件** | **154** |

> ⚠️ **`ed385cf` 的增量为 +1**：新增的「关注（UI）：真实点击关注/取消，刷新后状态持久化，关注列表出现该用户」
> 落在 `e2e/v004-account-admin.spec.ts`（该文件由 20 条增至 **21** 条）；
> `v004-four-roles-ui.spec.ts` 的两条「UI 无入口」用例在 `ed385cf` 中被**改写为正向断言**（条数不变，仍 8 条）。
>
> ✅ **V4-20 修复轮（`bddb3d0`）未增删 E2E 用例** —— 该轮只改**选择器**（`input[name="nodeName"]` → `input#node_slug`，
> `input[name="nodeTitle"]` → `input#node_title`；`e2e/helpers.ts` 标题框改用 `input#title`），
> **分母仍为 154 条 / 11 文件**。新增的 `tests/form-name-shadowing.spec.ts` 属**单元测试**（不计入本表）。
>
> ✅ **当前权威实测结果 = 154 passed / 0 failed / 0 skipped（11 文件，3.9m）** —— V4-20 修复后本地实跑全绿。
> **修复前的历史快照**：CI run `41873009808` = `153 passed | 1 failed | 154 total`（唯一失败 = 节点申请 UI 提交链断裂 V4-20 / R-27）；
> ****CI 已复验通过**（run `41949555282`，SHA `bddb3d0`：unit ✅ 194 passed/16 文件、e2e ✅ 154 passed/0 failed、docker ✅）**。

### 为什么历史文档写「新增 77 / 总计 144」

- 「新增 77」是第四阶段提交信息里的**静态声明数近似值**：10 + 19 + 17 + 31 = 77。
  但 `--list` 实测 `v004-account-admin` 是 **20** 条（不是 19），
  四个 v004 文件合计 **78** 条 —— 差 1 来自「静态声明」与「运行时展开」的口径差异，
  **不是测试丢失**。
- 「总计 144」= 67 + 77，同样是静态口径相加的结果，**没有对应的 `--list` 输出存档**。
- 第二轮补了 8 条四身份 UI 用例后，`--list` 实测 **153 条**；
  `ed385cf`（补齐八项 UI 缺口）再 +1 ⇒ **154 条**。

**结论：以 `--list` 的 154 条为准**。「144 / 77 / 153」不再作为验收数字；若引用，
必须注明是「第四阶段提交信息里的静态口径历史值，无 `--list` 存档」或「`ed385cf` 之前的时点」。
历史提交信息不予改写（git 历史不重写），以本文件作为口径勘误。

## 三、为什么用例数会浮动

- `e2e/v004-endpoint-smoke.spec.ts` **从源码自动发现全部 GET 端点**并逐一端点生成用例。
  当前发现 **29 个 GET 路由** → 31 条用例（含 2 条固定用例）。
  新增/删除一个 GET 路由，用例数就会变 —— 这是**设计特性**（新端点自动纳入冒烟范围），
  不是缺陷。
- 因此**任何写死的「XX 条」都应视为某一时点的快照**，正式验收必须重新跑
  `npx playwright test --list` 并把输出归档。

## 四、复现命令

```bash
ENV_FILE=C:/Users/TYMO001/AppData/Local/Temp/v004e2e.env \
LOCAL_BASE=http://localhost:3021 \
BROWSER_CHANNEL=chromium \
npx playwright test --list > docs/evidence/e2e/test-list-v0.0.4.txt 2>&1
```

`--list` **不执行测试、不写数据库**，只是枚举，可随时安全重跑。

## 五、UI 层 vs API 层的口径（同样重要）

154 条里，`v004-api-contract`（17）与 `v004-endpoint-smoke`（31）是**纯 API 层**
（`page.goto` = 0），共 48 条。它们对「端点不 5xx」很有价值，但
**不得计入「真实浏览器 UI 验收」的覆盖数**。

真实 UI 点击流由其余文件承担，其中 `v004-four-roles-ui.spec.ts` 专门补齐
游客 / 普通用户 / 版主 / 管理员四身份的 `page.goto` + `locator` 断言。
