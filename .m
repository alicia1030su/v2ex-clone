fix(v0.0.17): 远端核验写死「必须 prerelease」—— Release 已正确建成却判红

真实影响（run 44659056915）："创建并发布 Release" 成功了，Release 实际状态正确：

  prerelease=false  draft=false  latest=v0.0.17
  assets: SHA256SUMS(96B) + v2ex-clone-v0.0.17-deploy.zip(145353B)

但"远端核验" job 判红：##[error]Release 未标记 prerelease

判据把「必须 prerelease」写死了 —— 稳定版发布时必然自相矛盾。
这与本仓 v0.0.15 记录的「判据不能假设状态应该是某一种」完全同类。

本轮的结构性疏漏：
为了保证发稳定版，我把产出侧全改成了跟随形态
（白名单 / Release 名称 / Notes 标题与警示 / --latest），却漏了核验侧。
产出与核验口径不一 => 自己判自己错。

修法：
- 核验脚本接收 PRERELEASE（来自 preflight，与产出侧同源）
- 形态判据改为「声明 vs 实际」等值比对，两个方向都能报错且文案可区分
- latest 双向判据：
  · 预发布不得占用 latest（否则用户以为它是稳定版）
  · 稳定版应当成为 latest（否则用户以为最新稳定版还是上一版）

护栏 8 条（tests/static/v017-release-form-consistency.spec.ts）：
核验必须拿到 PRERELEASE / 不得写死「必须 prerelease」/
反向也不得写死「必须是稳定版」/ 必须做等值比对 /
latest 双向判据 / 报错文案可区分 / 所有形态读取同源 /
核验不得自己重读白名单（避免第二个真相来源）/ 预演与本 spec 口径一致。

负向对照（2 项，实测判红后恢复）：
退回 if not is_prerelease: => 判红（2 条）；核验不传 PRERELEASE => 判红。

验证：tsc 0；静态 37 文件 / 436 用例通过。
Release 本身不需要重建 —— 它已经是正确的 Stable Release，
这次只修「核验它的代码」，不碰任何已发布资产。
