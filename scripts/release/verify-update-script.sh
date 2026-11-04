#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# v0.0.4 — 升级脚本自检（不依赖 Docker）
#
# 用法：bash scripts/release/verify-update-script.sh
#
# 为什么需要它：
#   本机（以及很多 CI 环境）**没有 Docker**，无法对 deploy/update.sh 做容器级
#   实跑验证。但 update.sh 的核心价值恰恰在于「改写 .env 的 V2EX_IMAGE +
#   失败回滚」—— 这些逻辑是纯文本 + 命令编排，完全可以在**沙箱**里用
#   一个假的 docker 可执行文件（stub）来验证。
#
# 本脚本做什么：
#   1. `bash -n` 语法检查 deploy/update.sh / scripts/release/preflight.sh
#   2. 静态检查：**可执行代码**中不得出现 `down -v` / `compose down` /
#      破坏性数据库语句；必须具备改写 .env 的 V2EX_IMAGE 的能力
#   3. 在 mktemp -d 沙箱里放一份假的 deploy/.env、真实的 backup.sh 副本、
#      以及一个记录调用参数的 docker stub，然后跑真实的 update.sh
#   4. 断言：版本参数生效、pull 目标是新 tag、全程无 down -v、
#      pull 失败时非零退出且 .env 被恢复为旧值、备份失败中止升级、
#      非法版本号被拒绝、镜像未变化时告警中止
#   5. 断言：仓库真实文件在整个过程中**未被改动**
#
# 硬性约束：
#   - **绝不执行任何真实 Docker 命令**（PATH 里的 docker 被 stub 完全遮蔽）
#   - **绝不触碰仓库真实文件**：所有写入都发生在 mktemp -d 沙箱内
#   - 退出时自动清理沙箱目录
#
# 退出码：0 = 全部通过；1 = 存在失败项
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PASS=0
FAIL=0
FAILED_CASES=''

ok()   { printf '[PASS]  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '[FAIL]  %s\n' "$1"; FAIL=$((FAIL + 1)); FAILED_CASES="${FAILED_CASES}  - $1"$'\n'; }
note() { printf '        %s\n' "$1"; }
section() { printf '\n--- %s ---\n' "$1"; }

# ---------------------------------------------------------------------------
# 断言工具
# ---------------------------------------------------------------------------
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    ok "$label"
  else
    bad "$label"
    note "期望：${expected}"
    note "实际：${actual}"
  fi
}

assert_nonzero() {
  local label="$1" code="$2"
  if [ "$code" -ne 0 ]; then
    ok "$label（退出码 ${code}）"
  else
    bad "$label（退出码为 0，期望非零）"
  fi
}

assert_zero() {
  local label="$1" code="$2"
  if [ "$code" -eq 0 ]; then
    ok "$label（退出码 0）"
  else
    bad "$label（退出码 ${code}，期望 0）"
  fi
}

# 固定字符串包含（文件）
assert_file_contains() {
  local label="$1" file="$2" needle="$3"
  if [ -f "$file" ] && grep -qF -- "$needle" "$file"; then
    ok "$label"
  else
    bad "$label"
    note "文件 ${file} 中未找到：${needle}"
  fi
}

# 固定字符串包含（目录：检查是否有文件名包含 needle）
assert_dir_contains() {
  local label="$1" dir="$2" needle="$3"
  if [ -d "$dir" ] && find "$dir" -maxdepth 2 -name "*${needle}*" -print -quit 2>/dev/null | grep -q .; then
    ok "$label"
  else
    bad "$label"
    note "目录 ${dir} 下未找到含「${needle}」的文件"
  fi
}

# 正则匹配（文件）
assert_file_matches() {
  local label="$1" file="$2" pattern="$3"
  if [ -f "$file" ] && grep -Eq -- "$pattern" "$file"; then
    ok "$label"
  else
    bad "$label"
    note "文件 ${file} 未匹配模式：${pattern}"
  fi
}

# 正则**不得**匹配（文件）
assert_file_not_matches() {
  local label="$1" file="$2" pattern="$3"
  if [ ! -f "$file" ]; then
    bad "$label"
    note "文件不存在：${file}"
    return
  fi
  if grep -Eq -- "$pattern" "$file"; then
    bad "$label"
    note "文件 ${file} 中检出不允许的模式：${pattern}"
    grep -En -- "$pattern" "$file" | sed 's/^/        /'
  else
    ok "$label"
  fi
}

