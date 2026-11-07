# V2EX Clone v0.0.9 正式发布流水线门禁设计评审

> 评审人：架构师 高见远（software-architect）
> 评审性质：**只读设计评审**。未执行、未触发、未修改任何 workflow / 源码 / 文档 / git 对象；未 commit / push / 建 Tag / 建 Release / 触发 GitHub Actions / 重置工作区。唯一写入文件为本报告。

---

## 0. 评审基线、范围与限制

### 0.1 基线

| 项 | 值 |
|---|---|
| 仓库 | `C:/Users/TYMO001/WorkBuddy/ai/v2ex-clone` |
| master 基线 | `af616356004877005153ad39bc187c3aed06e082`（`release.yml` 2067 行） |
| PR #32 候选（评审主基线） | `fix/v0.0.9-soak-design-and-release-notes` HEAD `8d6df8af771614a02c887b5c9ce707602c90e9d6`（`release.yml` 2126 行，blob `e792946b93e4234281894838db1ccc78db03a9da`） |
| 评审主对象 | `.github/workflows/release.yml`（11 个 job：resolve-tag / preflight / code-checks / security-scan / unit-tests / **e2e-tests** / build-image / deploy-verify / package / publish-release / verify-release） |
| 参考对象 | `candidate-verify.yml`、`install-verify.yml`、`soak-test.yml`、`soak-segment.yml`、`deploy/VERSION`、`deploy/.env.example`、`deploy/docker-compose.yml` |

**PR32 与 master 的差异结论**（`git diff af616356 8d6df8a -- .github/workflows/release.yml`）：

- 仅 4 个 hunk，全部落在 **Release Notes 模板区**（master `L1594–L1717` ↔ PR32 `L1594–L1776`），净 `+59` 行：新增 v0.0.9 更新内容、功能清单、已知限制、升级/回滚说明、稳定性真实状态表、R-01 披露，删除旧的「本版本已实现/未实现」与身份覆盖缺口清单。
- **`on:` 触发段、`workflow_dispatch` 输入、`concurrency`、`permissions`、全部 11 个 job 的所有 `if:` / 校验 / 构建 / 发布逻辑逐字相同**。PR32 对 `release.yml` 没有改动任何发布门禁判断。
- **行号映射规则**：master `L1–L1593` 与 PR32 完全一致；master `L1718` 以后 = PR32 行号 − 59。例：master `L1843` `PUBLISH=` ↔ PR32 `L1902`；master `L1881` `if: dry_run` ↔ PR32 `L1940`；master `L1778` 创建 Release ↔ PR32 `L1837`。
- 本报告下文所有 `Lxxx` **一律以 PR32 HEAD `8d6df8a` 的 `release.yml` 为准**。

### 0.2 限制与声明

1. **本机无 Docker daemon，无法本地实跑发布流水线**。全部结论来自静态代码审查、git 对象比对、仓库内历史实跑记录（`docs/RELEASE_PROCESS_v0.0.4.md`、`docs/SESSION_HANDOFF_v0.0.4.md`）以及 GitHub REST / gh CLI 官方文档核对。凡依赖运行时环境（runner 预装 gh CLI 版本、GitHub API 瞬时状态、Packages visibility）的判断，均标注置信度与「建议实跑确认」。
2. 评审期间其他成员在 PR32 分支追加了 commit `16805f2`（仅改 `e2e/v005-password-reset-flow.spec.ts`，+60 行），并新建未跟踪文件 `docs/SOAK_24H_FINDING_v0.0.9.md`。已核验：当前工作区 `release.yml` 的 blob 仍为 `e792946…`，与 `8d6df8a` **逐字节一致**，`git diff 8d6df8a HEAD -- .github/workflows/release.yml` 为空 ⇒ 本报告全部行号与结论不受影响。该新 commit 不属于本次评审基线，本报告未触碰它。
2b. 收尾复核时检测到**其他成员未提交的工作区改动**：`.github/workflows/soak-test.yml`、`deploy/.env.example`、`deploy/backup.sh`。其中 `deploy/.env.example` 把文件头「v0.0.4」改为「v0.0.9」——该改动**不属于基线 `8d6df8a`**（基线中 `L2` 仍为 v0.0.4），故 §2.7 与 N2 的描述以基线为准；若它随 PR32 合入，N2 的「文件头陈旧」一项可关闭，但「三者一致性零校验」的结论不变。其余两处改动同样未纳入本次评审范围，本报告未触碰任何一项。
3. 本报告**不对 R-01 合规风险本身、24h 长跑设计本身**作结论（属团队其他任务范围），仅评价「Release Notes 的声明」与「流水线实际门禁」之间的一致性。
4. 结论分级：**通过 / 缺陷 / 风险**。「缺陷」= 与需求或自身声明相矛盾、需改代码；「风险」= 当前不必然出错，但缺少兜底或与规约冲突。

---

## 1. 结论摘要

| # | 评审项 | 结论 | 关键证据行号 | 一句话 |
|---|---|---|---|---|
| 1 | push tag 白名单含 v0.0.9 | **通过** | `L42–L59`（PR32 / master 同为 `L55–L59`） | 两版均已列入 `- 'v0.0.9'`，PR32 未改动 |
| 2 | dispatch 输入语义 / 干跑不产生正式资产 | **缺陷（输入）+ 通过（写操作总体）** | `L60–L83`、`L1002–L1088`、`L1397–L1474`、`L1487`、`L1940` | `dry_run` 未声明 `type`，且 `package` 完全未消费它；但 GHCR / Tag / Release / 资产 / 公开均被正确挡住 |
| 3 | 干跑 / Draft / 公开 Pre-release 三态 | **缺陷** | `L1043`、`L1902–L1925`、`L1910–L1914` | Draft 阶段已把镜像推到公开 GHCR；流水线内没有「Draft → 公开」的可达路径；不会误发稳定版但实现是死代码 |
| 4 | Tag / Release 已存在性与补救路径 | **缺陷** | `L347`、`L398`、`L1533`、`L373–L384`、`L1578–L1587` | `if gh release view …; then` 把「查询失败」当成「不存在」＝fail-open；补救路径存在但 diff 范围不足 |
| 5 | 并发与重复触发 | **缺陷** | `L85–L88` | `group: release-${{ github.ref }}` 按 ref 分组，tag push 与 dispatch 落在不同组，无法阻止同一 Tag 被多 run 同时发布 |
| 6 | 构建上下文一致性 | **缺陷（阻断）** | `L259 / L462 / L493 / L791 / L863 / L985 / L1124 / L1409`、`L300–L315`、`L373–L384`、`L1029`、`L1050`、`L1039` | 全部从 master 检出；正式 push tag 路径**没有任何 diff 校验**，且镜像 label 把 `tag_sha` 伪造成构建 revision ⇒ 无法证明资产来自 Tag 提交 |
| 7 | 安装包内容与三者一致性 | **风险（当前内容干净）/ 缺陷（零校验）** | `L1418–L1422`、`L1426–L1430`、`L1432–L1464`、`L1711–L1712`、`deploy/*` | 当前三处版本号碰巧一致，但流水线零校验；Release Notes 声称「Digest 见本 Release 页面」而模板里根本没有 digest |
| 8 | 失败路径 / `\|\| true` / 0 测试 | **通过（主）/ 风险（次要）** | `L517`、`L545`、`L651–L666`、`L707–L713`、`L814`、`L949`、`L953 / L1379 / L1392` | 无 `continue-on-error`；所有 `\|\| true` 均有兜底；0 测试会被工具默认退出码挡住，但无显式用例数断言 |
| 9 | 发布后验证 verify-release | **缺陷** | `L977`、`L1932`、`L1940`、`L2002`、`L2060`、`L2102–L2103`、`L2119` | 只**打印** digest，从不与 build-image 输出核对；匿名下载仅 `publish=true` 时执行；权限过宽 |
| 10 | 是否具备可靠公开发布入口 | **否（阻断）** | `L392–L402`、`L1555–L1587`、`L1901–L1925`、`L2002`、`L2119` | 见 §5 场景推演 |

**总体判定：PR #32 合并后，`.github/workflows/release.yml` 不具备可靠的 v0.0.9 正式公开发布入口，且存在 5 项阻断发布级缺陷。建议冻结正式公开发布动作，先完成 §4 的阻断项修复。**

---

## 2. 逐项核实

