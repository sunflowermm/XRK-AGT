# Node.js 26 运行时约定

> **版本要求**：`package.json` → `engines.node` **≥ 26.0.0**（Current；预计 2026-10 转 LTS）。  
> **实测基线**：v26.2.0（Windows / Git Bash）。  
> 架构索引：[底层架构设计.md](底层架构设计.md) · 概览：[PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md)

---

## 1. 本项目已采用的 API

| 能力 | 用法 | 代码位置 |
|------|------|----------|
| `Error.isError()` | 可靠判错 | `src/bot.js`、`src/infrastructure/log.js`、LLM/HTTP 等 |
| `normalizeError()` | 非 Error 转标准 Error | `#utils/normalize-error.js` → redis/mongodb/log/loader |
| `Map.getOrInsert*` | 统计/缓存初始化 | `error-handler.js`、`botutil.getMap()` |
| 全局 `URLPattern` | 重定向路径匹配 | `http-business.js`（无 fallback） |
| 原生 `fetch` + `ProxyAgent` | LLM/下载/健康检查 | 全局 fetch；代理 `#utils/llm/proxy-utils.js` |
| `AbortSignal.timeout` | HTTP 超时 | `bot.js`、`http-business.js`、`start.js` |
| `Uint8Array.fromBase64/toBase64/toHex` | 二进制编解码（Node 25+ V8） | `botutil.js`、`image-utils.js`、Tasker 等 |
| `Readable.fromWeb` | fetch body 写盘 | `subserver-client.js` → `fetchSubserverToPath` |
| `#utils/exec-async.js` | Promise 版 `exec` | 全项目唯一 `promisify(exec)` 封装点 |

### 已删除的旧写法（勿再引入）

- `node-fetch`、`https-proxy-agent`
- 分散的 `util.promisify(exec)`（除 `exec-async.js`）
- `import ... from 'node:child_process/promises'`（**26.2 尚未内置**）
- `AbortController` + `setTimeout(abort)` 拼超时
- `instanceof Error` 作基础设施判错
- `URLPattern` / `Error.isError` 特性检测与 polyfill 回退

---

## 2. 编译与启动性能（Node 25/26 引擎层）

以下特性**不要求改业务代码**，但会影响本项目的启动与 JSON 密集路径。

### 2.1 V8 14.x（Node 26 捆绑 14.6）

- **`JSON.stringify` / 大对象序列化更快**：HTTP API、LLM 响应、配置读写、插件热载时的 JSON 解析/序列化受益。
- **`Map.getOrInsert` / `Iterator.concat`**：已在错误统计、全局 Map 缓存等处使用，减少 `get` + 条件 `set` 样板代码。
- **`Uint8Array` 内置 base64/hex**：图片/设备/消息链路已替换 `Buffer.toString('base64'|'hex')`。

**对本项目**：升级 Node 26 后 API 延迟与 CPU 占用可能略降，无需额外配置。

### 2.2 可移植编译缓存（Portable Compile Cache，Node 25+）

Node 25 起支持将 **已编译的 ESM/CJS 字节码** 写入磁盘，下次冷启动复用，缩短「首次 `import` 大量模块」的时间。

| 环境变量 / 参数 | 作用 |
|-----------------|------|
| `NODE_COMPILE_CACHE=<dir>` | 指定编译缓存目录 |
| `node --experimental-compiler-cache` | 启用实验性编译器缓存（部分版本） |

**对本项目的影响**：

- **开发**：热重载仍主要受 chokidar + 动态 `import` 影响；编译缓存对**反复重启同一进程**帮助有限。
- **生产 / Docker**：多实例或 PM2 频繁拉起时，可在 `docker-entrypoint.sh` 或 systemd 中设置 `NODE_COMPILE_CACHE=/app/.node-cache`（需可写目录），**可能**缩短 7s 级冷启动中的 1～2s 模块编译段（视机器与依赖量而定）。
- **当前仓库**：**未默认开启**；若启用需在部署文档中注明缓存目录权限与镜像层策略。

### 2.3 Undici 8（Node 26 内置 fetch）

- 原生 `fetch`、LLM 流式 SSE、健康检查、公网 IP 探测均走 Undici。
- 与旧 `node-fetch` 相比：连接池、HTTP/2、代理（`dispatcher: new ProxyAgent(url)`）行为更一致。

**对本项目**：已移除 `node-fetch` 依赖；LLM 代理配置不变，底层实现改为 Undici。

### 2.4 其它 Node 26 默认启用、本项目暂未深度使用的特性

| 特性 | 说明 | 本项目 |
|------|------|--------|
| **Temporal** | 现代日期/时间 API | 仍用 `moment`；新代码可选 Temporal，无强制迁移 |
| **Web Storage** | 浏览器式 `localStorage` | 未使用；全栈同构代码才需关注 |
| **`node:ffi`（实验）** | 调 native 库 | 未使用；IoT/硬件 SDK 未来可考虑 |
| **`--allow-net` 权限模型** | 限制出站网络 | 未启用；容器化安全加固时可评估 |

---

## 3. 已知版本差异（26.2）

| 项 | 状态 |
|----|------|
| `node:child_process/promises` | **26.2 不存在** → 使用 `#utils/exec-async.js` |
| `Error.isError` | 26.0+ 可用 |
| `Uint8Array.toBase64()` | 25+ 可用 |

上游合入 `child_process/promises` 后，**只需改 `exec-async.js` 一处**即可切换实现。

### 3.1 预期可忽略的 rejection

Tasker 初始化时若外网 DNS 不可达（如 `bots.qq.com` → `ENOTFOUND`），进程会记录 **warn** 并继续运行，不会因此重启。排查方向：网络/代理/通道配置，与 Node 版本无关。

---

## 4. 本地验证

```bash
node -v                    # 应 >= v26.0.0
node --check src/bot.js
node -e "import('#utils/exec-async.js').then(m=>console.log('exec',typeof m.exec))"
node -e "console.log('Error.isError', typeof Error.isError)"
```

可选（编译缓存试验）：

```bash
export NODE_COMPILE_CACHE="$PWD/.node-compile-cache"
node app.js
# 第二次启动对比「Loader 并行加载」段耗时
```

---

*最后更新：2026-05-30*
