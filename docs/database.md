# Redis 与 MongoDB

> **代码位置**：`src/infrastructure/database/index.js`、`src/infrastructure/redis.js`、`src/infrastructure/mongodb.js`  
> **连接工具**：`src/utils/db-connect-utils.js`  
> **说明**：XRK-AGT 启动时并行初始化 Redis 与 MongoDB；二者在多数部署中为**必需**，也可通过环境变量在无库模式下继续启动。

---

## 在文档体系中的位置

| 主题 | 文档 |
|------|------|
| 配置字段与路径 | 本文 + [config-base.md](config-base.md) · [app-dev.md §配置分类](app-dev.md#配置分类) |
| Docker 编排与持久化目录 | [docker.md](docker.md) |
| 分层与模块索引 | [底层架构设计.md](底层架构设计.md) |
| 插件内访问 | [plugin-base.md §系统集成](plugin-base.md#系统集成) |

---

## 各自用途（概览）

| 存储 | 典型用途 |
|------|----------|
| **Redis** | 进程/机器人状态（`AGT:restart:`、`AGT:shutdown:`）、插件计数与会话键、HTTP 控制面、重启插件上下文 |
| **MongoDB** | 需持久化文档的业务数据（工作流 memory、部分 system-Core 能力）；系统监控健康检查会 ping |

具体键名与集合以各 Core 消费代码为准；插件优先 **裸名 `redis`** 或 `getRedis()`；Db 实例用 **`mongodbDb`**（裸名）或 `#infrastructure/database/index.js` 的 `getMongoDb()`。

---

## 启动与生命周期

```mermaid
sequenceDiagram
    participant PL as Packageloader
    participant IM as InitManager
    participant DM as DatabaseManager
    participant R as redis.js
    participant M as mongodb.js

    PL->>IM: init()
    IM->>DM: initDatabases()
    par 并行
        DM->>R: redisInit()
        DM->>M: mongodbInit()
    end
    R-->>DM: setRuntimeGlobal('redis')
    M-->>DM: setRuntimeGlobal('mongodb' / 'mongodbDb')
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
| MongoDB | `config/default_config/mongodb.yaml` | `data/server_bots/mongodb.yaml` |

首次运行由 ConfigBase 从 `default_config` 复制到 `data/server_bots/`。Web 控制台 / CommonConfig 亦可编辑（schema 在 `core/system-Core/commonconfig/system.js`）。

### 主要字段

**Redis**（`redis.yaml`）：`host`、`port`、`db`（0–15）、`username`、`password`、`options.connectTimeout`。

**MongoDB**（`mongodb.yaml`）：`host`、`port`、`database`（默认 `xrk_agt`）、`username`、`password`、`options.maxPoolSize` / `minPoolSize` / 超时。

### 读取方式

```javascript
import cfg from '#infrastructure/config/config.js';

const { host, port } = cfg.redis;
const dbName = cfg.mongodb?.database;
```

业务代码在连接建立后使用客户端，而非重复拼 URL（连接串由 `redis.js` / `mongodb.js` 内 `buildRedisUrl` / `buildMongoUrl` 生成；Docker 下 `normalizeHost` 会将 `127.0.0.1` 映射为服务名 `redis` / `mongodb`）。

---

## 环境变量

| 变量 | 作用 |
|------|------|
| `XRK_OPTIONAL_DB=1` | Redis/Mongo 连接失败时**不** `process.exit(1)`；若两者均失败则 warn 后继续（适合纯本地调试、无持久化需求） |
| `XRK_FAST_START=1` | 减少连接重试次数、缩短超时（测试/快速冒烟） |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | Docker Compose 注入 Mongo 认证（见 [docker.md](docker.md)） |

默认（未设 `XRK_OPTIONAL_DB`）：任一库在 `DatabaseManager.init()` 中连接失败会记 **error**；**两者均不可用**时抛出 `MongoDB 与 Redis 均不可用` 并阻止正常启动。

---

## 在业务代码中使用

### 推荐访问方式

```javascript
// 插件 / 事件 / Tasker（连接已由框架建立）
if (redis?.isOpen) {
  await redis.set('my:key', 'value');
}

const db = mongodbDb;
if (db) {
  await db.collection('items').findOne({ id: 1 });
}
```

```javascript
// HTTP API（推荐 import，便于判空）
import { getRedis, getMongoDb } from '#infrastructure/database/index.js';
```

### 健康检查

```javascript
import getDatabaseManager from '#infrastructure/database/index.js';

const { mongodb, redis } = await getDatabaseManager().getHealthStatus();
```

system-Core HTTP（如 `core/system-Core/http/core.js`）与 `src/modules/systemmonitor.js` 会引用上述能力做状态展示。

---

## 本地与 Docker

| 场景 | Redis host | MongoDB host | 数据目录 |
|------|------------|--------------|----------|
| 本机开发 | `127.0.0.1:6379` | `127.0.0.1:27017` | Mongo 默认尝试 `data/mongodb/`（见 `mongodb.js` 启动提示） |
| docker-compose | 服务名 `redis` | 服务名 `mongodb` | 卷映射 `data/redis/`、`data/mongodb/` |

连接失败时，非生产环境日志会提示手动启动命令（如 `redis-server`、`mongod --dbpath ...`）。完整编排见 [docker.md](docker.md)。

---

## 连接实现要点

- **重试**：`connectWithRetry`（`db-connect-utils.js`），默认最多 3 次；失败走 `finalizeDbConnectionFailure`。
- **日志脱敏**：`maskConnectionUrl` 隐藏 URL 中的密码。
- **健康检查**：客户端就绪后定时 ping（间隔见各模块 `HEALTH_CHECK_INTERVAL`）。
- **ARM64**：Mongo 本地自动启动路径会检测架构（非 Windows）。

扩展连接行为应改 `redis.js` / `mongodb.js` 或 `db-connect-utils.js`（基础设施层），**不要在 Core 重复实现连接池**。

---

## 常见问题

### Q: 可以不装 Redis/Mongo 吗？

可以设 `XRK_OPTIONAL_DB=1` 启动，但依赖 Redis 的插件（重启/关机标记、部分计数）与 Mongo 持久化能力将不可用或报错，仅适合最小化调试。

### Q: 配置改了要不要重启？

全局 `redis.yaml` / `mongodb.yaml` 变更后需**重启进程**（连接在启动期建立；热重载不负责重连数据库）。

### Q: 和 `cfg.db` 的关系？

CommonConfig 列表中含历史字段 `db`；当前连接以 **`redis` + `mongodb` 两份 YAML** 为准，无单独 `db.yaml` 模板。

---

## 相关文档

- [app-dev.md](app-dev.md) — `cfg.redis` / `cfg.mongodb` 与全局配置表
- [docker.md](docker.md) — 容器、卷、环境变量
- [config-base.md](config-base.md) — ConfigBase 读写与复制默认模板
- [底层架构设计.md](底层架构设计.md) — 基础设施分层

---

*最后更新：2026-06-14*
