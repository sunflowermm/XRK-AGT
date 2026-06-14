# Node.js 26 运行时约定

> **版本要求**：`package.json` → `engines.node` **≥ 26.0.0**（Current；预计 2026-10 转 LTS）。  
> **包管理**：仅 **pnpm**。  
> **写法与性能**：[coding-style.md](coding-style.md) · 挂载：[runtime-surface.md](runtime-surface.md)  
> 架构索引：[底层架构设计.md](底层架构设计.md) · 编码禁止项：`.cursor/rules/xrk-dev-requirements.mdc` · skill **`xrk-node-runtime`**

---

## 1. 项目已采用的 API

| 能力 | 用法 | 代码位置 |
|------|------|----------|
| `Error.isError()` | 基础设施判错 | `src/bot.js`、`log.js`、LLM/HTTP 等 |
| `normalizeError()` | 非 Error 转标准 Error | `#utils/normalize-error.js` |
| `Map.getOrInsert*` | 统计/缓存初始化 | `error-handler.js`、`botutil.getMap()` |
| 全局 `URLPattern` | 重定向路径匹配 | `http-business.js` |
| 原生 `fetch` + `ProxyAgent` | LLM/下载/健康检查 | 全局 fetch；`#utils/llm/proxy-utils.js` |
| `AbortSignal.timeout` | HTTP 超时 | `bot.js`、`http-business.js`、`start.js` |
| `Uint8Array.fromBase64/toBase64/toHex` | 二进制编解码 | `botutil.js`、`image-utils.js`、Tasker 等 |
| `Readable.fromWeb` | fetch body 写盘 | `subserver-client.js` |
| `#utils/exec-async.js` | Promise 版 `exec` | 全项目唯一 `promisify(exec)` 封装点 |
| `#utils/win-utf8.js` | Windows 控制台 UTF-8 | `start.js` 菜单、`log.js` 初始化前 |
| `#utils/process-signals.js` | Ctrl+C 三击、`registerShutdownHook` | `config/loader.js`、`start.js`、渲染器清理 |

**禁止在 Core / 基础设施中引入的旧模式**（完整清单与对照表见 skill **`xrk-node-runtime`**，此处不重复罗列）。

---

## 2. 启动与性能（可选调优）

### 2.1 V8 / Undici

Node 26 捆绑 V8 14.6 与 Undici 8：JSON 密集路径、原生 `fetch`、LLM 流式 SSE 均直接受益，**无需业务侧开关**。

### 2.2 可移植编译缓存（可选）

| 环境变量 | 作用 |
|----------|------|
| `NODE_COMPILE_CACHE=<dir>` | 磁盘缓存已编译 ESM/CJS，缩短冷启动 |

- **开发**：热重载以 chokidar 为主，缓存收益有限。  
- **生产 / Docker**：可在 entrypoint 设置可写缓存目录；**仓库未默认开启**。

### 2.3 未深度使用的 Node 26 内置能力

Temporal、Web Storage、`node:ffi`（实验）等——本项目当前未依赖，新代码按需选用即可。

---

## 3. 运行时说明（26.2）

| 项 | 说明 |
|----|------|
| `node:child_process/promises` | 26.2 **不存在** → 统一 `#utils/exec-async.js` |
| Tasker 外网 DNS 失败 | `ENOTFOUND` 等记 **warn**，不触发进程重启 |

---

## 4. 本地验证

```bash
node -v                    # 应 >= v26.0.0
node --check src/bot.js
node -e "import('#utils/exec-async.js').then(m=>console.log('exec',typeof m.exec))"
node -e "console.log('Error.isError', typeof Error.isError)"
```

---

*最后更新：2026-06-14*
