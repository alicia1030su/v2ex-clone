# 全量 E2E 复验结果（v0.0.4，最终提交态）

> ✅ **最终权威结论（修复后重跑）：153 passed / 0 skipped / 0 failed（10.0m，exit=0）**
> 命令同上；日志 `C:/Users/TYMO001/AppData/Local/Temp/e2e-after-fix.log`。
> 关注用例修复后不再被跳过，153 条全部真实执行并通过。
> **下文 §「真实输出」是修复前的第一轮结果，作为历史证据保留，不回写。**

> 时间：2026-11-04 · 服务：`http://localhost:3021`（隔离库 `v2ex_e2e_v004`）
> 命令：`ENV_FILE=.../v004e2e.env LOCAL_BASE=http://localhost:3021 BROWSER_CHANNEL=chromium npx playwright test --reporter=list`
> 环境：`retries: 0`、`fullyParallel: false`、单 project（chromium 1280×900）

## 真实输出

```
  1 skipped
  152 passed (14.1m)
```

- `--list` 枚举 **153 条 / 11 文件**；运行时 **152 通过 + 1 跳过 = 153**，**0 失败**。
- 关键路径全部通过：游客/普通用户/版主/管理员四身份 UI（`v004-four-roles-ui.spec.ts` 8 条）、
  内容互动 10 条、账户后台 20 条、API 契约 17 条、端点冒烟 31 条（29 个 GET 路由 + 2 条格式断言）。
- 端点冒烟对 29 个 GET 路由逐一端点断言「不返回 5xx」，全部通过。
- 管理员「封禁 → 解封」真实点击流（18.7s）、版主主题管理点击流（11.1s）均通过。

## 关于 1 条 skipped（已精确定位，不是推测）

用 `--grep "窗口过期后计数归零|关注后出现在关注列表"` 单独复跑两个候选，真实输出：

```
Running 2 tests using 1 worker
  ok 1 [chromium] › security-regression.spec.ts:125:3 › 窗口过期后计数归零而非无限累积 (2.0s)
  -  2 [chromium] › v004-account-admin.spec.ts:191:3 › 关注：关注后出现在关注列表… 
  1 skipped
  1 passed (15.0s)
```

- 跳过的**唯一**用例：`e2e/v004-account-admin.spec.ts:191`「关注：关注后出现在关注列表，
  取消后移除，重复关注幂等」。
- 触发条件（源码 L212-216）：测试从 `/settings` 页 `body` 文本用 `/@([a-z0-9_]+)/i`
  提取目标用户名，匹配不到就 `test.skip(true, '无法确定目标用户名')`。
- ⚠️ **这不是「预期跳过」，而是一个真实的覆盖缺口**：设置页没有渲染出 `@用户名`
  格式时，关注链路的三条断言（关注列表出现 / 取消后移除 / 重复关注幂等）
  **本轮没有被验证**。另一个候选「限流窗口重置」实跑通过，排除它。
- 该缺口已列入 `docs/ACCEPTANCE_CHECKLIST_v0.0.4.md` 的遗留项，
  **不得把 152 passed 表述为「关注功能已验收」**。

## 结论

**全量 E2E 152 passed / 1 skipped / 0 failed** —— 0 失败可作为本轮验收依据，
但需连同上述 1 条跳过所代表的覆盖缺口一起披露。
注意：`--list` 的 153 是枚举口径，「全绿」指 0 失败；既不能把 153 说成
「153 条全部通过」，也不能把 152 passed 说成「所有功能都已覆盖」。

---

## 后续修复（同一天，不改变上面的历史记录）

上节记录的 1 条 skipped **已修复**：`e2e/v004-account-admin.spec.ts:191` 改为从
`/api/users/me` 取确定性目标 id，删除 `test.skip`，并把标题宣称却从未执行的
三条断言（关注后出现 / 重复关注幂等 / 取消后移除）全部补齐。用例标题已标注
「**API 层，UI 无入口**」，因为全仓 `src/` 下没有关注按钮组件（另登记 R-24）。

```
ENV_FILE=... LOCAL_BASE=http://localhost:3021 BROWSER_CHANNEL=chromium \
  npx playwright test e2e/v004-account-admin.spec.ts --grep "关注后出现在关注列表"
→ 1 passed (9.8s)     npx tsc --noEmit → 零错误
```

**注意**：上面的 `152 passed / 1 skipped` 是**修复前**的全量运行结果，作为历史证据保留；
修复后该用例已不再被跳过。全量 E2E 未在修复后重跑（单条已实跑通过），
因此**不宣称「153 条全部通过」**。

---

## 最终权威结果（修复后重跑，2026-11-04）

```
ENV_FILE=... LOCAL_BASE=http://localhost:3021 BROWSER_CHANNEL=chromium npx playwright test --reporter=list
→ 153 passed (10.0m)      playwright exit=0
```

- `--list` 枚举 **153 条 / 11 文件**，运行时 **153 通过 / 0 跳过 / 0 失败**，两者一致。
- 关注用例（修复 R-23 后）已真实执行三条断言并通过，不再静默跳过。
- 四身份 UI 8 条、端点冒烟 31 条（29 个 GET 路由 + 2 条格式断言）全部通过。
- 管理员「封禁 → 解封」真实点击流（13.6s）、版主主题管理点击流（10.9s）通过。
- 注意：R-24（关注功能无 UI 入口）与 R-21（管理员无 `/admin` 入口）是**产品缺口**，
  不是测试失败；相关用例已如实标注为「UI 缺口实证」，不作为功能已实现的证据。
