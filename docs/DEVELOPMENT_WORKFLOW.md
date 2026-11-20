# 开发工作流：显式暂存与提交安全

> 适用范围：本仓库所有开发者、自动化代理与 CI。
> 引入版本：v0.0.18（P0-2）。
> 背景：v0.0.17 曾三次因 `git add -A` 把 `.m` / `.msg2` / `.cm` 提交信息草稿带入仓库。

## 1. 一次性安装本地门禁

在仓库根目录执行：

```bash
git config core.hooksPath .githooks
git config --show-origin --get core.hooksPath
```

第二条应输出 `.git/config` 与 `.githooks`。`.githooks/pre-commit` 会调用唯一的检查实现
`scripts/git/check-staged-files.mjs`，对**当前暂存区**执行路径与新增行检查。

Windows / Git for Windows 同样支持该 hook。检查脚本使用 `fileURLToPath(import.meta.url)`
判断主入口，不能改回 `new URL(import.meta.url).pathname`：后者在 Windows 下会产生
`/C:/...`，与 `process.argv[1]` 的 `C:\...` 不相等，导致检查被静默跳过。

## 2. 只允许显式文件暂存

统一使用：

```bash
node scripts/git/safe-stage.mjs path/to/a.ts path/to/b.ts
```

工具会：

1. 拒绝 `-A`、`--all`、`.`、目录、glob（`*` / `?` / `[...]`）；
2. 拒绝仓库外路径；
3. 拒绝不存在的未跟踪路径；
4. 允许显式暂存**已跟踪文件的删除**；
5. 拒绝草稿、环境文件、私钥、运行时目录等禁止路径；
6. 先执行 `git add --dry-run`，成功后才真正修改索引；
7. 逐条打印实际暂存的仓库相对路径。

禁止无差别暂存：

```bash
git add -A          # 禁止
git add --all       # 禁止
git add .           # 禁止
git add src/        # 禁止：目录可能夹带未审阅文件
git add '*.ts'      # 禁止：通配符会扩大范围
```

确需批量改动时，先审阅 `git status --short` 与 `git diff`，再把**每一个文件**写进
`safe-stage` 参数。文件多不是使用 `-A` 的理由。

## 3. 提交前检查

可随时手动运行：

```bash
node scripts/git/check-staged-files.mjs
```

检查规则：

- 禁止文件名：`.m`、`.msg`、`.msg2`、`.cm`、`.commitmsg`、`.env` 及常见环境文件、
  `INSTALL_CREDENTIALS.txt`、`id_rsa`、`id_ed25519`；
- 禁止目录片段：`backups/`、`.git/`、`node_modules/`；
- 禁止扩展名：`.pem`、`.key`、`.p12`、`.pfx`；
- 只扫描**暂存新增行**中的疑似明文凭据，避免历史内容与示例误伤；
- 任一违规非零退出，并指出文件与原因。

模板文件（如 `.env.example`）不受 `.env` 精确文件名规则影响，但仍须确保其中没有真实凭据。

提交信息优先用 `git commit -m "..."`。若必须使用信息文件，放在仓库外；不要把 `.msg` /
`.cm` 等草稿放在工作区根目录。

## 4. 不得绕过门禁

不得使用 `git commit --no-verify`，也不得为了“先提交再清理”而关闭 hook。
门禁失败时，应修正暂存内容：

```bash
git restore --staged path/to/file
node scripts/git/safe-stage.mjs path/to/correct-file
git commit -m "..."
```

## 5. CI 兜底及其边界

CI 的 unit job 在安装依赖前执行：

```bash
node scripts/git/check-staged-files.mjs --tree HEAD
```

该模式复核 HEAD 完整文件树的禁止路径，即使开发者漏装本地 hook 也会判红。
它**只做路径级检查**；新增行内容扫描依赖本地 pre-commit。因此 CI 通过不等于已完成完整
秘密扫描，提交者仍必须执行本地门禁并审阅 diff。

## 6. 验证

```bash
node node_modules/vitest/vitest.mjs run \
  --config vitest.static.config.ts \
  tests/static/v018-git-staging-safety.spec.ts
```

测试使用真实临时 Git 仓库，覆盖：显式暂存、删除暂存、无差别暂存拒绝、禁止文件拒绝、
hook 正向放行、hook 负向拦截、提交树 CI 模式与文档/工作流接线。
