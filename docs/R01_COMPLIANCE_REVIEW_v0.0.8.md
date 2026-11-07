# R-01 历史合规只读复核报告（v0.0.8）

> **日期**：2026-11-07
> **执行性质**：**纯只读调查**。本轮**未执行**任何历史改写、force push、
> Tag 移动/删除、Release 修改、仓库可见性变更或删除操作。
> **状态**：R-01 维持 **DEFERRED**（等待主人单独授权）。

---

## 一、结论速览

| 项 | 结果 |
|---|---|
| 根提交 | `75c9508`（一次性引入 81 个受控证据文件） |
| 当前 `master` 树中原站素材 | **0 个** ✅ |
| `master` 历史对 `75c9508` 的可达性 | **不可达** ✅（说明历史清理已对 master 生效） |
| 仍可达的 refs | **4 个已发布 Tag + 6 个远端分支** ⚠ |
| 受影响对象总数 | **81 个**（assets 2 / html 46 / screenshots 20 / visual 13） |
| 本轮新增的**重要区分** | `src/app/globals.css` 与原站 `combo.css` **选择器名重叠 73 个，但完全相同的声明块 = 0** ⇒ 本站样式是**独立实现**，不构成原站代码镜像 |
| 授权状态 | **未获授权** ⇒ 本轮只做调查与方案准备 |

---

## 二、受影响对象完整登记（81 个，不止 HTML/CSS/JS）

任务书明确要求「不能只审计 HTML/CSS/JS，而遗漏历史截图、差异图和其他第三方素材」。
本轮**全量枚举** `75c9508` 的 `docs/evidence/` 树：

| 类别 | 数量 | 路径 | 性质 |
|---|---|---|---|
| 原站 CSS | 1 | `docs/evidence/assets/combo.css`（147,710 B） | **第三方版权** |
| 原站 JS | 1 | `docs/evidence/assets/combo.js`（840,606 B） | **第三方版权** |
| 原站 HTML 快照 | 46 | `docs/evidence/html/*.html` | **第三方版权**（含完整页面结构） |
| 像素级参考截图 | 10 | `docs/evidence/screenshots/ref-*.png` | **第三方版权**（原站界面像素） |
| 本站对照截图 | 10 | `docs/evidence/screenshots/local-*.png` | 本站产物（风险低，但仍含原站界面像素） |
| 差异热力图 | 10 | `docs/evidence/visual/diff-*.png` | **混合**（含原站像素 + 本站叠加） |
| 视觉测量数据 | 3 | `docs/evidence/visual/*.json` | 派生数据（含原站几何度量） |
| **合计** | **81** | | |

**扩展检查**：除 `docs/evidence/` 外，根提交中唯一含 CSS/JS/HTML 的文件是
`src/app/globals.css`（19,677 B）—— 已单独审计（见 §三）。

---

## 三、新增区分：本站样式是独立实现（不是原站代码副本）

| 度量 | 结果 |
|---|---|
| `globals.css` 选择器数 | 85 |
| `combo.css` 选择器数 | 562 |
| 选择器**名**重叠 | 73（如 `#Main` / `#Top` / `.cell` / `.ago`） |
| **完全相同的声明块** | **0**（`globals.css` 139 个规则块 vs `combo.css` 1494 个，交集为空） |

**解读**：选择器名重叠属**通用前端词汇**（`#Main`、`#Top`、`.cell` 等是
布局惯用命名），而**没有任何一条声明完全相同** ⇒ 本站样式是独立编写的，
不构成「原站 CSS 副本」。这条区分很重要：**清理不应扩大到
`src/app/globals.css`**（那会破坏产品功能且无版权收益）。

---

## 四、可达性现状（只读实测）

```
master                    → 不可达 ✅
v0.0.1 / v0.0.2 / v0.0.3 / v0.0.4  → 可达 ⚠（4 个已发布 Tag）
feat/v0.0.3-complete              → 可达 ⚠
feat/v0.0.4-high-fidelity         → 可达 ⚠
feature/v0.0.2-hardening          → 可达 ⚠
fix/p0-review-hardening           → 可达 ⚠
fix/v0.0.4-release-checkout       → 可达 ⚠
fix/v0.0.4-release-pipeline       → 可达 ⚠
```

**新约束（本轮量化）**：即使改写 `master` 与所有开发分支，
**4 个已发布 Tag 仍会让 81 个对象可达** —— 与「不得移动已发布 Tag」直接冲突。
这与 v0.0.4 隔离演练的结论一致，但本轮把**受影响的 Tag 数量从 3 个
精确到 4 个**（v0.0.4 是之后发布的）。

