# Docker 部署指南

本文档介绍如何使用 Docker 部署 XRK-AGT。XRK-AGT 完全支持跨平台部署，包括 Windows、Linux 和 macOS。

> **跨平台支持**：所有路径处理均使用 Node.js 的 `path` 模块，确保跨平台兼容性。Docker 镜像基于 `node:24.12-alpine`，支持所有主流平台。

## 快速开始

### 使用 Docker Compose（推荐）

1. **克隆项目**
   ```bash
   git clone https://github.com/sunflowermm/XRK-AGT.git
   cd XRK-AGT
   ```

2. **配置端口（可选）**
   
   创建 `.env` 文件（或修改 `docker-compose.yml`）：
   ```bash
   # .env
   XRK_SERVER_PORT=8080
   ```

3. **启动服务**
   ```bash
   docker-compose up -d
   ```

4. **查看日志**
   ```bash
   docker-compose logs -f xrk-agt
   ```

5. **停止服务**
   ```bash
   docker-compose down
   ```

## 端口配置

XRK-AGT 支持通过多种方式指定运行端口：

### 方式1：环境变量（推荐）

在 `docker-compose.yml` 或 `.env` 文件中设置：
```yaml
environment:
  - XRK_SERVER_PORT=8080
```

或在启动时指定：
```bash
XRK_SERVER_PORT=3000 docker-compose up -d
```

### 方式2：修改 docker-compose.yml

直接修改 `docker-compose.yml` 中的端口映射和环境变量：
```yaml
ports:
  - "8080:8080"  # 修改端口映射
environment:
  - XRK_SERVER_PORT=8080  # 同时修改环境变量
```

**重要提示**：修改端口时，必须同时修改 `ports` 和 `environment` 中的 `XRK_SERVER_PORT`，两者必须一致。

### 方式3：命令行参数

使用 `docker run` 时：
```bash
docker run -e XRK_SERVER_PORT=8080 -p 8080:8080 xrk-agt
```

## 使用 Dockerfile 构建

### 构建镜像

```bash
docker build -t xrk-agt:latest .
```

### 运行容器

```bash
# 使用默认端口 8080
docker run -d \
  --name xrk-agt \
  -p 8080:8080 \
  -e XRK_SERVER_PORT=8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/resources:/app/resources \
  xrk-agt:latest

# 使用自定义端口
docker run -d \
  --name xrk-agt \
  -p 3000:3000 \
  -e XRK_SERVER_PORT=3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/resources:/app/resources \
  xrk-agt:latest
```

## 数据持久化

以下目录建议通过 volume 挂载以持久化数据：

- `./data:/app/data` - 运行时数据（Bot配置、上传文件等）
- `./logs:/app/logs` - 日志文件
- `./config:/app/config` - 配置文件
- `./resources:/app/resources` - 资源文件

## 健康检查

容器包含健康检查功能，默认检查 `/health` 端点：

```bash
# 查看健康状态
docker ps
# 查看详细健康状态
docker inspect --format='{{.State.Health.Status}}' xrk-agt

# 手动检查（使用容器内端口，默认8080）
docker exec xrk-agt wget --spider http://localhost:8080/health

# 如果使用了自定义端口，需要指定正确的端口
docker exec xrk-agt sh -c "wget --spider http://localhost:\${XRK_SERVER_PORT:-8080}/health"
```

**注意**：健康检查使用容器内端口，与外部映射端口无关。如果修改了 `XRK_SERVER_PORT` 环境变量，健康检查会自动使用新端口。

## 多端口运行

XRK-AGT 支持在同一主机上运行多个实例，每个实例使用不同端口：

### 方式1：使用 docker-compose 覆盖文件（推荐）

创建 `docker-compose.override.yml`（用于第一个实例）：
```yaml
version: '3.8'
services:
  xrk-agt:
    container_name: xrk-agt-1
    environment:
      - XRK_SERVER_PORT=8080
    ports:
      - "8080:8080"
```

创建 `docker-compose.port2.yml`（用于第二个实例）：
```yaml
version: '3.8'
services:
  xrk-agt:
    container_name: xrk-agt-2
    environment:
      - XRK_SERVER_PORT=8081
    ports:
      - "8081:8081"
    volumes:
      - ./data2:/app/data
      - ./logs2:/app/logs
```