# 剥离「注释」与「heredoc 正文」，只保留真正的可执行代码。
# 理由：update.sh 的文档注释与 --help 帮助文本里会**提到**
# `docker compose down -v`（说明禁用它）。若不剥离，静态检查会误报。
#
# 实现说明：用 sed + awk 的组合，避免在 awk 里写含引号的正则。
strip_code() {
  local file="$1"
  # 1) 去掉行尾注释
  sed 's/#.*$//' "$file" > "$SANDBOX/.stripped.$$"
  # 2) 去掉 heredoc 正文（从 `<<WORD` 开始，到单独一行 WORD 结束）
  awk '
    BEGIN { inhere = 0; tag = "" }
    {
      if (inhere) {
        if ($0 ~ "^[[:space:]]*" tag "[[:space:]]*$") { inhere = 0 }
        next
      }
      line = $0
      if (index(line, "<<") > 0) {
        rest = substr(line, index(line, "<<") + 2)
        gsub(/^[-[:space:]'"'"'"]*/, "", rest)
        gsub(/[^A-Za-z0-9_].*$/, "", rest)
        if (rest != "") { tag = rest; inhere = 1 }
      }
      print line
    }
  ' "$SANDBOX/.stripped.$$"
  rm -f "$SANDBOX/.stripped.$$" 2>/dev/null || true
}

# 正则**不得**匹配（可执行代码中）
assert_code_not_matches() {
  local label="$1" file="$2" pattern="$3"
  if [ ! -f "$file" ]; then
    bad "$label"
    note "文件不存在：${file}"
    return
  fi
  local hits
  hits="$(strip_code "$file" | grep -En -- "$pattern" || true)"
  if [ -n "$hits" ]; then
    bad "$label"
    note "可执行代码中检出不允许的模式：${pattern}"
    printf '%s\n' "$hits" | sed 's/^/        /'
  else
    ok "$label"
  fi
}

# 统计文件中匹配的行数（避免 `grep -c ... || echo 0` 产生 "0\n0" 的经典陷阱）
count_matches() {
  local file="$1" pattern="$2" n
  n="$(grep -Ec -- "$pattern" "$file" 2>/dev/null | head -n 1)"
  [ -n "$n" ] || n=0
  printf '%s' "$n"
}

