# Docker 部署指南

> **最后更新**: 2026-02-07  
> **跨平台支持**: Windows 10+ / Linux / macOS

本文档介绍如何使用 Docker 部署 XRK-AGT。

## 快速开始

### 使用 Docker Compose（推荐）

1. **克隆项目**
   ```bash
   git clone https://github.com/sunflowermm/XRK-AGT.git
   cd XRK-AGT
   ```

2. **自定义端口（可选，默认8080）**
   
   创建 `.env` 文件设置自定义端口：
   ```bash
   # .env
   XRK_SERVER_PORT=3000  # 自定义端口
   ```

3. **启动服务**
   ```bash
   docker-compose up -d
   ```
   
   这将启动以下服务：
   - `xrk-agt`: XRK-AGT 主服务（端口：`${XRK_SERVER_PORT:-8080}`）
   - `xrk-subserver`: Python 子服务端（端口：8000）
   - `redis`: Redis 缓存服务
   - `mongodb`: MongoDB 数据库服务

4. **查看日志**
   ```bash
   # 查看所有服务日志
   docker-compose logs -f
   
   # 查看主服务日志
   docker-compose logs -f xrk-agt
   
   # 查看子服务端日志
   docker-compose logs -f xrk-subserver
   ```

5. **停止服务**
   ```bash
   docker-compose down
   ```

## 自定义端口

通过环境变量 `XRK_SERVER_PORT` 自定义主服务端口（默认：8080）：

### 方式1：使用 .env 文件（推荐）

在项目根目录创建 `.env` 文件：
```bash
XRK_SERVER_PORT=3000
```

### 方式2：环境变量

```bash
# Linux/macOS
XRK_SERVER_PORT=3000 docker-compose up -d

# Windows PowerShell
$env:XRK_SERVER_PORT=3000; docker-compose up -d
```

## 服务说明

### XRK-AGT 主服务

- **端口**：`${XRK_SERVER_PORT:-8080}`（可通过环境变量自定义）
- **健康检查**：`/health`
- **功能**：HTTP/HTTPS/WebSocket 服务、AI 工作流、MCP 工具

### XRK-AGT 子服务端

- **端口**：8000（固定）
- **健康检查**：`/health`
- **功能**：LangChain 服务、向量服务、RAG 功能
- **模型下载**：自动从网络下载模型（本地找不到时）

### Redis 服务

- **镜像**：`redis:7-alpine`
- **端口**：6379（容器内部）
- **持久化**：AOF 已启用
- **数据卷**：`redis-data`

### MongoDB 服务

- **镜像**：`mongo:8.0`
- **端口**：27017（容器内部）
- **数据卷**：`mongodb-data`
- **认证**：可通过环境变量 `MONGO_ROOT_USERNAME` 和 `MONGO_ROOT_PASSWORD` 设置

## 数据持久化

以下目录通过 volume 挂载以持久化数据：

- `./data:/app/data` - 运行时数据
- `./logs:/app/logs` - 日志文件
- `./config:/app/config` - 配置文件
- `./resources:/app/resources` - 资源文件
- `./data/subserver/model_cache:/app/data/subserver/model_cache` - 模型缓存

## 自动配置

Docker 环境会自动配置：

- **Redis/MongoDB 连接**：自动将配置文件中的 `127.0.0.1` 替换为 Docker 服务名
- **主服务端连接**：子服务端自动连接到主服务端（通过环境变量）
- **模型下载**：子服务端自动从网络下载模型（本地找不到时）

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `XRK_SERVER_PORT` | 主服务端口 | `8080` |
| `MONGO_ROOT_USERNAME` | MongoDB 用户名 | 空 |
| `MONGO_ROOT_PASSWORD` | MongoDB 密码 | 空 |

## 故障排查

### 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f xrk-agt
docker-compose logs -f xrk-subserver
```

### 进入容器调试

```bash
# 进入主服务容器
docker exec -it xrk-agt sh

# 进入子服务端容器
docker exec -it xrk-subserver sh
```

### 常见问题

#### 端口已被占用

修改 `.env` 文件中的 `XRK_SERVER_PORT` 或停止占用端口的服务。

#### 健康检查失败

检查服务日志：
```bash
docker-compose logs xrk-agt
docker-compose logs xrk-subserver
```

#### Redis/MongoDB 连接失败

确保服务已启动：
```bash
docker-compose ps
```

#### 模型下载失败

子服务端会自动从网络下载模型。如果下载失败，检查网络连接或查看日志：
```bash
docker-compose logs xrk-subserver | grep -i model
```

## 生产环境建议

### 1. 使用反向代理

建议使用 Nginx 或 Traefik 作为反向代理，提供 HTTPS 和负载均衡。

### 2. 资源限制

`docker-compose.yml` 中已配置资源限制，可根据实际需求调整。

### 3. 定期备份

建议定期备份 `data` 和 `config` 目录。

### 4. 安全建议

- ✅ 使用非 root 用户运行容器（已配置）
- ✅ 为 Redis/MongoDB 设置密码
- ✅ 使用 secrets 管理敏感信息
- ✅ 定期更新基础镜像

---

*最后更新：2026-02-07*
