# Docker 部署指南

> **最后更新**: 2026-02-07  
> **跨平台支持**: Windows 10+ / Linux / macOS

本文档介绍如何使用 Docker 部署 XRK-AGT。

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/sunflowermm/XRK-AGT.git
cd XRK-AGT
```

### 2. 配置环境变量（可选）

创建 `.env` 文件：

```bash
# 主服务端口（默认 8080）
XRK_SERVER_PORT=8080

# 代理配置（用于模型下载，可选）
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890

# MongoDB 认证（可选）
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=password
```

### 3. 启动服务

```bash
docker-compose up -d
```

这将启动以下服务：
- `xrk-agt`: 主服务（端口：`${XRK_SERVER_PORT:-8080}`）
- `xrk-subserver`: Python 子服务端（端口：8000）
- `redis`: Redis 缓存服务
- `mongodb`: MongoDB 数据库服务

### 4. 查看日志

```bash
# 所有服务
docker-compose logs -f

# 特定服务
docker-compose logs -f xrk-agt
docker-compose logs -f xrk-subserver
```

### 5. 停止服务

```bash
docker-compose down
```

## 服务说明

### XRK-AGT 主服务

- **端口**：`${XRK_SERVER_PORT:-8080}`
- **健康检查**：`/health`
- **功能**：HTTP/HTTPS/WebSocket、AI 工作流、MCP 工具

### XRK-AGT 子服务端

- **端口**：8000
- **健康检查**：`/health`
- **功能**：LangChain、向量服务、RAG
- **模型下载**：支持从网络下载模型（需配置代理）

### Redis

- **镜像**：`redis:7-alpine`
- **端口**：6379（内部）
- **持久化**：AOF 已启用

### MongoDB

- **镜像**：`mongo:8.0`
- **端口**：27017（内部）
- **认证**：通过 `MONGO_ROOT_USERNAME` 和 `MONGO_ROOT_PASSWORD` 设置

## 代理配置

### 为什么需要代理？

Docker 容器内的应用无法直接使用宿主机的系统代理设置，需要手动传递代理环境变量。

### 配置代理（用于模型下载）

#### 方式 1：使用 .env 文件（推荐）

```bash
# .env
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

#### 方式 2：环境变量

```bash
# Linux/macOS
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
docker-compose up -d

# Windows PowerShell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
docker-compose up -d
```

#### 方式 3：Windows/Mac Docker Desktop

如果 Clash 监听 `127.0.0.1:7890`，容器内需要使用：

```bash
HTTP_PROXY=http://host.docker.internal:7890
HTTPS_PROXY=http://host.docker.internal:7890
```

### 代理说明

- **模型下载**：子服务端使用代理下载 HuggingFace 模型
- **主服务端连接**：不走代理（已自动排除）
- **本地服务**：Redis、MongoDB 不走代理（已自动排除）

## 数据持久化

以下目录通过 volume 挂载：

- `./data` - 运行时数据（包括模型缓存）
- `./logs` - 日志文件
- `./config` - 配置文件
- `./resources` - 资源文件

## 自动配置

Docker 环境自动配置：

- **Redis/MongoDB**：自动将配置中的 `127.0.0.1` 替换为 Docker 服务名
- **主服务端连接**：子服务端通过环境变量自动连接主服务端
- **代理隔离**：主服务端连接不走代理，仅模型下载使用代理

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `XRK_SERVER_PORT` | 主服务端口 | `8080` |
| `HTTP_PROXY` | HTTP 代理地址 | 空 |
| `HTTPS_PROXY` | HTTPS 代理地址 | 空 |
| `NO_PROXY` | 不走代理的地址 | `127.0.0.1,localhost,xrk-agt,redis,mongodb` |
| `HF_ENDPOINT` | HuggingFace 镜像地址 | 空 |
| `MONGO_ROOT_USERNAME` | MongoDB 用户名 | 空 |
| `MONGO_ROOT_PASSWORD` | MongoDB 密码 | 空 |

## 故障排查

### 查看服务状态

```bash
docker-compose ps
```

### 查看日志

```bash
# 所有服务
docker-compose logs -f

# 特定服务
docker-compose logs -f xrk-agt
docker-compose logs -f xrk-subserver
```

### 进入容器调试

```bash
docker exec -it xrk-agt sh
docker exec -it xrk-subserver sh
```

### 常见问题

#### 端口被占用

修改 `.env` 中的 `XRK_SERVER_PORT` 或停止占用端口的服务。

#### 健康检查失败

```bash
docker-compose logs xrk-agt
docker-compose logs xrk-subserver
```

#### 模型下载失败

1. 检查代理配置是否正确
2. 查看日志：`docker-compose logs xrk-subserver | grep -i model`
3. 验证代理：`docker exec xrk-subserver curl -I https://www.google.com`

#### 主服务端连接失败

确保主服务端已启动，检查端口配置是否正确。

## 生产环境建议

### 1. 反向代理

使用 Nginx 或 Traefik 提供 HTTPS 和负载均衡。

### 2. 资源限制

`docker-compose.yml` 中已配置资源限制，可根据需求调整。

### 3. 定期备份

定期备份 `data` 和 `config` 目录。

### 4. 安全建议

- ✅ 使用非 root 用户运行（已配置）
- ✅ 为 Redis/MongoDB 设置密码
- ✅ 使用 secrets 管理敏感信息
- ✅ 定期更新基础镜像

---

*最后更新：2026-02-07*
