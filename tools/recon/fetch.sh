#!/usr/bin/env bash
# V2EX 原站抓取工具（阶段一：逆向调查）
#
# 网络说明：本机 WorkBuddy 沙箱代理会拦截 v2ex.com（CONNECT tunnel 502）。
# 本脚本通过用户自带的 xray HTTP 代理 (127.0.0.1:10001) 出站，仅作为客户端使用，
# 不修改任何代理/浏览器配置。
#
# 用法: ./fetch.sh <path> <outfile> [extra-curl-args...]
#   例: ./fetch.sh "/" evidence/home.html

set -uo pipefail

V2_PROXY="${V2_PROXY:-http://127.0.0.1:10001}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

PATH_PART="${1:?usage: fetch.sh <path> <outfile>}"
OUT="${2:?usage: fetch.sh <path> <outfile>}"
shift 2

mkdir -p "$(dirname "$OUT")"

curl -sS -x "$V2_PROXY" \
  --max-time 30 \
  --compressed \
  -A "$UA" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" \
  "$@" \
  "https://www.v2ex.com${PATH_PART}" \
  -o "$OUT" \
  -w "%{http_code} %{size_download}\n"