### 2.1 push tag 白名单（评审项 1）— **通过**

| 版本 | 白名单内容 | 行号 | v0.0.9 |
|---|---|---|---|
| master `af61635` | `v0.0.2` `v0.0.3` `v0.0.4` `v0.0.9` | `L55–L59`（与 PR32 同号） | ✅ 已包含 |
| PR32 `8d6df8a` | 同上，含注释「v0.0.9：授权公开发布 Pre-release（一次性风险接受，R-01 维持 DEFERRED）」 | `L55–L59` | ✅ 已包含 |

证据：`git diff af616356 8d6df8a -- release.yml` 的 4 个 hunk 起点均为 `L1594` 以后，白名单段零差异；`git show af616356:…release.yml | sed -n '42,100p'` 复核一致。白名单为**精确匹配**（非 `v*`），符合 `L47–L54`「刻意摩擦」的设计意图。

次要风险（非阻断）：
- 白名单仍保留 `v0.0.2 / v0.0.3 / v0.0.4`（`L55–L57`）：重推旧 tag 会重新触发整条链，仅靠 `L398` 的「Release 已存在」闸门拦截；若该闸门失效（见 §2.4）会重复构建并可能覆盖 GHCR 同名标签。
- 文件头 `L4`、`L15` 仍写「v0.0.1 发布流水线 / push tag v0.0.1」，而白名单不含 `v0.0.1`；文档性陈旧，不影响行为。

---

### 2.2 workflow_dispatch 输入与干跑路径（评审项 2）

#### 2.2.1 输入定义与语义

| 输入 | 声明 | 默认值 | 类型 | 语义 / 问题 | 行号 |
|---|---|---|---|---|---|
| `version` | required: true | 无 | `string` ✅ | 待发布版本号，仅在 dispatch 生效；push 路径用 `GITHUB_REF_NAME`（`L268`） | `L62–L65` |
| `dry_run` | required: false | `true` | **未声明 `type`（默认 string）** ⚠️ | 「仅验证（不推送镜像、不创建 Release、不发布）」 | `L66–L69` |
| `publish` | required: false | `false` | `boolean` ✅ | 把 Draft 转公开 | `L70–L74` |
| `prerelease` | required: false | `true` | `boolean` ✅ | 公开形态；`false` = 稳定版（注释明确「不应发稳定版」） | `L75–L83` |

**缺陷 D-1（`dry_run` 类型与安全默认值）**：`L66–L69` 缺少 `type: boolean`，GitHub 按默认 `string` 处理，`default: true` 是 YAML 布尔字面量、依赖平台隐式转字符串。下游全部用字符串比较 `needs.preflight.outputs.dry_run != 'true'`（`L1015`、`L1043`、`L1074`、`L1128`、`L1487`、`L1940`），**只认小写 `"true"`**。若操作者在 UI 文本框里填 `True` / `TRUE` / `1` / `yes` / `是`，`preflight` 的 `L282` 原样输出，`!= 'true'` 全部成立 ⇒ **fail-open 到正式发布路径**（推 GHCR、建 Release、上传资产）。最小修复：补 `type: boolean`；并在 `preflight` 的 `L277–L285` 增加取值白名单（`true`/`false` 之外一律 `exit 1`）。

**缺陷 D-2（输入直插 shell）**：`L266` `VERSION="${{ inputs.version }}"` 与 `L282` `echo "dry_run=${{ inputs.dry_run }}"` 把 dispatch 输入**直接插值进 shell 脚本**，发生在 `L270–L273` 的格式校验之前；`version` 输入含 `"` + `;` 即可注入命令。`resolve-tag` 的 `L156–L158` 用 `env:` 传递则是正确写法。最小修复：改为 `env: VERSION: ${{ inputs.version }}` + `VERSION="$VERSION"`，与 `resolve-tag` 保持一致。（触发 dispatch 需仓库写权限，属中优先级安全缺陷，非发布阻断。）

#### 2.2.2 干跑逐 job 写操作矩阵（**任务点名的 build-image / package / publish-release / verify-release**）

`dry_run` 的传导链：`inputs.dry_run` → `preflight.steps.meta.outputs.dry_run`（`L277–L285`）→ `needs.preflight.outputs.dry_run`（`L214`）；push tag 事件下由 `L284` 强制 `false`。

| job | 可能的「正式版本资产」写操作 | dry_run 是否被正确传递 | 结论 |
|---|---|---|---|
| resolve-tag | 只读 `gh api` | 不涉及写 | ✅ |
| preflight | 只读（`git fetch/diff`、`gh release view`）；`L428–L434` 干跑时以触发分支 HEAD 为构建锚点 | ✅（`L417`） | ✅ 无远端写 |
| code-checks | `npm ci` / `npm run build`（runner 本地） | 不涉及远端写 | ✅ |
| security-scan | `upload-artifact`（CI 报告，`L739–L751`） | 未区分 | ✅ CI artifact 非发布资产 |
| unit-tests / e2e-tests | `upload-artifact`（报告 / 失败证据） | 未区分 | ✅ 同上 |
| **build-image** | ① 登录 GHCR `L1014–L1020` ② `docker/build-push-action` push `L1043` ③ provenance/sbom `L1062–L1063` ④ `cache-to: type=gha` `L1054` ⑤ 导出/上传镜像归档 `L1073–L1088` | ✅ `if: dry_run != 'true'`（`L1015`）、`push: dry_run != 'true'`（`L1043`）、`load: dry_run == 'true'`（`L1044`）、provenance/sbom 同步关闭、归档两步骤带 `if: dry_run == 'true'` | ✅ **不推 GHCR**；⚠️ `cache-to` 未随干跑关闭，会写 GHA 缓存（缓存非发布资产，注明） |
| deploy-verify | 生成 `deploy/.env`（随机凭据）、`docker compose up`（runner 本地） | ✅（`L1127–L1141` 从 artifact 载入本地镜像） | ✅ 无远端写 |
| **package** | 打 `v2ex-clone-<ver>-deploy.zip` + `SHA256SUMS` + `upload-artifact`（`L1411–L1474`，保留 30 天） | ❌ **整个 job 没有任何 `dry_run`/`if:` 判断** | ⚠️ **唯一遗漏点**：干跑仍产出与正式发布**同名**的 `release-package` artifact。它只是 workflow artifact，**不构成 GHCR 镜像 / Tag / Release / Release 资产 / 公开发布**，故不破坏「完全不产生正式版本资产」的承诺；但易混淆、应加 `if:` 或改名 `dry-run-package` |
| **publish-release** | 创建 Release、上传资产、转公开 | ✅ **job 级** `if: needs.preflight.outputs.dry_run != 'true'`（`L1487`），连 `contents: write` 都不被调度 | ✅ 不建 Tag / 不建 Release / 不上传资产 / 不公开发布 |
| **verify-release** | 只读核验（带凭据 API / 匿名下载 / `docker pull`） | ✅ **job 级** `if: … != 'true'`（`L1940`） | ✅ 整体跳过 |

**关于「不建 Tag」**：全文无 `git tag` / `git push --delete` / `git push -f` / `DELETE /git/refs/tags/…`。唯一的隐式建 Tag 风险是 `gh api POST /releases`（`L1837–L1843`）在 `tag_name` 不存在时 GitHub 会在默认分支**自动创建 tag**；但 `publish-release` 的竞态检查 `L1578–L1581` 要求 `TAG_SHA_NOW` 非空（即 tag 已存在）否则 `exit 1`，属 fail-closed；干跑时该 job 整个跳过 ⇒ 干跑绝不建 Tag。✅

**结论**：干跑路径**能够保证完全不产生正式版本资产**（不推 GHCR 镜像、不建 Tag、不建 Release、不上传 Release 资产、不公开发布）。但存在两处需收口：D-1（输入类型导致 fail-open）与 `package` 未消费 `dry_run`（混淆性 artifact）。此外 `publish=true` 与 `dry_run=true` 同设时，`publish-release`/`verify-release` 被跳过 ⇒ dry_run 优先，安全 ✅。

---

### 2.3 三态区分（评审项 3）— **缺陷**