# ---------------------------------------------------------------------------
# 沙箱：选一个「POSIX 风格」的临时根目录
# ---------------------------------------------------------------------------
# 某些环境会把 rm 替换成「安全删除」包装器，它拒绝带盘符的 Windows 绝对路径
# （C:\...）并可能进入交互等待。统一改用 /tmp 风格的路径可以绕开该问题，
# 且在 Linux CI 上同样成立。
pick_tmp_root() {
  local candidate
  for candidate in "${TMPDIR:-}" /tmp; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      [A-Za-z]:*) continue ;;   # Windows 盘符路径：跳过
    esac
    if [ -d "$candidate" ] && [ -w "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

TMP_ROOT="$(pick_tmp_root || true)"
if [ -z "$TMP_ROOT" ]; then
  printf '[FAIL]  找不到可用的临时目录（TMPDIR 与 /tmp 均不可写）\n'
  exit 1
fi

SANDBOX="$(mktemp -d -p "$TMP_ROOT" v2ex-update-verify.XXXXXX 2>/dev/null || true)"
if [ -z "$SANDBOX" ] || [ ! -d "$SANDBOX" ]; then
  SANDBOX="$(mktemp -d 2>/dev/null || true)"
fi
if [ -z "$SANDBOX" ] || [ ! -d "$SANDBOX" ]; then
  printf '[FAIL]  无法创建沙箱目录\n'
  exit 1
fi

# 清理：优先用真实的 rm 二进制（绕开可能带交互提示的「安全删除」包装器）
safe_rm_rf() {
  local target="$1" cand
  for cand in /bin/rm /usr/bin/rm; do
    if [ -x "$cand" ] && [ "$(wc -c < "$cand" 2>/dev/null || echo 0)" -gt 2000 ]; then
      "$cand" -rf "$target" 2>/dev/null || true
      return 0
    fi
  done
  rm -rf "$target" 2>/dev/null || true
  return 0
}

# KEEP_SANDBOX=1 时保留沙箱目录（便于人工排查）
cleanup() {
  if [ "${KEEP_SANDBOX:-0}" = "1" ]; then
    printf '\n[KEEP_SANDBOX] 沙箱目录已保留：%s\n' "$SANDBOX"
    return 0
  fi
  safe_rm_rf "$SANDBOX"
}
trap cleanup EXIT INT TERM

printf '=== v0.0.4 update.sh 自检（无 Docker 依赖，沙箱模拟）===\n'
printf 'repo    : %s\n' "$REPO_ROOT"
printf 'sandbox : %s\n' "$SANDBOX"

# 记录「本自检脚本会读取的仓库文件」的校验和，最后断言它们未被改动。
# 注意：不能用 `git status --porcelain` 做整体比对 —— 仓库里可能有**其他成员**
# 并行产生的文件变化（如新加的 docs/ 证据），那与本脚本无关，
# 混在一起会产出假阳性。这里只关心自己碰过的文件。
TRACKED_INPUTS="$REPO_ROOT/deploy/update.sh
$REPO_ROOT/deploy/backup.sh
$REPO_ROOT/deploy/docker-compose.yml
$REPO_ROOT/scripts/release/preflight.sh
$REPO_ROOT/scripts/release/verify-update-script.sh"

checksum_snapshot() {
  local f
  for f in $TRACKED_INPUTS; do
    if [ -f "$f" ]; then
      printf '%s  %s\n' "$(cksum "$f" 2>/dev/null | cut -d' ' -f1,2)" "$f"
    else
      printf 'MISSING  %s\n' "$f"
    fi
  done
}

CHECKSUM_BEFORE="$(checksum_snapshot)"

# ---------------------------------------------------------------------------
# docker stub —— 记录所有调用，并模拟 compose 的行为
# ---------------------------------------------------------------------------
write_docker_stub() {
  local stub="$1"
  cat > "$stub" <<'STUB_EOF'
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 假的 docker（stub）—— 只为验证 deploy/update.sh 的编排逻辑。
# 行为约定：
#   · 每次调用都写入 $STUB_STATE_DIR/calls.log（CALL <原始参数>）
#   · `compose pull` / `compose up` 记录 PULL_TARGET / UP_TARGET
#     （模拟 compose 从 .env 读取 V2EX_IMAGE）
#   · `compose config` 输出 .env 中 V2EX_IMAGE（模拟 compose 的变量插值）
#   · `compose ps -q app` 返回一个假的容器 id
#   · `compose exec ... psql` 按 SQL 内容返回假的管理员数据
#   · `image inspect` / `inspect` 按镜像引用返回稳定的假 imageId
# ---------------------------------------------------------------------------
set -uo pipefail

STATE_DIR="${STUB_STATE_DIR:?STUB_STATE_DIR 必须设置}"
mkdir -p "$STATE_DIR"
LOG="$STATE_DIR/calls.log"
printf 'CALL %s\n' "$*" >> "$LOG"

sanitize() { printf '%s' "${1:-}" | tr -c 'A-Za-z0-9._-' '_'; }

# 同一引用永远得到同一个假 imageId（用内容哈希保证稳定）。
id_for_ref() {
  local ref="${1:-}" f h
  f="$STATE_DIR/imgid.$(sanitize "$ref")"
  if [ ! -f "$f" ]; then
    h="$(printf '%s' "$ref" | md5sum 2>/dev/null | cut -d' ' -f1)"
    if [ -z "$h" ]; then
      h="$(printf '%s' "$ref" | cksum | tr -d ' ')"
    fi
    printf 'sha256:%s' "$h" > "$f"
  fi
  cat "$f"
}

# 模拟 compose 读取 .env 得到的应用镜像。
env_image() {
  local f="${STUB_ENV_FILE:-$PWD/.env}"
  [ -f "$f" ] || return 0
  sed -n 's/^V2EX_IMAGE=//p' "$f" | tail -n 1
}

if [ "${1:-}" = "compose" ]; then
  shift
  sub="${1:-}"; shift || true
  case "$sub" in
    version)
      printf 'Docker Compose version v2.29.0 (stub)\n'
      exit 0 ;;
    config)
      printf 'services:\n  app:\n    image: %s\n' "$(env_image)"
      exit 0 ;;
    pull)
      if [ "${STUB_PULL_FAIL:-0}" = "1" ]; then
        printf 'Error response from daemon: pull access denied for %s\n' "$(env_image)" >&2
        exit 1
      fi
      img="$(env_image)"
      printf 'PULL_TARGET=%s\n' "$img" >> "$LOG"
      id_for_ref "$img" > /dev/null
      printf '%s' "$img" > "$STATE_DIR/pulled_image"
      exit 0 ;;
    up)
      img="$(env_image)"
      printf 'UP_TARGET=%s\n' "$img" >> "$LOG"
      printf '%s' "$img" > "$STATE_DIR/running_image"
      exit 0 ;;
    logs)
      exit 0 ;;
    ps)
      if [ "${1:-}" = "-q" ]; then
        printf 'stub-container-id\n'
      fi
      exit 0 ;;
    exec)
      sql=""
      while [ $# -gt 0 ]; do
        if [ "$1" = "--command" ]; then
          sql="${2:-}"; shift
        fi
        shift
      done
      # 注意：bash 的 case 模式里不能出现未转义的 '('，因此这里用 if + 引号 glob。
      if [[ "$sql" == *"password_hash"* ]]; then
        printf '%s\n' "${STUB_ADMIN_HASH:-stub-password-hash}"
      elif [[ "$sql" == *"count("* ]]; then
        printf '1\n'
      else
        printf '\n'
      fi
      exit 0 ;;
    *)
      exit 0 ;;
  esac