启动多个实例：
```bash
# 启动第一个实例（使用默认配置）
docker-compose up -d

# 启动第二个实例（使用覆盖文件）
docker-compose -f docker-compose.yml -f docker-compose.port2.yml up -d
```

### 方式2：使用 docker run

```bash
# 实例1
docker run -d --name xrk-agt-1 -p 8080:8080 -e XRK_SERVER_PORT=8080 xrk-agt

# 实例2
docker run -d --name xrk-agt-2 -p 8081:8081 -e XRK_SERVER_PORT=8081 xrk-agt
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `NODE_OPTIONS` | Node.js 选项 | `--no-warnings --no-deprecation` |
| `XRK_SERVER_PORT` | 服务器端口 | `8080` |

## 故障排查

### 查看容器日志

```bash
# 查看实时日志
docker-compose logs -f xrk-agt

# 查看最近100行日志
docker-compose logs --tail=100 xrk-agt

# 查看特定时间段的日志
docker-compose logs --since 30m xrk-agt
```

### 进入容器调试

```bash
# 进入容器
docker exec -it xrk-agt sh

# 检查环境变量
docker exec xrk-agt env | grep XRK_SERVER_PORT

# 检查进程
docker exec xrk-agt ps aux
```

### 检查端口占用

```bash
# 检查容器端口映射
docker port xrk-agt

# 检查主机端口占用（Linux）
netstat -tuln | grep <端口>
# 或使用 ss 命令
ss -tuln | grep <端口>

# 检查主机端口占用（Windows）
netstat -ano | findstr :<端口>
```

### 重启容器

```bash
# 重启服务
docker-compose restart xrk-agt

# 停止并重新启动
docker-compose down
docker-compose up -d
```

### 常见问题

#### 1. 端口已被占用

**错误信息**：`Error: bind EADDRINUSE: address already in use`

**解决方法**：
- 检查端口占用：`netstat -tuln | grep <端口>`
- 修改 `docker-compose.yml` 中的端口映射
- 或停止占用端口的其他服务

#### 2. 健康检查失败

**可能原因**：
- 应用启动时间较长，需要增加 `start_period`
- 端口配置不正确
- 应用内部错误

**解决方法**：
```bash
# 检查应用是否正常运行（替换为实际端口）
docker exec xrk-agt sh -c "wget --spider http://localhost:\${XRK_SERVER_PORT:-8080}/health"

# 查看应用日志
docker-compose logs xrk-agt | tail -50
```

#### 3. 数据丢失

**原因**：未正确挂载 volume

**解决方法**：确保 `docker-compose.yml` 中正确配置了 volumes：
```yaml
volumes:
  - ./data:/app/data
  - ./logs:/app/logs
  - ./config:/app/config
```

## 生产环境建议

### 1. 使用反向代理

建议使用 Nginx 或 Traefik 作为反向代理，提供 HTTPS 和负载均衡：

**Nginx 示例配置**：
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8080;  # 替换为实际端口
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. 资源限制

在 `docker-compose.yml` 中已配置资源限制，可根据实际需求调整：
```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 2048M
    reservations:
      cpus: '0.5'
      memory: 512M
```

### 3. 定期备份

建议定期备份以下目录：
```bash
# 备份脚本示例
#!/bin/bash
BACKUP_DIR="/backup/xrk-agt"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/data_$DATE.tar.gz" ./data
tar -czf "$BACKUP_DIR/config_$DATE.tar.gz" ./config
```

### 4. 监控健康状态

- 使用 Docker 内置健康检查
- 配置外部监控工具（如 Prometheus + Grafana）
- 设置告警规则

### 5. 日志管理

配置日志轮转，避免日志文件过大：
```yaml
# 在 docker-compose.yml 中添加日志驱动
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### 6. 安全建议

- 使用非 root 用户运行容器（在 Dockerfile 中添加）
- 定期更新基础镜像
- 限制容器网络访问
- 使用 secrets 管理敏感信息

## 相关文档

- [README.md](../README.md) - 项目主文档
- [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md) - 项目概览
- [server.md](server.md) - 服务器架构文档