| 态 | 触发条件 | 流水线实际行为 | 判定 |
|---|---|---|---|
| 干跑 | `dry_run=true` | 见 §2.2.2：构建但不推镜像、无 Tag/Release/资产/公开 | ✅ 清晰 |
| Draft | `dry_run=false` + `publish!=true` | **推 GHCR 镜像（公开可拉）** + 建 Draft Release + 上传 ZIP/SHA256SUMS 资产（`L1837–L1882`），`L1921–L1925` 保持 Draft | ❌ **不清晰** |
| 公开 Pre-release | `dry_run=false` + `publish=true` + `prerelease=true` | `gh release edit --draft=false --prerelease=true --latest=false`（`L1915–L1919`）；`verify-release` 核验「已发布 + Pre-release + 非 latest」（`L1979–L1985`） | ✅ 形态正确 |
| 稳定版 | `publish=true` + `prerelease=false` | **不可达**（见下） | ✅ 不会误发，但实现是死代码 |

**缺陷 D-3（Draft 不等于「未发布」）**：`build-image` 的 `push` 值只看 `dry_run`（`L1043`），**完全不看 `publish`**。因此 `dry_run=false, publish=false` 的「Draft 待风险决策」态，镜像已经被推到 GHCR；若 Packages 为 Public（Release Notes `L1711` 正是这么声明的），**镜像在风险决策作出之前就已对外分发**。这与 `L1895–L1900`「候选版本必须停在 Draft，等待主人决策后才能公开」以及 R-01「一次性风险接受仅针对 v0.0.9 的发行决定」（`L1749`）直接冲突：一旦决策否决发布，GHCR 镜像无法回收（删包需人工，且可能已被拉取）。GHCR 版本标签是可变的 ⇒ 还叠加 §2.5 的覆盖风险。

**缺陷 D-4（稳定版分支是死代码，注释误导）**：`L1903` `PRERELEASE="${{ inputs.prerelease || 'true' }}"` 中，GitHub 表达式的布尔 `false` 是 falsy ⇒ `false || 'true'` 恒为 `'true'`。于是 `L1910–L1914` 的 guard `if [ "$PRERELEASE" != "true" ]` **永不触发**；注释 `L1908–L1909` 却写「只有显式 prerelease=false 才允许稳定版，且需要二次确认开关（见下方 guard）」——下方既没有二次确认开关，也只有 `exit 1`。同时创建 Release 时 `-F prerelease=true`（`L1841`）写死，`verify-release` `L1974–L1975` 又强制断言 `is_prerelease` ⇒ **0.0.x 不会被误发成稳定版（此点通过）**，但「显式 false 可发稳定版」是错误文档，应改为硬禁止并删掉误导注释。

**低风险（需实跑确认）**：`gh release edit` 官方 manual 列出 `--draft` / `--prerelease` / `--latest` 为布尔标志并示例 `--draft=false`，故 `L1917–L1919` 的 `--draft=false --prerelease=true --latest=false` 语法可解析；但 `--latest=false` 是否真把 `make_latest` 置为 false（而非 no-op）未在 manual 明示。由于 Release 本身是 `prerelease=true`，GitHub 不会把 Pre-release 设为 latest，且 `L1982–L1984` 有兜底断言 ⇒ 风险低。

---

### 2.4 Tag / Release 已存在性与补救路径（评审项 4）— **缺陷**

#### 2.4.1 已有检查清单

| 检查 | 位置 | 行为 | 判定 |
|---|---|---|---|
| push tag：tag 指向 == 本次构建 commit | `L300–L315` | `REMOTE_SHA != github.sha` ⇒ `exit 1` | ⚠️ 恒真自证（详见 §2.6） |
| dispatch 补救路径：Release 已存在 | `L347` | `gh release view` 成功 ⇒ `exit 1` | ⚠️ fail-open 结构 |
| dispatch 补救路径：Tag 内容零差异 | `L373–L384` | `git diff --name-only "$TAG_SHA" origin/master -- deploy/ src/ package.json drizzle/`，失败或非空 ⇒ `exit 1` | ✅ fail-closed，但范围不足 |
| preflight：Release 已存在 | `L398` | `gh release view` 成功 ⇒ `exit 1` | ⚠️ fail-open 结构 |
| publish-release：竞态复查 Release / Tag 未移动 | `L1533`、`L1555–L1587` | Release 存在 ⇒ `exit 1`；`TAG_SHA_NOW` 为空 ⇒ `exit 1`；与 `tag_sha` 不等 ⇒ `exit 1` | ⚠️ Release 检查 fail-open；Tag 检查 ✅ |
| 资产上传失败回滚 | `L1869–L1881` | 删除刚创建的 Draft | ✅ |
| 禁止移动/删除 Tag、禁止覆盖资产 | 全文 | 无 `git tag -d` / `push -f` / `DELETE /git/refs/tags`；创建 Release 前有两道存在性闸门 | ✅ 通过 |

#### 2.4.2 缺陷 D-5：「已存在」检查是 fail-open 结构（阻断）

`L347`、`L398`、`L1533` 的写法**完全同构**：

```bash
if gh release view "$VERSION" --repo … >/dev/null 2>&1; then
  echo "::error::Release 已存在…"; exit 1
fi
# 否则：视为「不存在」，继续发布
```

该结构**无法区分「确实不存在（404）」与「查询失败」**——网络抖动、API 限流、token 权限不足、gh CLI 报错、`GH_TOKEN` 缺失，全部被当成「Release 不存在」而放行。这与仓库自身已记录的历史缺陷 F2 完全同构（`docs/SESSION_HANDOFF_v0.0.4.md` `L788`：「`preflight` 的 `gh release view` 缺 `env: GH_TOKEN` ⇒『Release 已存在』闸门**静默失效**」）。当时只补了 `env: GH_TOKEN`（现 `L288–L296`、`L393–L394`、`L1528–L1529` 均已正确设置），**没有修「命令失败 = 不存在」这个逻辑本身**。

补充不确定性（已核对 gh CLI 上游源码）：现行 `gh release view <tag>` 的 `shared.FetchRelease` 会并发查询「published-by-tag（REST `/releases/tags/{tag}`）」与「draft-by-tag（GraphQL `release(tagName:)`）」，任一成功即返回 ⇒ 在有权限且 gh 版本较新时**能**看到 Draft（`docs/RELEASE_PROCESS_v0.0.4.md` `L464` 也用 `--json isDraft` 核验过 Draft）。但：

- GitHub REST 文档明确 `Get a release by tag name` = "Get a published release with the specified tag"，draft 只在 `List releases` 中对 push access 用户可见（本文件 `L1949–L1952` 的实测注释亦如此记载）；
- 流水线**没有 pin gh CLI 版本**，也没有 `gh --version` 断言；一旦 runner 镜像回退到无 draft fallback 的旧版 gh，或 GraphQL 查询因权限/限流失败，`FetchRelease` 返回错误 ⇒ 三处闸门 fail-open；
- 即使 fallback 正常，**任何非 404 的失败仍被 `if …; then` 吞掉**。

后果：Draft 已存在时，重跑（dispatch `dry_run=false`）可能一路走到 `L1837` 用同一 `tag_name` 再建 Release（GitHub 返回 409），或误入「补救路径」判定；此时 GHCR 镜像已推、ZIP 已上传 artifact ⇒ 留下「镜像已推、Release 状态不明」的半成品，且无法靠流水线自愈。

**最小修复**：三处统一改为列表接口 + 显式退出码判定（与 `L1953–L1956` 一致），例如

```bash
REL_JSON="$(gh api "repos/$REPO/releases?per_page=100" --jq ".[] | select(.tag_name==\"$VERSION\") | {id,draft}")" || { echo "::error::查询 Release 失败"; exit 1; }
[ -n "$REL_JSON" ] && { echo "::error::Release/Draft 已存在"; exit 1; }
```

即「查询失败 ⇒ 中止（fail-closed）」，而非「查询失败 ⇒ 放行」。同时把 `L1890` 的资产读取改为用 `RELEASE_ID` 走 `GET /releases/{id}`（当前已拿到 id），彻底去掉对 `gh release view` 的依赖，并补一条 `gh --version` 记录。

#### 2.4.3 补救路径存在但范围不足（风险→缺陷）

`L316–L389` 确实提供了「Tag 已存在、Release 未创建 ⇒ 不移动 Tag、从 master 补建」的安全补救路径，且 `L360–L384` 的 diff 校验明确修复了历史上 `|| true` 导致的 fail-open（`L362–L371` 注释），**比较失败即中止** ✅。但：

