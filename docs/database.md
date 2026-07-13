# Redis（框架内置数据库）

> **代码位置**：`src/infrastructure/database/index.js`、`src/infrastructure/redis.js`  
> **连接工具**：`src/utils/db-connect-utils.js`  
> **说明**：XRK-AGT 启动时初始化 **Redis** 作为框架内置数据库；MongoDB 等其它存储由**业务 Core** 自行引入（如本地 `mongodb-Core`），非 Runtime 依赖。

---

## 在文档体系中的位置

| 主题 | 文档 |
|------|------|
| 配置字段与路径 | 本文 + [config-base.md](config-base.md) · [app-dev.md §配置分类](app-dev.md#配置分类) |
| Docker 编排与持久化目录 | [docker.md](docker.md) |
| 分层与模块索引 | [底层架构设计.md](底层架构设计.md) |
| 插件内访问 | [plugin-base.md §系统集成](plugin-base.md#系统集成) |

---

## 用途（概览）

| 存储 | 归属 | 典型用途 |
|------|------|----------|
| **Redis** | **Runtime 内置** | 进程/机器人状态（`AGT:restart:`、`AGT:shutdown:`）、插件计数与会话键、HTTP 控制面、重启插件上下文 |
| **MongoDB 等** | **业务 Core** | 企业/产品自行部署的持久化层（如本地 `core/mongodb-Core/`），主仓不初始化、不强制 |

插件与 HTTP 优先使用 **裸名 `redis`** 或 `getRedis()`。

---

## 启动与生命周期

```mermaid
sequenceDiagram
    participant PL as Packageloader
    participant IM as InitManager
    participant DM as DatabaseManager
    participant R as redis.js

    PL->>IM: init()
    IM->>DM: initDatabases()
    DM->>R: redisInit()
    R-->>DM: setRuntimeGlobal('redis')
    Note over IM: 失败时见 XRK_OPTIONAL_DB
    IM->>IM: cfg.enableWatching() …
    Note over PL: 关闭时 ProcessManager.cleanup
    PL->>DM: closeDatabases()
```

- **触发点**：`src/infrastructure/config/loader.js` → `InitManager.init()` 在 `setLog()`、`cfg.warmupConfigs()` 之后调用 `initDatabases()`。
- **关闭**：`ProcessManager.cleanup()` → `closeDatabases()`（与 Ctrl+C 三击、`registerShutdownHook` 协同，见 [bot.md](bot.md)）。

---

## 配置

### 模板与运行时路径

| 配置 | 默认模板 | 运行时（全局，不按端口） |
|------|----------|--------------------------|
| Redis | `config/default_config/redis.yaml` | `data/server_bots/redis.yaml` |

首次运行由 ConfigBase 从 `default_config` 复制到 `data/server_bots/`。Web 控制台 / CommonConfig 亦可编辑（schema 在 `core/system-Core/commonconfig/system.js`）。

### 主要字段

**Redis**（`redis.yaml`）：`host`、`port`、`db`（0–15）、`username`、`password`、`options.connectTimeout`。

### 读取方式

```javascript
import cfg from '#infrastructure/config/config.js';

const { host, port } = cfg.redis;
```

业务代码在连接建立后使用客户端，而非重复拼 URL（连接串由 `redis.js` 内 `buildRedisUrl` 生成；Docker 下 `normalizeHost` 会将 `127.0.0.1` 映射为服务名 `redis`）。

---

## 环境变量

| 变量 | 作用 |
|------|------|
| `XRK_OPTIONAL_DB=1` | Redis 连接失败时**不**阻止启动（适合纯本地调试、无持久化需求） |
| `XRK_FAST_START=1` | 减少连接重试次数、缩短超时（测试/快速冒烟） |

默认（未设 `XRK_OPTIONAL_DB`）：Redis 在 `DatabaseManager.init()` 中连接失败会记 **error** 并抛出 `Redis 不可用`，阻止正常启动。

---

## 在业务代码中使用

### 推荐访问方式

```javascript
// 插件 / 事件 / Tasker（连接已由框架建立）
if (redis?.isOpen) {
  await redis.set('my:key', 'value');
}
```

```javascript
// HTTP API（推荐 import，便于判空）
import { getRedis } from '#infrastructure/database/index.js';
```

### 健康检查

```javascript
import getDatabaseManager from '#infrastructure/database/index.js';

const { redis } = await getDatabaseManager().getHealthStatus();
```

system-Core HTTP（如 `core/system-Core/http/core.js`）与 `src/modules/systemmonitor.js` 会引用上述能力做状态展示。

---

## 本地与 Docker

| 场景 | Redis host | 数据目录 |
|------|------------|----------|
| 本机开发 | `127.0.0.1:6379` | 按本机 redis 安装 |
| docker-compose | 服务名 `redis` | 卷映射 `data/redis/` |

连接失败时，非生产环境日志会提示手动启动命令（如 `redis-server`）。完整编排见 [docker.md](docker.md)。

---

## 连接实现要点

- **重试**：`connectWithRetry`（`db-connect-utils.js`），默认最多 3 次；失败走 `finalizeDbConnectionFailure`。
- **日志脱敏**：`maskConnectionUrl` 隐藏 URL 中的密码。
- **健康检查**：客户端就绪后定时 ping（间隔见 `redis.js` 内 `HEALTH_CHECK_INTERVAL`）。

扩展连接行为应改 `redis.js` 或 `db-connect-utils.js`（基础设施层），**不要在 Core 重复实现连接池**。

---

## MongoDB 与其它数据库

主仓 **不** 提供 `mongodbDb` / `getMongoDb()`。需要 MongoDB 的企业或产品：

1. 在 `core/` 下部署独立业务 Core（如 `mongodb-Core`），自行声明 `mongodb` 依赖与连接配置；
2. 或在 Docker 中额外编排 Mongo 服务，由该 Core 消费。

与框架 Redis **互不干扰**，Loader 不会自动初始化业务库。

---

## 常见问题

### Q: 可以不装 Redis 吗？

可以设 `XRK_OPTIONAL_DB=1` 启动，但依赖 Redis 的插件（重启/关机标记、部分计数）将不可用或报错，仅适合最小化调试。

### Q: 配置改了要不要重启？

全局 `redis.yaml` 变更后需**重启进程**（连接在启动期建立；热重载不负责重连数据库）。

### Q: 和 `cfg.db` 的关系？

CommonConfig 列表中含历史字段 `db`；当前框架内置连接以 **`redis.yaml`** 为准，无单独 `db.yaml` 模板。

---

## 相关文档

- [app-dev.md](app-dev.md) — `cfg.redis` 与全局配置表
- [docker.md](docker.md) — 容器、卷、环境变量
- [config-base.md](config-base.md) — ConfigBase 读写与复制默认模板
- [底层架构设计.md](底层架构设计.md) — 基础设施分层

---

*最后更新：2026-07-13*
