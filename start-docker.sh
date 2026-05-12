#!/bin/bash

PORT=4000
CONTAINER=stock
IMAGE=stock-app
DIR="$(cd "$(dirname "$0")" && pwd)"

# 杀掉端口占用
PID=$(lsof -ti tcp:$PORT)
if [ -n "$PID" ]; then
  echo "端口 $PORT 被进程 $PID 占用，正在终止..."
  kill -9 $PID
  sleep 1
fi

# 停止并删除旧容器
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "停止并删除旧容器..."
  docker stop $CONTAINER 2>/dev/null
  docker rm $CONTAINER 2>/dev/null
fi

# 构建镜像（仅在镜像不存在或指定 --build 时）
if [ "$1" = "--build" ] || ! docker images --format '{{.Repository}}' | grep -q "^${IMAGE}$"; then
  echo "构建镜像..."
  DOCKER_BUILDKIT=0 docker build -t $IMAGE "$DIR"
else
  echo "使用已有镜像，跳过构建（加 --build 强制重建）"
fi

# 启动容器
echo "启动容器..."
docker run -d \
  --name $CONTAINER \
  -p $PORT:4000 \
  --add-host host.docker.internal:host-gateway \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=yangyang \
  -e DB_USER=postgres \
  $IMAGE

echo "启动完成，访问 http://localhost:$PORT"
