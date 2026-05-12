#!/bin/bash

PORT=4000

PID=$(lsof -ti tcp:$PORT)

if [ -n "$PID" ]; then
  echo "端口 $PORT 被进程 $PID 占用，正在终止..."
  kill -9 $PID
  sleep 1
  echo "已终止。"
fi

echo "启动服务器..."
node src/server.js