fi

case "${1:-}" in
  image)
    shift
    sub="${1:-}"; shift || true
    if [ "$sub" = "inspect" ]; then
      ref="${!#}"
      case "$*" in
        *RepoDigests*) printf '%s@sha256:0000000000000000000000000000000000000000000000000000000000000000\n' "$ref" ;;
        *) id_for_ref "$ref" ;;
      esac
    fi
    exit 0 ;;
  inspect)
    shift
    # docker inspect --format '<fmt>' <ref>
    fmt=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--format" ]; then
        fmt="${2:-}"; shift
      fi
      shift
    done
    case "$fmt" in
      '{{.Image}}')
        ref="$(cat "$STATE_DIR/running_image" 2>/dev/null || echo '')"
        if [ -n "$ref" ]; then id_for_ref "$ref"; else printf '<未知>'; fi ;;
      *RepoDigests*) printf 'sha256:0000000000000000000000000000000000000000000000000000000000000000\n' ;;
      *) printf 'healthy\n' ;;
    esac
    exit 0 ;;
  volume)
    shift
    sub="${1:-}"; shift || true
    if [ "$sub" = "ls" ]; then
      printf 'v2ex_postgres-data\nv2ex_redis-data\n'
    fi
    exit 0 ;;
  *)
    exit 0 ;;
esac
STUB_EOF
  chmod +x "$stub"
}

# ---------------------------------------------------------------------------
# 沙箱准备
# ---------------------------------------------------------------------------
# setup_case <case-name> —— 建立一个独立的沙箱用例目录
setup_case() {
  local name="$1"
  local dir="$SANDBOX/$name"
  mkdir -p "$dir/deploy" "$dir/bin" "$dir/state"

  # 被测脚本（从仓库只读复制）
  cp "$REPO_ROOT/deploy/update.sh" "$dir/deploy/update.sh"
  chmod +x "$dir/deploy/update.sh"

  # compose 文件（update.sh 会 cd 到 deploy/ 下运行）
  cp "$REPO_ROOT/deploy/docker-compose.yml" "$dir/deploy/docker-compose.yml"

  # 真实的 backup.sh（验证「复用既有备份脚本」而不是重写）
  cp "$REPO_ROOT/deploy/backup.sh" "$dir/deploy/backup.sh"
  chmod +x "$dir/deploy/backup.sh"

  # 假的 .env
  cat > "$dir/deploy/.env" <<'ENV_EOF'
# 沙箱用的假配置
V2EX_IMAGE=ghcr.io/alicia1030su/v2ex-clone:v0.0.3
COMPOSE_PROJECT_NAME=v2ex
APP_PORT=3000
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_RUNTIME_ENV=production
POSTGRES_USER=v2ex
POSTGRES_DB=v2ex
POSTGRES_PASSWORD=fake-postgres-pass
REDIS_PASSWORD=fake-redis-pass
SESSION_SECRET=fake-session-secret-0123456789
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=FakeAdminPass123
SEED_DEMO_USERS=0
ENV_EOF

  # docker stub
  write_docker_stub "$dir/bin/docker"

  printf '%s' "$dir"
}