- diff 范围只有 `deploy/ src/ package.json drizzle/`（`L373–L374`）。`build-image` 的构建上下文是 `context: .`（`L1039`），`Dockerfile`、`package-lock.json`、`next.config.*`、`public/`、`.dockerignore` 等**都会影响镜像**，却不在校验范围内 ⇒ 这些文件有差异时会被判「零差异」而照发。
- `L372` 只 `git fetch origin master`，**不 fetch tag 对象**；能否解析 `$TAG_SHA` 依赖 `checkout` 的 `fetch-depth: 0`（`L223`）凑巧可用。tag 打在非 master 历史的 commit 上会 `fatal: bad revision` ⇒ 中止（fail-closed，但属误中止）。
- 补救路径**只覆盖 dispatch**；push tag 正式路径完全没有 diff 校验（§2.6）。

---

### 2.5 并发与重复触发（评审项 5）— **缺陷**

```yaml
# L85–L88
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

| 触发方式 | `github.ref` | concurrency group |
|---|---|---|
| `push` tag `v0.0.9` | `refs/tags/v0.0.9` | `release-refs/tags/v0.0.9` |
| `workflow_dispatch` 在 master | `refs/heads/master` | `release-refs/heads/master` |
| `workflow_dispatch` 在 PR32 分支 | `refs/heads/fix/v0.0.9-…` | `release-refs/heads/fix/v0.0.9-…` |

- 同一分支重复 dispatch：**同组排队、不取消**（`cancel-in-progress: false`）⇒ 串行 ✅，符合 `L87`「中途取消会留下半成品」的考量。
- **跨触发方式：不同组 ⇒ 完全不互斥**。tag push 的自动 run 与人工 dispatch 的「补救 / 转公开」run 可以**同时发布同一个 v0.0.9**。两个 run 都会执行 `build-image` 的 `push`（`L1043`），GHCR 版本标签 `v0.0.9` / `sha-<tag_sha>`（`L1028–L1029`）是**可变的**，后推覆盖前推；`publish-release` 的竞态复查（`L1527–L1587`）能挡住第二个 Release 创建，但挡不住镜像覆盖，且该复查本身有 §2.4.2 的 fail-open 问题。
- **结论：不能防止同一 Tag 被多 run 同时发布。**

**最小修复**：按**版本号**而非 ref 分组，使 tag push 与 dispatch 落入同一组：

```yaml
concurrency:
  group: release-${{ github.event_name == 'workflow_dispatch' && inputs.version || github.ref_name }}
  cancel-in-progress: false
