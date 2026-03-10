#!/bin/bash

# 滚动升级脚本 - 零停机更新
# 用法: ./upgrade.sh

set -e

COMPOSE_FILE="docker-compose.scale.yml"
SLEEP_INTERVAL=3

echo "========================================="
echo "  Kiro API 滚动升级脚本"
echo "========================================="
echo ""

# 获取脚本所在目录
cd "$(dirname "$0")"

echo "[1/4] 拉取最新代码..."
git pull origin main
echo ""

echo "[2/4] 构建新镜像..."
docker compose -f $COMPOSE_FILE build
echo ""

echo "[3/4] 滚动重启 API 服务..."
for i in 1 2 3 4 5; do
    echo "  - 重启 api-$i ..."
    docker compose -f $COMPOSE_FILE up -d --no-deps api-$i
    sleep $SLEEP_INTERVAL
done
echo ""

echo "[4/4] 重启负载均衡器..."
docker compose -f $COMPOSE_FILE up -d --no-deps balancer
echo ""

echo "========================================="
echo "  升级完成！"
echo "========================================="
echo ""

echo "服务状态:"
docker compose -f $COMPOSE_FILE ps
echo ""

echo "测试接口:"
curl -s http://localhost:13003/api/bedrock/models | head -c 100
echo "..."
