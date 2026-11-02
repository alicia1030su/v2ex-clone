#!/usr/bin/env bash
# 阶段一批量抓取：按页面清单抓取原站 HTML，保存到 docs/evidence/html/
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

OUT="docs/evidence/html"
mkdir -p "$OUT"

# 页面清单: 路径|输出名|是否需要登录(yes/no)
PAGES=(
  "/|home|no"
  "/go|nav_go|no"
  "/go/tech|node_tech|no"
  "/go/programmer|node_programmer|no"
  "/go/create|node_create|no"
  "/go/ideas|node_ideas|no"
  "/go/qna|node_qna|no"
  "/nodes|nodes_all|no"
  "/recent|recent|no"
  "/hot|hot|no"
  "/feed|feed|no"
  "/index|index|no"
  "/t/1024000|topic_sample|no"
  "/login|login|no"
  "/register|register|no"
  "/signup|signup|no"
  "/settings|settings|yes"
  "/notifications|notifications|yes"
  "/bookmarks|bookmarks|yes"
  "/search?q=node|search|no"
  "/go/tech?p=2|node_tech_p2|no"
  "/member/1|member_sample|no"
  "/explore|explore|no"
  "/topics|topics_legacy|no"
  "/about|about|no"
  "/faq|faq|no"
  "/values|values|no"
)

for entry in "${PAGES[@]}"; do
  IFS='|' read -r path name auth <<< "$entry"
  printf '%-22s ' "$name"
  code=$(./tools/recon/fetch.sh "$path" "$OUT/$name.html" | awk '{print $1}')
  size=$(wc -c < "$OUT/$name.html" 2>/dev/null || echo 0)
  echo "http=$code size=$size"
  sleep 1
done