```

并在 `build-image` 推送前加「目标镜像标签是否已存在」的 fail-closed 检查（或改为推不可变 digest 并在 `verify-release` 用 digest 拉取），从根上消除「同名标签被覆盖」。

---

### 2.6 构建上下文一致性（评审项 6）— **缺陷（阻断，必须修复）**

#### 2.6.1 事实：所有 job 从 master 检出

| job | checkout 行号 | `ref` |
|---|---|---|
| preflight | `L220–L259` | `master`（`L259`） |
| code-checks | `L457–L462` | `master`（`L462`） |
| security-scan | `L486–L493` | `master`（`L493`，`fetch-depth: 0`） |
| unit-tests | `L786–L791` | `master`（`L791`） |
| e2e-tests | `L858–L863` | `master`（`L863`） |
| build-image | `L980–L985` | `master`（`L985`） |
| deploy-verify | `L1119–L1124` | `master`（`L1124`） |
| package | `L1404–L1409` | `master`（`L1409`） |
| publish-release / verify-release | 无 checkout | 用 `download-artifact` / `gh api` |

`L224–L258` 的注释完整记录了「Tag 不可移动 vs 流水线需修复」的死锁与解耦理由，并**自认**「必须保证 master 与 tag 在 `deploy/` `src/` `package.json` 上零差异」，`L245–L246` 声称「v0.0.4 实测 `git diff v0.0.4 origin/master -- deploy/ src/ package.json` 输出为空 ⇒ 发布包逐字节一致」。

#### 2.6.2 判定：正式公开发布时**无法证明**资产来自 Tag 提交

1. **push tag 路径没有任何 diff 校验**。`L300–L315` 只比较 `REMOTE_SHA`（`resolve-tag` 在 run 开始时用 `gh api` 解析的远端 tag 目标）与 `${{ github.sha }}`。对 `push` tag 事件，二者**本来就都是同一个 commit** ⇒ 这道校验是**恒真的自证循环**，只能发现「run 期间 tag 被移动」，**完全无法发现「master 检出的代码 ≠ tag 指向的代码」**。`L247–L250` 注释声称「tag 指向 == 构建 commit 这道校验照常生效」，实际上比较的是两个 tag 元数据，与构建 checkout 的 ref 无关。
2. **唯一存在的 diff 校验在补救路径里**（`L373–L384`），条件严格：`workflow_dispatch` + `resolve-tag.outputs.exists == true` + Release 未创建。**正式 push tag 路径不经过它**。而 PR32 与 master 的 Release Notes 差异恰好说明：tag 打在 PR32 合并前的 commit、master 已合并 PR32 时，`release.yml` 内容不同（虽不影响镜像，但说明「tag 与 master 不同」是现实场景）。
3. **注释里的「实测零差异」是一次性人工验证，不是每次发布的自动门禁**，不能作为 v0.0.9 的证据。
4. **镜像溯源被伪造**：`L1029` 生成 `sha-${{ needs.preflight.outputs.tag_sha }}` 标签，`L1050` 写入 `org.opencontainers.image.revision=${{ needs.preflight.outputs.tag_sha }}`，但 `L1039` 的构建上下文是 `context: .`（master 工作区）。即：**镜像实际由 master HEAD 构建，元数据却声称 revision = tag 指向的 commit**。BuildKit `provenance`（`L1062`）记录的是真实构建来源，会与 label 冲突 —— 这比「没有校验」更糟，属于可误导审计的溯源失真。PR32 的 Release Notes `L1607` 宣称「固定 SHA 构建 → 导出镜像 tar」，那是**候选链路**（candidate-verify.yml）的做法，正式 `release.yml` 并未固定 SHA。
5. **Release 资产同样来自 master**：`package` 的 `L1418` `zip -r … deploy/` 打包的是 master 检出的 `deploy/`；`publish-release` 的 Release 通过 `tag_name` 隐式指向 tag（注释 `L1820–L1828` 承认不传 `target_commitish`、靠「tag 已存在时 API 忽略它」），`L1785` 定义的 `TAG_SHA` 变量在后续**根本没有被使用**（是死变量）。于是形成：**Release 声称属于 Tag commit，但资产与镜像属于 master HEAD**。

> **结论：正式公开发布时，Release 资产与 GHCR 镜像不可证明来自 Tag 指向的准确提交。这是必须修复的发布门禁缺陷（阻断）。**

#### 2.6.3 最小修复方案（**仅给出方案，本次评审不修改任何代码**）

**方案 A（最小改动，保留 master 检出）** —— 把补救路径的校验提升为**全路径无条件门禁**：

1. 在 `preflight` 的 `L287–L390` 之后新增一个「发布内容一致性」步骤，对 **push tag 与 dispatch 都执行**：
   - `git fetch origin master` 并显式 `git fetch origin "refs/tags/$VERSION"`（确保 tag 对象在本地，去掉对 `fetch-depth: 0` 的偶然依赖）；
   - `git diff --quiet "$TAG_SHA" origin/master -- deploy/ src/ drizzle/ package.json package-lock.json Dockerfile .dockerignore next.config.* public/ …`（**覆盖所有进入镜像或安装包的文件**，不再只 4 个路径）；
   - 差异非空或 `git diff` 本身失败 ⇒ `::error::` + `exit 1`，提示「移动 Tag 需单独授权 / 停下请主人裁决」。
   - 干跑路径（`L428–L434` 以 HEAD 为锚点）可跳过该步骤，但需在日志显式标注「干跑产物不代表 Tag」。
2. 修正溯源：`L1029` 的 `sha-*` 标签与 `L1050` 的 `revision` 改为写入**实际构建 commit**（`git rev-parse HEAD`，由 `build-image` 用 step output 传出），或删除这两个字段；`L1785` 的死变量一并清理。
3. 在 `package` 增加版本一致性校验（见 §2.7），并把真实 digest 写入 Release Notes / SHA256SUMS（见 §2.9）。

**方案 B（根治，推荐）** —— 把 8 个 `checkout` 的 `ref` 从 `master` 改为 `${{ needs.preflight.outputs.tag_sha }}`（或对 push 用 `github.ref`、对 dispatch 用 `refs/tags/$VERSION`），让「流水线定义」与「被构建的产品代码」真正解耦：workflow 文件取自触发 ref（修复后的流水线可以合入 master 后用 dispatch 触发），而**被构建的代码一律取 tag 指向的 commit**。这样既保留「Tag 不可移动、无需授权」的解耦初衷，又从根上消除一致性问题，无需维护 diff 白名单。注意需保留 `fetch-depth: 0` 并保证 tag 对象可达。

---

### 2.7 安装包内容与版本一致性（评审项 7）— **风险（当前干净）/ 缺陷（零校验）**

#### 2.7.1 打包与排除

| 项 | 实现 | 行号 | 判定 |
|---|---|---|---|
| 打包方式 | `zip -r "$ZIP" deploy/` | `L1418` | 从 master 检出的 `deploy/` 整目录打包 |
| 排除项 | `-x 'deploy/.env' 'deploy/INSTALL_CREDENTIALS.txt' 'deploy/backups/*' 'deploy/*.log'` | `L1419–L1422` | ⚠️ 只精确排除 `.env`，**不排除 `.env.local` / `.env.production` / `.env.bak` / `*.pem` / `*.key` / 测试凭据** |
| 生成 .env 的位置 | `deploy-verify` 在**另一台 runner** 生成 `deploy/.env`（`L1181–L1198`）；`package` 是干净 checkout ⇒ 不含生成的 .env | `L1180` vs `L1404` | ✅ 当前不会把真实 .env 打进包 |
| ZIP 内容校验 | 只查 14 个必需文件存在、`deploy/.env` / `INSTALL_CREDENTIALS.txt` / `ref-*.png` / `diff-*.png` 不得存在 | `L1432–L1464` | ⚠️ 未扫描包内其他敏感模式 |
| 仓库级检查 | `git ls-files` 只检查**被跟踪**的 `.env*`，且豁免 `*.example` | `L669–L737`（尤其 `L733`） | ⚠️ 不覆盖未跟踪文件；`L707–L713` 的 `hits="$(… \| grep . \|\| true)"` 在 `deploy/` 缺失或 grep 报错时会得到空串 ⇒ 明文口令检查假绿（后续打包会失败兜底，低风险） |
| SHA256SUMS | `sha256sum "$ZIP_NAME" > SHA256SUMS`（只覆盖 ZIP） | `L1426–L1430` | ✅ 生成正确；`verify-release` `L2017–L2021` 匿名下载后 `sha256sum -c` 复核 ✅ |
| 上传 | `upload-artifact` `release-package`，30 天 | `L1466–L1474` | CI artifact；正式发布由 `publish-release` 上传到 Release（`L1859–L1881`） |

实测当前 `deploy/` 目录共 15 个文件，无 `.env*` 变体、无密钥、无凭据文件 ✅；`.env.example` 无真实口令（全为空值 / 占位）✅。

#### 2.7.2 三者一致性：**零校验**

| 位置 | 当前值 | 由谁保证 |
|---|---|---|
| 包内 `deploy/VERSION` | `0.0.9` | **手工维护**，流水线从不读取、不写入、不比对（`grep release.yml` 无 `deploy/VERSION`） |
| 包内 `deploy/.env.example` `V2EX_IMAGE` | `ghcr.io/alicia1030su/v2ex-clone:v0.0.9`（`L17`） | 手工维护；文件头仍写「V2EX Clone **v0.0.4** — 发行版环境变量模板」 |
| 包内 `deploy/docker-compose.yml` 镜像默认值 | `${V2EX_IMAGE:-ghcr.io/alicia1030su/v2ex-clone:v0.0.9}`（`L76`） | 手工维护 |
| GitHub Release 版本号 | `${{ needs.preflight.outputs.version }}` = `v0.0.9`（`L1838`、ZIP 名 `L1416`） | 流水线生成 |

`L1435` 的 `REQUIRED` 列表只校验 `VERSION` **文件存在**，`verify-release` `L2023–L2029` 只校验 `install.sh` / `install.ps1` / `docker-compose.yml` **存在**。**没有任何一处比对上述四者的版本号是否一致**，也没有把 `$VERSION` 写进 `deploy/VERSION`。当前一致纯属「碰巧」；下一版本若漏改 `deploy/VERSION` 或 `.env.example`，用户拿到的包内版本与 Release 版本就会错配，而全流水线绿灯。

补充：`Release Notes` `L1610` 称「候选包内镜像引用由脚本统一改写」——那是候选链路（candidate-verify / `update.sh --version`）的能力，**正式 `package` job 没有任何版本改写或断言**。

**缺陷 D-6（虚假声明）**：`L1711–L1712` 写「匿名可直接拉取（Public 包）。镜像 Digest **见本 Release 页面**与发布交付报告」，但 `L1592–L1776` 的 Notes 模板只有一个 `__VERSION__` 占位符（`L1775` `sed`），**没有任何 digest 占位符**；`verify-release` `L2060` 只把 digest 打印到日志（且该 job 的 `needs` 不含 build-image，见 §2.9）。⇒ Release 页面上根本没有 digest。同时「匿名可直接拉取」在流水线里只是 `::notice::`（`L2102–L2103`），不作为判据。

**最小修复**：① `package` 增加断言：解包后比对 `deploy/VERSION`、`.env.example` 的 `V2EX_IMAGE`、`docker-compose.yml` 的 image 默认值均等于 `${VERSION}` / `v${VERSION#v}`；② ZIP 改为按 `REQUIRED` 显式清单打包，或补 `-x 'deploy/.env*'`（保留 `.example`）并对包内做敏感模式扫描；③ 把真实 digest 写入 Notes（新增 `__DIGEST__` 占位符）**或删除该句声明**；④ 修正 `.env.example` 文件头的 v0.0.4 字样。

---

### 2.8 失败路径、`|| true`、`continue-on-error`、0 测试（评审项 8）— **通过（主）/ 风险（次）**

- **`continue-on-error`**：全文 0 处（仅 `L10` 注释提及「无 continue-on-error」）✅。`needs` 依赖图完整：`build-image` needs 5 个检查 job（`L971`）、`package` needs `build-image`/`deploy-verify`（`L1399`）、`publish-release` needs `package`（`L1481`）、`verify-release` needs `publish-release`（`L1932`）⇒ 任一失败后续不执行 ✅。
- **`|| true` 全量清单**（共 9 处实际执行）：

| 行号 | 场景 | 是否有兜底 | 判定 |
|---|---|---|---|
| `L161` | `resolve-tag` 查 tag，`|| true` 视为不存在 | push 路径 `L306–L309` 要求 `REMOTE_SHA` 非空否则 `exit 1`；dispatch 路径 `L1578–L1581` 要求 tag 存在 | ✅ 最终 fail-closed |
| `L517` | `npm audit --json … \|\| true` | 随后 `L518–L542` node 解析 JSON，`critical>0` / `high>0` ⇒ `process.exit(1)`；文件无效则 `JSON.parse` 抛错 ⇒ step 失败 | ✅ 有兜底（但若 audit 输出合法 JSON 却缺 `metadata.vulnerabilities`，`v={}` ⇒ 通过，低风险） |
| `L545` | `npm ls … \|\| true` | 仅记录依赖树，非门禁 | ✅ |
| `L713` | `hits="$(… \| grep . \|\| true)"` | 链式 grep 必需写法；但 `grep -rniE` 本身失败会被吞 ⇒ 明文口令检查假绿 | ⚠️ 低风险（后续 `zip deploy/` 会失败兜底） |
| `L953` | `kill … \|\| true`（`if: always()` 清理 E2E 进程） | 清步骤，不影响主结果 | ✅ |
| `L1287` | `curl … -w '%{http_code}' \|\| true` | `L1289` 断言 `HTTP_CODE == 201`，curl 失败得 `000` ⇒ `exit 1` | ✅ |
| `L1291` | `cat /tmp/signup.json \|\| true`（错误分支内打印） | 打印用 | ✅ |
| `L1379` / `L1392` | `docker compose logs` / `down -v \|\| true`（`if: always()` 清理） | 清步骤 | ✅ |

- **`set -euo pipefail`**：绝大多数步骤均声明；唯一 `set -uo pipefail`（缺 `-e`）在 `L1522` 的「记录 token 权限映射（只读）」，且 `L1524–L1525` 本身带 `|| echo`，只读诊断无写操作 ⇒ 无害。
- **gitleaks 反假绿**：`L623–L626` 显式断言扫描文件数 `>= 1`；`L651–L666` `set +e` + `PIPESTATUS[0]` + `GL_EXIT != 0 ⇒ exit 1` ⇒ 二进制失败/发现泄露/报告写失败一律阻断 ✅。`npm audit` 的 high/critical 硬门禁 ✅。
- **「0 条测试也算通过」**：`L814` `npx vitest run --reporter=junit …` **未加 `--passWithNoTests`**，`L949` `npx playwright test --reporter=list` **未加 `--pass-with-no-tests`** ⇒ 工具在「无测试文件」时默认返回非零 ⇒ **不存在 0 测试假绿** ✅。但两者都**只依赖工具默认退出码，没有解析报告断言「实际执行用例数 > 0 且 failures = 0」**；`L822` 的 `unit-test-results.xml` 上传用 `if-no-files-found: warn`，报告缺失不阻断。属低风险，建议补一条报告解析断言（例如 JUnit `tests>0 && failures==0`）。
- **匿名下载 curl 未加 `--fail`**：`L2009` / `L2017` / `L2123` 用 `curl -sL`，404 会返回 GitHub HTML 页面而 curl 退出 0；`L2011` 的 `SIZE > 1000` 判据拦不住（404 页面远大于 1KB）。但 `L2020` `sha256sum -c SHA256SUMS` 会对非法/不匹配内容报错 ⇒ **最终仍 fail-closed** ✅。建议改 `curl -fsSL` 使失败语义显式。

---

### 2.9 发布后验证 verify-release（评审项 9）— **缺陷**

| 子项 | 实现 | 行号 | 判定 |
|---|---|---|---|
| Release 状态核验 | `curl` + `Authorization: Bearer GITHUB_TOKEN` 调**列表**接口，python 断言 `is_prerelease`；`publish=true` 时断言非 draft、非 latest、资产含 `deploy.zip` 与 `SHA256SUMS` | `L1942–L1996` | ✅ 逻辑正确、fail-closed；⚠️ **带凭据，不是匿名视角** |
| 为什么用列表接口 | 注释自述「按 tag 查询端点不返回 draft（实测 404）」 | `L1949–L1952` | 与 §2.4.2 的 `gh release view` 形成内部矛盾（见 D-5） |
| **匿名下载** | `if: ${{ inputs.publish == true }}`，`curl -sL`（无 Authorization）下载 ZIP + SHA256SUMS，`sha256sum -c`，解压校验 3 个文件 | `L2001–L2029` | ✅ **是匿名**且核对 SHA256；❌ **仅在 `publish=true` 时执行** —— 人工在 UI 上把 Draft 转公开时该 run 的 `inputs.publish=false`，这三项核验**永远不会补做** |
| 匿名可拉取性 | 完整 Bearer 流程探测，失败只打 `::notice::`，注释明言「不影响镜像已推送的事实」 | `L2066–L2114` | ⚠️ 不是门禁，与 `L1711`「匿名可直接拉取」承诺不匹配 |
| **digest 核对** | `L2060` `docker image inspect … 'Digest: …'` **只打印**；`build-image.outputs.digest`（`L977`）在全文无任何消费点（`grep` 仅命中 `L1092` 打印与 `L2060`）；`verify-release.needs` 是 `[preflight, publish-release]`（`L1932`），**不含 build-image** ⇒ 拿不到 digest | `L977`、`L1092`、`L1932`、`L2060` | ❌ **完全不核对 digest**，无法证明「Release 资产对应的镜像」=「当前 `v0.0.9` 标签指向的镜像」；叠加 §2.5 的标签可覆盖问题，风险放大 |
| 带凭据拉取 | `docker pull "$IMAGE"` 成功后 `image inspect` | `L2044–L2064` | ✅ 证明标签存在且可拉 |
| Release 网页可访问 | `if: inputs.publish == true`，断言 HTTP 200 | `L2116–L2126` | ✅ 但同样只在 publish=true 时跑 |
| 权限 | `contents: write` + `packages: read`（注释称「读取 draft 需要 contents: write」） | `L1935–L1937` | ⚠️ 只读核验 job 给了 `contents: write`，违反最小权限；带 token 读 draft 用 `contents: read` 即可 |
| dry_run | job 级 `if: dry_run != 'true'` | `L1940` | ✅ |

**最小修复**：① `verify-release.needs` 增加 `build-image`，用 `needs.build-image.outputs.digest` 与 `docker image inspect` 的 `RepoDigests` / `ghcr.io` manifest 做字符串比对，并把 digest 写进 Release Notes；② 把匿名下载 / 网页可访问 / 公开形态断言改为「读取到 Release 实际为已发布即执行」，不再依赖 `inputs.publish`；③ 权限降为 `contents: read`；④ 匿名可拉取性若继续写进 Release Notes，应升级为硬门禁。

---

### 2.10 参考工作流一致性（补充）

| 参考文件 | 相关事实 | 行号 |
|---|---|---|
| `soak-test.yml` | 明确「1 小时冒烟纳入 v0.0.9 发布门禁」「24 小时分段链未完成，列为后续稳定性验证项」；汇总 job 核对累计实际秒数 | `L49–L50`、`L226–L250` |
| `soak-segment.yml` | 每段内置时长诚实性闸门（实际秒数 < 目标 − 300 ⇒ 失败） | `L249–L267` |
| PR32 Release Notes | 如实标注「1 小时 ✅ 通过 / 24 小时 ⬜ 未完成 / 一次性发布门禁例外」 | `L1714–L1737` |
| 两者关系 | 表述一致 ✅；但 **`release.yml` 与 `soak-*.yml` 之间没有任何 `needs` / `workflow_run` / artifact 依赖**，「一次性发布门禁例外」完全靠人工声明，流水线不感知、无强制记录 | `release.yml` 全文 |

补充：Release Notes `L1718–L1719` 声称「单元测试 394/394 ✅」「E2E 跨浏览器矩阵 ✅ 通过 | 见 CI run」，而 `release.yml` 的 `e2e-tests` 只安装 Chromium（`L874`），跨浏览器矩阵在独立工作流 `e2e-matrix.yml`（不在本流水线依赖图内）；`L1657` 已知限制又写「多浏览器视觉回归：CI 覆盖 Chromium；Firefox / Safari 未覆盖」。属 Notes 与流水线覆盖范围的一致性风险（内容侧，非发布门禁代码缺陷），建议由 Notes 负责人统一措辞。

---

## 3. 必须修复项清单（按「阻断发布 / 非阻断」排序）

### 3.1 阻断发布（B 类，未修复前不得正式公开发布）

| ID | 缺陷 | 结论 | 最小改动建议 | 对应行号 |
|---|---|---|---|---|
| **B1** | **构建上下文与 Tag 脱钩**：全部 job 从 master 检出；正式 push tag 路径无 diff 校验（`REMOTE_SHA == github.sha` 是自证循环）；补救路径 diff 只覆盖 4 个路径；镜像 label / `sha-*` 标签把 `tag_sha` 伪造成构建 revision；Release 资产来自 master 却指向 Tag | **缺陷（阻断）** | ① 把 `L373–L384` 的 diff 校验提升为**全路径无条件门禁**，范围扩到 `Dockerfile` / `package-lock.json` / `.dockerignore` / `next.config.*` / `public/` 等全部镜像与安装包输入，并显式 `git fetch` tag 对象；② `L1029` / `L1050` 改写入**实际构建 commit**；③ 根治方案：8 个 checkout 的 `ref` 改为 `${{ needs.preflight.outputs.tag_sha }}`（详见 §2.6.3 方案 B） | `L259, L462, L493, L791, L863, L985, L1124, L1409`、`L300–L315`、`L373–L384`、`L1029, L1050`、`L1039`、`L1418`、`L1785, L1837` |
| **B2** | **不存在可靠的正式公开发布入口**：tag push 时 `inputs.publish` 不可用 ⇒ 只能到 Draft；把 Draft 转公开的 dispatch 路径被「Release 已存在」闸门 / 409 拦死；人工在 UI 发布又会绕过 `verify-release` 的公开形态、匿名下载 SHA256、网页可访问三项核验 | **缺陷（阻断）** | 在 `publish-release` 增加**幂等「转公开」模式**：允许「Release 已存在且为 draft」时跳过创建/上传，只执行 `gh release edit --draft=false --prerelease=true --latest=false`；并让 `preflight` 的 Release 存在性硬失败在该模式下豁免（用显式 `mode=publish` 输入或仓库变量表达）；`verify-release` 改为「检测到 Release 已公开即执行全部核验」，不再依赖 `inputs.publish` | `L392–L402`、`L1487`、`L1527–L1536`、`L1837–L1882`、`L1901–L1925`、`L1947–L1985`、`L2002`、`L2119` |
| **B3** | **「Release 已存在」检查是 fail-open 结构**：`if gh release view …; then` 把查询失败（网络 / 限流 / 权限 / gh 版本差异）当成「不存在」放行；且 draft 可见性依赖未 pin 的 gh CLI draft fallback，与 `L1949–L1952` 自述相互矛盾 | **缺陷（阻断）** | 三处统一改用列表接口 `gh api "repos/$REPO/releases?per_page=100" --jq …`，**查询失败一律 `exit 1`**；`L1890` 改用已拿到的 `RELEASE_ID` 走 `GET /releases/{id}` 读资产；补 `gh --version` 记录 | `L347`、`L398`、`L1533`、`L1890`、`L1949–L1956` |
| **B4** | **并发组按 ref 而非版本号**：tag push 与 dispatch 分属不同组，同一 Tag 可被多 run 同时发布；GHCR `v0.0.9` / `sha-*` 标签可变 ⇒ 镜像可被覆盖 | **缺陷（阻断）** | `group: release-${{ github.event_name == 'workflow_dispatch' && inputs.version || github.ref_name }}`；并在推送前检查目标镜像标签是否已存在（fail-closed），或改推不可变 digest | `L85–L88`、`L1028–L1029`、`L1043` |
| **B5** | **Draft 阶段已公开推送 GHCR 镜像**：`push` 只看 `dry_run`、不看 `publish`，与「Draft 待风险决策」「R-01 一次性风险接受」冲突；否决发布时镜像已流出且不可回收 | **缺陷（阻断）** | 把 `L1043` 的 push 条件收紧为 `dry_run != 'true' && publish == true`（Draft 阶段沿用干跑的 artifact 传递方案），或在发布规约中明确接受「Draft 即已分发镜像」并配套可回收流程 | `L1043`、`L1014–L1020`、`L1895–L1900`、`L1749` |

### 3.2 非阻断但应修（N 类）

| ID | 问题 | 结论 | 最小改动建议 | 行号 |
|---|---|---|---|---|
| **N1** | `dry_run` 未声明 `type: boolean`，字符串比较只认小写 `"true"`，误填即 fail-open 到正式发布；`version` / `dry_run` 直插 shell 有注入面 | 缺陷 | 补 `type: boolean`；`preflight` 增取值白名单；`VERSION` / `dry_run` 改经 `env:` 传递 | `L66–L69`、`L266`、`L277–L285` |
| **N2** | 包内 `VERSION` / `.env.example` / `docker-compose.yml` 镜像引用 / Release 版本号**零校验**；`.env.example` 文件头仍写 v0.0.4；Release Notes 宣称「Digest 见本 Release 页面」但模板无 digest | 缺陷 | `package` 增加解包后版本断言；补 `__DIGEST__` 占位符或删该句；修正文件头 | `L1432–L1464`、`L1711–L1712`、`deploy/VERSION`、`deploy/.env.example`、`deploy/docker-compose.yml:76` |
| **N3** | `verify-release` **不核对 digest**，`build-image.outputs.digest` 全文无消费点 | 缺陷 | `needs` 加 `build-image`，比对 digest 并写入 Notes / SHA256SUMS | `L977`、`L1092`、`L1932`、`L2060` |
| **N4** | 匿名下载 / 网页可访问 / 公开形态断言**仅 `inputs.publish == true` 时执行**；人工转公开后永不补做；匿名可拉取性只作 `::notice::` | 缺陷 | 改为按「Release 实际状态」触发；匿名可拉取性升级为硬门禁或删除 Notes 中的承诺 | `L2002`、`L2102–L2103`、`L2119`、`L1711` |
| **N5** | ZIP 排除规则不全（`.env.*` 变体 / `*.pem` / `*.key` / 测试凭据未排除）；包内内容校验只查 3 类；`L713` 链式 `\|\| true` 在 `deploy/` 缺失时假绿 | 风险 | 按 `REQUIRED` 显式清单打包或补 `-x 'deploy/.env*'`（保留 `.example`）+ 包内敏感模式扫描；`L707` 增加 `grep` 退出码判定 | `L1418–L1422`、`L1432–L1464`、`L707–L713` |
| **N6** | `package` 完全未消费 `dry_run`，干跑仍产出与正式同名的 `release-package` artifact（30 天）；`cache-to: type=gha` 干跑仍写缓存 | 风险 | 加 `if:` 或改名 `dry-run-package`；干跑关闭 `cache-to` | `L1054`、`L1397–L1474` |
| **N7** | 稳定版分支是死代码：`inputs.prerelease \|\| 'true'` 吞掉显式 `false`，guard 永不触发，注释却称「需二次确认开关」 | 风险 | 改为硬禁止（直接 `::error::` 拒绝 `prerelease=false`），删除误导注释；`--latest=false` 建议实跑确认 | `L1903`、`L1908–L1919` |
| **N8** | `verify-release` 是只读核验 job 却持 `contents: write` | 风险 | 降为 `contents: read` | `L1935–L1937` |
| **N9** | 0 测试无显式兜底（仅依赖工具默认退出码）；`unit-test-results.xml` 上传 `if-no-files-found: warn`；`npm audit` 输出合法 JSON 但缺 `metadata.vulnerabilities` 时会判通过 | 风险 | 解析 JUnit / Playwright 报告断言 `tests>0 && failures==0`；`npm audit` 增加字段存在性校验 | `L517–L542`、`L814`、`L822`、`L949` |
| **N10** | 匿名下载 `curl -sL` 无 `--fail`，`SIZE>1000` 判据拦不住 GitHub 404 页面（靠 `sha256sum -c` 兜底）；补救路径 `git fetch origin master` 不取 tag 对象 | 风险 | 改 `curl -fsSL`；补 `git fetch origin "refs/tags/$VERSION"` | `L372`、`L2009`、`L2011`、`L2017`、`L2123` |
| **N11** | 「24 小时未完成 / 一次性发布门禁例外」纯靠 Release Notes 人工声明，`release.yml` 与 `soak-*.yml` 无依赖、无 artifact 校验 | 风险 | 在 `preflight` 读取一次例外登记文件 / 环境变量并留痕（与团队任务 #1 的结论对齐） | `L1714–L1737`、`soak-test.yml:49–50` |

---

## 4. 干跑路径最终判定（评审项 2 的正式答复）

| 承诺 | 是否成立 | 依据 |
|---|---|---|
| 不推 GHCR 镜像 | ✅ | `L1015`（登录跳过）、`L1043 push: false` + `L1044 load: true`、`L1062–L1063`（attestation 关闭） |
| 不建 Tag | ✅ | 全文无建/删/移 Tag 命令；`publish-release` 整体跳过（`L1487`），隐式建 Tag 路径被 `L1578–L1581` 拦住 |
| 不建 Release | ✅ | `L1487` job 级跳过 |
| 不上传 Release 资产 | ✅ | `L1859–L1881` 位于被跳过的 job 内 |
| 不公开发布 | ✅ | `L1904–L1920` 位于被跳过的 job 内；`verify-release` 亦跳过（`L1940`） |
| **残留（非「正式版本资产」）** | ⚠️ | `release-package` / `dry-run-image` / 扫描报告等 workflow artifact（N6）、GHA 缓存（`L1054`）、runner 本地 `deploy/.env`；均不进入 GHCR / Tag / Release |

**结论：干跑路径基本保证「完全不产生正式版本资产」，但 `package` 是唯一完全未消费 `dry_run` 的 job（N6），且 `dry_run` 输入类型未声明（N1）构成 fail-open 入口，两者须收口后才能称为「可靠」。**

---

## 5. 最终答复：「PR #32 合并后，是否具备可靠的 v0.0.9 正式公开发布入口？」

> **否。不具备可靠的、流水线内的 v0.0.9 正式公开发布入口；在 B1–B5 修复前，应冻结正式公开发布动作。**

### 5.1 三条路径推演

| 场景 | 输入 | 流水线行为 | 结果 |
|---|---|---|---|
| **① push tag `v0.0.9`**（白名单已含，`L59`） | `inputs.*` 全部不可用；`dry_run=false`（`L284`） | 全链跑完 → `build-image` 推 GHCR 镜像（`L1043`）→ `publish-release` 创建 Draft + 上传资产（`L1837–L1882`）→ `L1902` `PUBLISH='false'` ⇒ **保持 Draft**（`L1921–L1925`）→ `verify-release` 的匿名下载 / 网页可访问 / 公开形态断言因 `inputs.publish != true` **全部跳过**（`L2002`、`L2119`、`L1979`） | **只产出 Draft + 已公开可拉的镜像**，没有公开 Release，且发布后核验缺失 |
| **② 随后 `workflow_dispatch` `publish=true, dry_run=false`**（`L1924` 注释建议的做法） | Tag 已存在、Draft 已存在 | `preflight` `L398`「Release 已存在」⇒ `exit 1`（fail-closed 生效时）；若该闸门因 §2.4.2 失效而放行，`publish-release` `L1533` 同样可能放行 ⇒ `L1837` 用同一 `tag_name` 再建 Release ⇒ GitHub 409 | **被闸门拦死或撞 409，无法把 Draft 转公开** |
| **③ `workflow_dispatch` `publish=true` 且 Tag 存在、Release 从未创建**（纯补救路径） | 需「Tag 已存在但没有任何 Release/Draft」 | `L316–L389` 补救路径 → `L1837` 创建 Draft → `L1915–L1919` 当场转公开 → `verify-release` 执行公开核验 | **理论上唯一可执行公开发布的路径**，但要求第一次 tag push 的 run 完全没有创建 Draft（被取消 / 早于 `publish-release` 失败 / 人工删过 Draft）。而 tag push 必然自动触发一次 run（`L59` 白名单）并创建 Draft ⇒ **实际不可达、不可重复** |

### 5.2 唯一「可用」的公开发布方式及其代价

注释 `L1924` 给出的另一条路是「**手动在 GitHub 上发布**」。这确实能把 Draft 转公开，但：

1. 完全脱离流水线门禁：该 run 的 `inputs.publish=false`，`verify-release` 的「已发布 + Pre-release + 非 latest」（`L1979–L1985`）、匿名下载 + `sha256sum -c`（`L2001–L2029`）、Release 网页 HTTP 200（`L2116–L2126`）**三项核验一次都不会执行**；
2. GitHub UI 可能把 0.0.x 勾成 `latest`，而 `L1982–L1984` 的 `latest` 断言只在 `PUBLISH=='true'` 时生效 ⇒ 无门禁拦截；
3. 与 `L1749`「一次性风险接受**仅针对 v0.0.9 的发行决定**」的前提不匹配：风险决策尚未以可审计的方式落到流水线上；
4. 叠加 B1（资产来自 master 而非 Tag）、B4（并发覆盖）、B3（存在性闸门 fail-open），公开出去的资产**不可证明与 Tag 一致、不可证明未被覆盖、digest 从未核对**。

### 5.3 结论

- **PR #32 本身的改动**（Release Notes 重写 + soak 工作流时长诚实性闸门）**没有引入新的发布门禁逻辑**，也没有修复上述任何一项；master 与 PR32 的门禁逻辑逐字相同。
- 因此「PR #32 合并」**不会**改变发布入口的可靠性：合并前后同样**只有「Draft + 人工 UI 发布」这一条脱离门禁的路径**。
- **放行建议**：先修复 B1–B5（尤其 B1 构建上下文一致性与 B2 公开发布入口），完成一次 `dry_run=true` 与一次「补救路径 `publish=true`」的 CI 实跑（本机无 Docker daemon，须在 GitHub-hosted runner 上验证），再执行 v0.0.9 正式公开发布。在此之前，任何「已具备可靠公开发布入口」的判断均不成立。

---

## 6. 假设、未决事项与建议实跑验证（Anything UNCLEAR）

1. **gh CLI 版本未 pin**：`gh release view <tag>` 对 Draft 的可见性依赖 runner 预装 gh 版本的 `FetchRelease` draft fallback（上游源码已核对确实存在），但流水线无版本断言。B3 的「fail-open 结构」缺陷不依赖 gh 版本即成立；「draft 一定可见」的假设需实跑确认。
2. **`--latest=false` 语义**：gh manual 支持 `--draft=false` 语法，但未明示 `--latest=false` 是否真正写入 `make_latest=false`；因 Release 为 `prerelease=true` 且有 `L1982–L1984` 兜底，判为低风险，建议实跑确认。
3. **GitHub Actions 的 workflow 定义取触发 ref 的 commit**：本报告未以此作为核心证据（核心证据是「8 个 job `ref: master` + push tag 路径无 diff 校验」），但若该平台行为成立，则「workflow 定义来自 tag commit、被构建代码来自 master HEAD」会进一步放大 B1。建议实跑时在日志打印 `github.sha` / `git rev-parse HEAD` / `tag_sha` 三者比对。
4. **GHCR Packages visibility**：`L1711` 声明「匿名可直接拉取（Public 包）」，属仓库级配置，不在代码控制范围内；`L2066–L2114` 只作提示。B5 的严重程度取决于该配置，需实测确认。
5. **本次评审未验证**：Docker 镜像实际内容、ZIP 实际字节、`npm audit` 实时结果、GitHub 远端 Tag / Release 的当前状态（评审为只读静态审查，无 Docker daemon、未联网查询远端仓库状态）。
6. **跨团队接口**：R-01 合规结论、`soak-*.yml` 24h 设计的最终结论、Firefox E2E 修复（`16805f2`）均属其他成员任务范围，本报告不代为裁决；但 N11 与 `L1718–L1719` 的 Notes 措辞需要与其结论对齐后再发布。

---

## 附录 A：证据行号速查（均以 PR32 `8d6df8a` 为准）

| 主题 | 行号 |
|---|---|
| `on.push.tags` 白名单 | `L42–L59` |
| `workflow_dispatch` 输入 | `L60–L83` |
| `concurrency` | `L85–L88` |
| `permissions` / 顶层 env | `L91–L121` |
| `resolve-tag` | `L147–L203` |
| `preflight`（checkout / 版本 / dry_run / Tag 状态 / 补救 / Release 存在 / target） | `L208–L448`（`L220–L259`、`L261–L285`、`L287–L390`、`L392–L402`、`L404–L439`） |
| `code-checks` / `security-scan` | `L452–L476` / `L481–L751` |
| `unit-tests` / `e2e-tests` | `L756–L823` / `L828–L964` |
| `build-image` | `L969–L1109`（`L1002–L1012`、`L1014–L1020`、`L1022–L1031`、`L1035–L1063`、`L1073–L1088`、`L1090–L1109`） |
| `deploy-verify` | `L1114–L1392` |
| `package` | `L1397–L1474` |
| `publish-release` | `L1479–L1925`（`L1487`、`L1527–L1587`、`L1589–L1776`、`L1778–L1882`、`L1884–L1925`） |
| `verify-release` | `L1930–L2126`（`L1940`、`L1942–L1996`、`L2001–L2029`、`L2031–L2114`、`L2116–L2126`） |

## 附录 B：master 行号映射

master `af61635` 的 `release.yml` 为 2067 行；PR32 为 2126 行。差异仅在 Release Notes 区（master `L1594–L1717` ↔ PR32 `L1594–L1776`，净 +59）。

- master `L1–L1593` = PR32 `L1–L1593`（逐字相同）
- master `L1718+` = PR32 行号 − 59

示例：`gh api POST /releases` master `L1778` ↔ PR32 `L1837`；`PUBLISH=` master `L1843` ↔ PR32 `L1902`；`verify-release` 的 `if: dry_run` master `L1881` ↔ PR32 `L1940`；`git diff --name-only` 与 `digest` / `zip` / `sha256sum` 等 `L373 / L977 / L1015 / L1092 / L1418 / L1429 / L1487` 两版**同号**。

---

*报告结束。本次评审全程只读，未修改除本报告外的任何文件。*