# run_update <case-dir> [args...] —— 在沙箱里运行真实的 update.sh
run_update() {
  local dir="$1"; shift
  (
    cd "$dir/deploy" || exit 99
    PATH="$dir/bin:$PATH" \
    STUB_STATE_DIR="$dir/state" \
    STUB_ENV_FILE="$dir/deploy/.env" \
    V2EX_UPDATE_NONINTERACTIVE=1 \
    NO_COLOR=1 \
    HEALTH_TIMEOUT=5 \
    ROLLBACK_TIMEOUT=5 \
    bash ./update.sh "$@"
  )
}

env_image_of() {
  sed -n 's/^V2EX_IMAGE=//p' "$1/deploy/.env" 2>/dev/null | tail -n 1
}

calls_log_of() { printf '%s' "$1/state/calls.log"; }

# 把脚本输出写入文件，便于用 grep 做断言
save_output() {
  local file="$1" content="$2"
  printf '%s\n' "$content" > "$file"
  printf '%s' "$file"
}

# ===========================================================================
section "1. 语法检查"
# ===========================================================================
if bash -n "$REPO_ROOT/deploy/update.sh" 2>/dev/null; then
  ok "deploy/update.sh 通过 bash -n 语法检查"
else
  bad "deploy/update.sh 通过 bash -n 语法检查"
  bash -n "$REPO_ROOT/deploy/update.sh" 2>&1 | sed 's/^/        /'
fi
if bash -n "$REPO_ROOT/scripts/release/preflight.sh" 2>/dev/null; then
  ok "scripts/release/preflight.sh 通过 bash -n 语法检查"
else
  bad "scripts/release/preflight.sh 通过 bash -n 语法检查"
fi
if bash -n "$REPO_ROOT/scripts/release/verify-update-script.sh" 2>/dev/null; then
  ok "scripts/release/verify-update-script.sh 通过 bash -n 语法检查"
else
  bad "scripts/release/verify-update-script.sh 通过 bash -n 语法检查"
fi

# ===========================================================================
section "2. 静态安全检查（deploy/update.sh 的可执行代码）"
# ===========================================================================
U="$REPO_ROOT/deploy/update.sh"

assert_code_not_matches 'update.sh 可执行代码中不存在 `down -v`（不得删除数据卷）' "$U" 'down[[:space:]]+-v'
assert_code_not_matches 'update.sh 可执行代码中不存在任何 `compose down` 调用' "$U" 'compose[[:space:]]+down'
assert_code_not_matches 'update.sh 可执行代码中不存在破坏性数据库语句（删表 / 清空表 / 删库）' "$U" '(DROP[[:space:]]+TABLE|TRUNCATE|DROP[[:space:]]+DATABASE|DELETE[[:space:]]+FROM)'
assert_code_not_matches 'update.sh 可执行代码中**不执行** restore.sh（只作为人工指引出现在提示文本里）' "$U" '(^|[^"[:alnum:]])(\./)?restore\.sh[[:space:]]*$|bash[[:space:]]+[^"]*restore\.sh'

# 复刻 .github/workflows/install-verify.yml 里既有的「不执行 down -v」闸门。
# 注意：那个闸门只排除**注释行**与 echo/info/warn/printf 引导文本，
# 因此 --help 的 heredoc 正文必须**不含** `down -v` 字面量，否则 CI 会误判。
CI_GATE_HIT="$(grep -vE "^[[:space:]]*#" "$U" \
  | grep -E "^[[:space:]]*(echo|info|warn|printf)" \
  | grep -cE "down[[:space:]]+-v|down[[:space:]]+--volumes" || true)"
if [ "${CI_GATE_HIT:-0}" -eq 0 ]; then
  ok 'update.sh 不含 `down -v` 引导文本（不会触发 install-verify.yml 的既有闸门）'
else
  bad "update.sh 不含 `down -v` 引导文本（会触发 install-verify.yml 的既有闸门）"
fi
CI_GATE_EXEC="$(grep -vE "^[[:space:]]*#" "$U" \
  | grep -cE "docker[[:space:]]+compose[[:space:]]+down[[:space:]]+(-v|--volumes)" || true)"
if [ "${CI_GATE_EXEC:-0}" -eq 0 ]; then
  ok 'update.sh 不会执行 docker compose down -v（通过 install-verify.yml 的既有闸门）'
else
  bad 'update.sh 不会执行 docker compose down -v（通过 install-verify.yml 的既有闸门）'
