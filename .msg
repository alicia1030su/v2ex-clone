fix(v0.0.17): 「创建 Release」step 缺 PRERELEASE 变量 —— 真实发布失败在这里

## 现场（正式发布 run 44651226124）
前 9 个 job 全部成功（含**镜像已真实推送到 GHCR**、部署 ZIP 已构建），
只有「创建并发布 Release」失败，且 Release **完全没有被创建**（不是 Draft）。

根因与之前那次 `VERSION: unbound variable` **完全同类**：

    if [ "$PRERELEASE" = "true" ]; then   # ← 该 step 的 env 里没有它
    ...
    bash: PRERELEASE: unbound variable
    ##[error]Process exited with code 1

`set -euo pipefail` 下未定义变量直接退出；报错落在判断语句行，
看不出根因是「这个 step 只继承 workflow 级 env，看不到 needs 的输出」。

## 从上一处错误学到的，这次没有吸取
上一轮已因 `VERSION` 踩过同一个坑，并在注释里写了「step 看不到上一步的 output」。
但**只修了那一个变量**，没有检查其余 step 是否也这样用 ——
`PRERELEASE` 就藏在下一个 step 里。这与本仓反复记录的
「成对出现的判据要一起改」是同一类：**同类缺陷要一次找全，而不是修一个报一个**。

## 修法
1. 「创建 Release（先 draft）」step 的 `env` 增加
   `PRERELEASE: ${{ needs.preflight.outputs.prerelease }}`
2. **Draft 的形态也跟随**：原先无条件 `-F prerelease=true`，
   稳定版会先建出一个 Pre-release 的 Draft 再改 —— 中间态本身就是错的。
   改为 `-F prerelease=$DRAFT_PRERELEASE`，且打印出来便于核对。

## 为什么不需要移动 Tag
流水线自带**补救路径**（`workflow_dispatch` + `publish=true`）：
Tag 已存在时，只在「构建相关路径」零差异的前提下复用 Tag、补建 Release。
本次改动只碰 `.github/workflows/` —— 它**不在** BUILD_PATHS 白名单
（deploy/ src/ package.json package-lock.json drizzle/ Dockerfile
 .dockerignore next.config.mjs public/ tsconfig.json）里，
因此镜像与安装包内容与 Tag **逐字节一致**，补建 Release 是安全的。

## 验证
- 本地 YAML 解析通过
- 下一步：合并后用 workflow_dispatch（publish=true, prerelease=false）
  走补救路径，并核对 Release 的 prerelease/draft/latest 三态
