#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# V2EX Clone v0.0.20 — 附件数据库引用与物理文件双向对账
#
# 严重不一致（返回 1）：
#   · 非 purged 的 reply_images / avatars / users.avatar 引用不到物理文件；
#   · purged tombstone 仍有物理文件。
# 仅告警（不改变退出码）：
#   · 物理文件既不被数据库引用，也不在 purge queue 中。
#     这类文件可能是旧版本遗留或上传中断产物，默认保留供人工/宽限期处理。
#
# 用法：
#   ./reconcile-attachments.sh
# ---------------------------------------------------------------------------
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
UPLOAD_DIR="/app/data/uploads"

[ -f "$ENV_FILE" ] || { echo "[错误] 未找到 .env 配置。" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "[错误] 未检测到 docker 命令。" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "[错误] 未检测到 Docker Compose v2。" >&2; exit 1; }

read_env_value() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'"'"']//; s/["'"'"']$//'
}
POSTGRES_USER="$(read_env_value POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-v2ex}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-v2ex}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

APP_CID="$("${COMPOSE[@]}" ps -q app 2>/dev/null | head -1 || true)"
[ -n "$APP_CID" ] || { echo "[错误] 找不到 app 容器，无法读取 uploads 卷。" >&2; exit 1; }
MOUNTS="$(docker inspect "$APP_CID" --format '{{json .Mounts}}')"
printf '%s' "$MOUNTS" | grep -q '"Destination":"/app/data/uploads"' \
  || { echo "[错误] app 容器未挂载 /app/data/uploads。" >&2; exit 1; }

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/v2ex-attachment-reconcile.XXXXXX")"
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

"${COMPOSE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -t -A -F $'\t' <<'SQL' > "$TMP_DIR/db.tsv"
SELECT 'ref', storage_path FROM reply_images WHERE state <> 'purged'
UNION ALL
SELECT 'ref', storage_path FROM avatars
UNION ALL
SELECT 'ref', substring(avatar FROM '/uploads/(.*)$') FROM users WHERE avatar LIKE '/uploads/%'
UNION ALL
SELECT 'purged', storage_path FROM reply_images WHERE state = 'purged'
UNION ALL
SELECT 'known', storage_path FROM attachment_purge_queue;
SQL

: > "$TMP_DIR/refs.raw"
: > "$TMP_DIR/purged.raw"
: > "$TMP_DIR/known.raw"
awk -F '\t' \
  -v refs="$TMP_DIR/refs.raw" \
  -v purged="$TMP_DIR/purged.raw" \
  -v known="$TMP_DIR/known.raw" '
  $1 == "ref"    { print $2 > refs; next }
  $1 == "purged" { print $2 > purged; next }
  $1 == "known"  { print $2 > known; next }
' "$TMP_DIR/db.tsv"

# 服务端生成的路径不含换行；这里仍拒绝含换行的 DB 值，避免清单注入。
if awk 'index($0, "\r") || index($0, "\n") { bad=1 } END { exit bad ? 1 : 0 }' "$TMP_DIR/db.tsv"; then
  :
else
  echo "[错误] 数据库附件路径包含非法控制字符。" >&2
  exit 1
fi

"${COMPOSE[@]}" exec -T app sh -c \
  "find '$UPLOAD_DIR' -type f 2>/dev/null | sed 's#^$UPLOAD_DIR/##'" \
  > "$TMP_DIR/physical.raw"

for name in refs purged known physical; do
  LC_ALL=C sort -u "$TMP_DIR/$name.raw" > "$TMP_DIR/$name.sorted"
done

LC_ALL=C comm -23 "$TMP_DIR/refs.sorted" "$TMP_DIR/physical.sorted" > "$TMP_DIR/missing.txt"
LC_ALL=C comm -12 "$TMP_DIR/purged.sorted" "$TMP_DIR/physical.sorted" > "$TMP_DIR/purged-present.txt"
LC_ALL=C comm -23 "$TMP_DIR/physical.sorted" "$TMP_DIR/known.sorted" > "$TMP_DIR/orphans.txt"

MISSING_COUNT=$(wc -l < "$TMP_DIR/missing.txt" | tr -d ' ')
PURGED_PRESENT_COUNT=$(wc -l < "$TMP_DIR/purged-present.txt" | tr -d ' ')
ORPHAN_COUNT=$(wc -l < "$TMP_DIR/orphans.txt" | tr -d ' ')
PHYSICAL_COUNT=$(wc -l < "$TMP_DIR/physical.sorted" | tr -d ' ')
REF_COUNT=$(wc -l < "$TMP_DIR/refs.sorted" | tr -d ' ')

printf '附件对账：物理文件=%s 活跃引用=%s 缺失引用=%s purged 残留=%s 孤立文件=%s\n' \
  "$PHYSICAL_COUNT" "$REF_COUNT" "$MISSING_COUNT" "$PURGED_PRESENT_COUNT" "$ORPHAN_COUNT"

SEVERE=0
if [ "$MISSING_COUNT" -gt 0 ]; then
  SEVERE=1
  echo "[错误] 以下被引用的附件物理文件缺失（前 20 条）：" >&2
  awk 'NR <= 20 { print "  " $0 }' "$TMP_DIR/missing.txt" >&2
fi
if [ "$PURGED_PRESENT_COUNT" -gt 0 ]; then
  SEVERE=1
  echo "[错误] 以下 purged tombstone 仍残留物理文件（前 20 条）：" >&2
  awk 'NR <= 20 { print "  " $0 }' "$TMP_DIR/purged-present.txt" >&2
fi
if [ "$ORPHAN_COUNT" -gt 0 ]; then
  echo "[警告] 以下物理文件暂无数据库引用或 purge queue（前 20 条，默认保留）：" >&2
  awk 'NR <= 20 { print "  " $0 }' "$TMP_DIR/orphans.txt" >&2
fi

if [ "$SEVERE" -ne 0 ]; then
  echo "[错误] 附件对账发现严重不一致。" >&2
  exit 1
fi

echo "[成功] 附件数据库引用与物理文件一致。"