fi
assert_file_matches 'update.sh 具备改写 .env 中 V2EX_IMAGE 的能力（update_env_value V2EX_IMAGE）' "$U" 'update_env_value[[:space:]]+V2EX_IMAGE'
assert_file_matches 'update.sh 会实际把 .env 的 V2EX_IMAGE 改写为目标镜像' "$U" 'update_env_value[[:space:]]+V2EX_IMAGE[[:space:]]+"\$TARGET_IMAGE"'
assert_file_matches 'update.sh 存在回滚路径（rollback 函数）' "$U" '^rollback\(\)'
assert_file_matches 'update.sh 复用既有 backup.sh 做升级前备份' "$U" 'backup\.sh'
assert_file_matches 'update.sh 用 docker compose config 校验 compose 实际解析到的镜像' "$U" 'compose config'
assert_file_matches 'update.sh 支持 --version 参数' "$U" '\-\-version'
assert_file_matches 'update.sh 支持 --image 参数' "$U" '\-\-image'
assert_file_matches 'update.sh 校验管理员口令哈希未变' "$U" 'ADMIN_HASH_BEFORE'
assert_file_matches 'update.sh 校验数据卷仍在' "$U" 'docker volume ls'
assert_file_matches 'update.sh 显式声明不做破坏性数据库回滚' "$U" '不会.*破坏性数据库回滚'

# ===========================================================================
section "3. 用例：--version v0.0.4（核心正向路径）"
# ===========================================================================
CASE_DIR="$(setup_case case-version)"
OUT_FILE="$SANDBOX/out-case-version.txt"
run_update "$CASE_DIR" --version v0.0.4 > "$OUT_FILE" 2>&1
RC=$?

assert_zero '用例 3.1：--version v0.0.4 退出码为 0' "$RC"
if [ "$RC" -ne 0 ]; then
  note '--- 脚本输出（末尾 40 行）---'
  tail -n 40 "$OUT_FILE" | sed 's/^/        /'
fi

assert_eq '用例 3.2：.env 的 V2EX_IMAGE 已从 v0.0.3 升级为 v0.0.4' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.4' "$(env_image_of "$CASE_DIR")"

LOG_FILE="$(calls_log_of "$CASE_DIR")"
PULL_TARGET="$(grep -m1 '^PULL_TARGET=' "$LOG_FILE" 2>/dev/null | cut -d= -f2-)"
assert_eq '用例 3.3：stub 记录到的 pull 目标就是 v0.0.4 的镜像' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.4' "$PULL_TARGET"

UP_TARGET="$(grep -m1 '^UP_TARGET=' "$LOG_FILE" 2>/dev/null | cut -d= -f2-)"
assert_eq '用例 3.4：stub 记录到的 up -d 目标就是 v0.0.4 的镜像' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.4' "$UP_TARGET"

assert_eq '用例 3.5：全程没有出现任何 down 调用（数据卷不会被删除）' '0' \
  "$(count_matches "$LOG_FILE" 'down')"
assert_eq '用例 3.6：全程没有出现任何 -v 卷删除参数' '0' \
  "$(count_matches "$LOG_FILE" '(-v|--volumes)')"

assert_file_contains '用例 3.7：.env 中其它条目未被破坏（POSTGRES_PASSWORD 保留）' \
  "$CASE_DIR/deploy/.env" 'POSTGRES_PASSWORD=fake-postgres-pass'
assert_file_contains '用例 3.8：.env 的注释与结构被保留' \
  "$CASE_DIR/deploy/.env" '# 沙箱用的假配置'
assert_file_contains '用例 3.9：.env 中管理员口令未被改动' \
  "$CASE_DIR/deploy/.env" 'SEED_ADMIN_PASSWORD=FakeAdminPass123'
assert_dir_contains '用例 3.10：升级前已生成 .env 备份副本' \
  "$CASE_DIR/deploy/backups" '.env.pre-update-'
assert_dir_contains '用例 3.11：升级前已生成数据库备份（复用 backup.sh）' \
  "$CASE_DIR/deploy/backups" 'v2ex-'
assert_file_contains '用例 3.12：输出中打印了旧 tag → 新 tag 的切换' \
  "$OUT_FILE" 'ghcr.io/alicia1030su/v2ex-clone:v0.0.3 → ghcr.io/alicia1030su/v2ex-clone:v0.0.4'
