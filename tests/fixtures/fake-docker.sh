#!/usr/bin/env bash
# 测试用假 docker：只 echo 参数，不做任何真实操作。
# 用于验证 install.sh 的配置生成阶段（口令生成、幂等、不泄露）。
case "${1:-}" in
  info)
    echo "Server Version: 27.0.0 (fake)"
    exit 0
    ;;
  compose)
    shift
    case "${1:-}" in
      version)
        if [ "${2:-}" = "--short" ]; then echo "2.29.0"; else echo "Docker Compose version v2.29.0"; fi
        exit 0
        ;;
      pull)
        echo "[shim] docker compose pull $*"
        exit 0
        ;;
      up)
        echo "[shim] docker compose up $*"
        exit 0
        ;;
      ps)
        echo "fakecontainerid1234567890"
        exit 0
        ;;
      logs)
        echo "[shim] docker compose logs $*"
        exit 0
        ;;
      *)
        echo "[shim] docker compose $*"
        exit 0
        ;;
    esac
    ;;
  inspect)
    echo "healthy"
    exit 0
    ;;
  image)
    echo "[shim] docker image $*"
    exit 0
    ;;
  *)
    echo "[shim] docker $*"
    exit 0
    ;;
esac
