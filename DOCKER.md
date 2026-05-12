# Docker 使用指南

## 前置准备

### macOS

推荐 **colima**（轻量无 GUI）：

```bash
brew install colima docker
colima start
```

或者用 **OrbStack**（有 GUI，更快）：

```bash
brew install orbstack
```

### 配置镜像加速（国内必做）

```bash
# colima 需要进入虚拟机配置
colima ssh
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF
sudo pkill -HUP dockerd
exit
```

如果是 Docker Desktop，编辑 `~/.docker/daemon.json` 加上面内容，然后重启。

---

## 方式一：docker-compose（推荐）

```bash
# 构建并启动
docker compose up -d
DOCKER_BUILDKIT=0 docker-compose up -d

# 查看日志
docker compose logs -f

# 重启
docker compose restart

# 停止
docker compose down
```

## 方式二：docker 命令

```bash
# 构建
docker build -t stock-app .

# 运行
docker run -d \
  --name stock \
  -p 4000:4000 \
  --add-host host.docker.internal:host-gateway \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=yangyang \
  -e DB_USER=postgres \
  stock-app

# 查看日志
docker logs -f stock

# 停止并删除
docker stop stock && docker rm stock
```

## 常用命令

```bash
# 查看运行中的容器
docker ps

# 进入容器
docker exec -it stock sh

# 查看镜像
docker images

# 删除镜像
docker rmi stock-app

# 清理无用资源
docker system prune -a
```

## 配置说明

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `DB_HOST` | 数据库地址 | `host.docker.internal` |
| `DB_PORT` | 数据库端口 | `5432` |
| `DB_NAME` | 数据库名 | `yangyang` |
| `DB_USER` | 数据库用户 | `postgres` |
| `DB_PASSWORD` | 数据库密码 | 空 |

容器内通过 `host.docker.internal` 访问宿主机上的 PostgreSQL，确保本地 pgSQL 已启动并允许本地连接。