### 远端实际暴露面

`https://raw.githubusercontent.com/alicia1030su/v2ex-clone/<sha>/docs/evidence/assets/combo.js`
对任何上述可达 SHA 都会返回 HTTP 200（匿名、无凭据）—— 本轮**未重复发起**
匿名请求（避免无意义的外部访问计数；v0.0.4 已实测过该路径）。

---

## 五、清理方案（与 v0.0.4 演练一致，本轮细化）

### 方案 A（推荐）：授权「改写全部 refs 历史 + 重建 4 个 Tag」

- 技术可行性：v0.0.4 已在**本地隔离副本**验证（filter-branch 后引用对象
  1118 → 1083、当前树文件清单差异 0 行、`tsc --noEmit` 零错误）。
- 本轮细化：受影响 Tag 从 3 个增至 **4 个**（含 `v0.0.4`）。
- 不可逆点：Tag SHA 会变 ⇒ **已发布 Release 的 tag 指向会失效**，
  需同步处理 4 个 Release 的引用关系。
- **需要主人单独授权**（属明令禁止的「改写远端历史」+「移动已发布 Tag」）。

### 方案 B：授权「仅删除 4 个 Tag（不动历史）」

- 不解决 `75c9508` 在**分支**上的可达性 ⇒ 只解决一部分。
- 优点：影响面小（Release 页面失效，不改任何提交历史）。

### 方案 C：接受风险 + 显著披露

- README / Release Notes 显著位置声明「Git 历史中仍可取回原站素材」；
- 改用非 V2EX 命名的项目标识（需评估改名对已有链接/依赖的影响）。

---

## 六、执行顺序建议（方案 A）

1. **冻结发布**：清理期间不发新 Tag、不发 Release（当前 v0.0.8 已停在候选阶段，正好是窗口）。
2. 全量备份：`git clone --mirror` + 导出 refs 清单 + 导出 Release 元数据。
3. 在**隔离副本**执行 filter-repo（**不是** filter-branch）：
   ```
   git filter-repo --path docs/evidence/html --path docs/evidence/assets \
                   --path docs/evidence/screenshots --path docs/evidence/visual \
                   --invert-paths
   ```
   ⚠️ **不要**包含 `src/app/globals.css`（见 §三：它是独立实现）。
4. 验证：当前树文件清单与原 master **逐文件一致**（期望差异 = 仅被删的 81 个证据文件）；
   `tsc --noEmit` / `next build` / 单元测试 / 核心 E2E 全绿。
5. 重建 4 个 Tag（同名、同注释、指向清理后的对应提交）。
6. **逐一更新 4 个 Release 的 tag 指向**（Release 本身不删不改内容）。
7. 强推全部 refs（含 tags）—— **唯一不可逆步骤，单独授权**。
8. 验证：任一 SHA + 上述路径的 raw 请求应返回 404。

---

## 七、回滚方案

- **不可逆点只有一个**：强推。强推前的所有对象都保存在
  `git clone --mirror` 备份中 ⇒ 可完整恢复 refs 与 Tag。
- Release 元数据可单独备份/恢复（GitHub API）。
- 建议：强推后**立即**验证（raw 404 + refs 清单一致 + Release 指向正确）。
- 若强推后发现问题：再次强推备份镜像的 refs（需要再次授权，但技术上无额外风险）。

---

## 八、给 GitHub Support 的资料（若选择方案 A/B 且需要官方协助）

1. 仓库：`alicia1030su/v2ex-clone`（Public）
2. 受影响根提交 SHA：`75c9508`（完整 SHA 见 `git rev-parse 75c9508`）
3. 受影响路径：`docs/evidence/{html,assets,screenshots,visual}/`（4 个目录，81 个文件）
4. 受影响 refs：4 个 Tag（v0.0.1~v0.0.4）+ 6 个分支（清单见 §四）
5. 已发布 Release：4 个（v0.0.1~v0.0.4）
6. 请求事项：协助清理上述 refs 的历史对象（因部分对象已被 Release 引用）
7. 附件：refs 清单（`git for-each-ref` 输出）、`git ls-tree -r 75c9508` 输出、
   Release 元数据导出

---

## 九、本轮**未执行**的事项（明确边界）

- ❌ 远端历史改写 / `git filter-repo` / `git filter-branch`（任何形式）
- ❌ force push（任何 refs）
- ❌ 删除或移动任何已发布 Tag
- ❌ 删除或修改任何已发布 Release
- ❌ 删除仓库
- ❌ 变更仓库可见性（仍为 Public）

**上述全部需要主人单独授权；本轮只做只读调查与方案准备。**