assert_file_contains '用例 3.13：输出中包含升级前后的 digest 对比' \
  "$OUT_FILE" '升级前 digest'
assert_file_contains '用例 3.14：输出中包含升级后的 digest' \
  "$OUT_FILE" '升级后 digest'
assert_file_contains '用例 3.15：输出中校验了管理员账号仍在且口令哈希未变' \
  "$OUT_FILE" '口令哈希未变'
assert_file_contains '用例 3.16：输出中校验了数据卷仍在' \
  "$OUT_FILE" '数据卷仍在'

# ===========================================================================
section "4. 用例：docker compose pull 失败 → 非零退出且 .env 被恢复"
# ===========================================================================
CASE_DIR="$(setup_case case-pull-fail)"
OUT_FILE="$SANDBOX/out-case-pull-fail.txt"
STUB_PULL_FAIL=1 run_update "$CASE_DIR" --version v0.0.4 > "$OUT_FILE" 2>&1
RC=$?

assert_nonzero '用例 4.1：pull 失败时脚本以非零码退出' "$RC"
assert_eq '用例 4.2：pull 失败后 .env 的 V2EX_IMAGE 已恢复为旧值 v0.0.3' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"
LOG_FILE="$(calls_log_of "$CASE_DIR")"
assert_eq '用例 4.3：pull 失败后没有执行 up -d（未改动运行中的容器）' '0' \
  "$(count_matches "$LOG_FILE" '^UP_TARGET=')"
assert_file_contains '用例 4.4：输出中明确说明未执行破坏性数据库回滚' \
  "$OUT_FILE" '破坏性数据库回滚'
assert_file_contains '用例 4.5：输出中说明已恢复旧 V2EX_IMAGE' \
  "$OUT_FILE" '已恢复 .env 中的旧 V2EX_IMAGE'

# ===========================================================================
section "5. 用例：非法 / 空版本号必须被拒绝"
# ===========================================================================
CASE_DIR="$(setup_case case-bad-version)"
OUT_FILE="$SANDBOX/out-case-bad-version.txt"
run_update "$CASE_DIR" --version '' > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 5.1：空版本号被拒绝（非零退出）' "$RC"
assert_eq '用例 5.2：空版本号被拒绝后 .env 未被改动' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"

CASE_DIR="$(setup_case case-illegal-version)"
OUT_FILE="$SANDBOX/out-case-illegal-version.txt"
run_update "$CASE_DIR" --version 'not-a-version' > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 5.3：非法版本号被拒绝（非零退出）' "$RC"
assert_eq '用例 5.4：非法版本号被拒绝后 .env 未被改动' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"

CASE_DIR="$(setup_case case-bad-tag)"
OUT_FILE="$SANDBOX/out-case-bad-tag.txt"
run_update "$CASE_DIR" --image 'ghcr.io/alicia1030su/v2ex-clone' > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 5.5：缺少 tag 的镜像引用被拒绝（非零退出）' "$RC"
assert_eq '用例 5.6：缺少 tag 的镜像引用被拒绝后 .env 未被改动' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"

CASE_DIR="$(setup_case case-both-args)"
OUT_FILE="$SANDBOX/out-case-both-args.txt"
run_update "$CASE_DIR" --version v0.0.4 --image 'ghcr.io/x/y:v1' > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 5.7：同时给 --version 与 --image 被拒绝（非零退出）' "$RC"

CASE_DIR="$(setup_case case-unknown-arg)"
OUT_FILE="$SANDBOX/out-case-unknown-arg.txt"
run_update "$CASE_DIR" --bogus > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 5.8：未知参数被拒绝（非零退出）' "$RC"

# ===========================================================================
section "6. 用例：--image 指定完整镜像引用"
# ===========================================================================
CASE_DIR="$(setup_case case-image)"
OUT_FILE="$SANDBOX/out-case-image.txt"
run_update "$CASE_DIR" --image 'ghcr.io/alicia1030su/v2ex-clone:v0.0.5' > "$OUT_FILE" 2>&1
RC=$?
assert_zero '用例 6.1：--image 正常退出码为 0' "$RC"
assert_eq '用例 6.2：.env 的 V2EX_IMAGE 被更新为 --image 指定的引用' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.5' "$(env_image_of "$CASE_DIR")"
LOG_FILE="$(calls_log_of "$CASE_DIR")"
assert_eq '用例 6.3：pull 目标与 --image 一致' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.5' \
  "$(grep -m1 '^PULL_TARGET=' "$LOG_FILE" 2>/dev/null | cut -d= -f2-)"

# ===========================================================================
section "7. 用例：向后兼容（不传参数，沿用 .env 中的 V2EX_IMAGE）"
# ===========================================================================
CASE_DIR="$(setup_case case-backcompat)"
OUT_FILE="$SANDBOX/out-case-backcompat.txt"
run_update "$CASE_DIR" > "$OUT_FILE" 2>&1
RC=$?
assert_zero '用例 7.1：不传参数时正常退出（沿用 .env 中的镜像）' "$RC"
assert_eq '用例 7.2：不传参数时 .env 的 V2EX_IMAGE 保持原值' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"

# ===========================================================================
section "8. 用例：目标镜像与当前运行镜像完全相同 → 告警并中止"
# ===========================================================================
CASE_DIR="$(setup_case case-same-image)"
# 让 stub 报告「运行中的镜像」就是目标镜像，模拟 tag 变了但镜像内容没变
printf 'ghcr.io/alicia1030su/v2ex-clone:v0.0.4' > "$CASE_DIR/state/running_image"
OUT_FILE="$SANDBOX/out-case-same-image.txt"
run_update "$CASE_DIR" --version v0.0.4 > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 8.1：镜像未变化时以非零码退出（未静默「假升级」）' "$RC"
assert_eq '用例 8.2：镜像未变化时退出码为 3（专门标识「目标版本未变化」）' '3' "$RC"
assert_eq '用例 8.3：镜像未变化中止后 .env 恢复为旧值' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"
assert_file_contains '用例 8.4：输出中给出「目标版本镜像未变化」的醒目提示' \
  "$OUT_FILE" '完全相同'
LOG_FILE="$(calls_log_of "$CASE_DIR")"
assert_eq '用例 8.5：镜像未变化时未重建容器' '0' \
  "$(count_matches "$LOG_FILE" '^UP_TARGET=')"

# ===========================================================================
section "9. 用例：备份失败必须中止升级"
# ===========================================================================
CASE_DIR="$(setup_case case-backup-fail)"
cat > "$CASE_DIR/deploy/backup.sh" <<'BK_EOF'
#!/usr/bin/env bash
echo "stub: 备份失败（模拟 pg_dump 失败）" >&2
exit 1
BK_EOF
chmod +x "$CASE_DIR/deploy/backup.sh"
OUT_FILE="$SANDBOX/out-case-backup-fail.txt"
run_update "$CASE_DIR" --version v0.0.4 > "$OUT_FILE" 2>&1
RC=$?
assert_nonzero '用例 9.1：备份失败时脚本以非零码退出' "$RC"
assert_eq '用例 9.2：备份失败后 .env 未被改动（不带着没有备份的状态继续升级）' \
  'ghcr.io/alicia1030su/v2ex-clone:v0.0.3' "$(env_image_of "$CASE_DIR")"
LOG_FILE="$(calls_log_of "$CASE_DIR")"
assert_eq '用例 9.3：备份失败时没有执行 pull' '0' \
  "$(count_matches "$LOG_FILE" '^PULL_TARGET=')"

# ===========================================================================
section "10. 仓库真实文件未被改动"
# ===========================================================================
CHECKSUM_AFTER="$(checksum_snapshot)"
if [ "$CHECKSUM_BEFORE" = "$CHECKSUM_AFTER" ]; then
  ok '自检全程未改动任何仓库真实文件（校验和前后一致）'
  note '  说明：只比对本脚本读取过的文件；仓库中其他成员的并行改动与本自检无关。'
else
  bad '自检全程未改动任何仓库真实文件（校验和前后不一致）'
  note '--- before ---'
  printf '%s\n' "$CHECKSUM_BEFORE" | sed 's/^/        /'
  note '--- after ---'
  printf '%s\n' "$CHECKSUM_AFTER" | sed 's/^/        /'
fi

# ---------------------------------------------------------------------------
printf '\n=== 自检汇总 ===\n'
printf 'PASS=%s  FAIL=%s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '失败项：\n%s' "$FAILED_CASES"
  printf '结论：update.sh 自检**未通过**。\n'
  exit 1
fi
printf '结论：update.sh 自检全部通过（沙箱模拟，未调用真实 Docker）。\n'
printf '沙箱目录 %s 将在本进程退出时被清理。\n' "$SANDBOX"
exit 0
