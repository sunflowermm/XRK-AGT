# 基础设施共享约定

> Loader / 热重载 / 全局引导的**单一说明**；**写法与性能**见 [coding-style.md](coding-style.md)。  
> 工具索引见 [runtime-surface.md](runtime-surface.md)；基类见 [base-classes.md](base-classes.md)。

各 Loader / 配置模块复用的工具与模式，**业务 Core 勿在此目录放码**。

![Loader 标准模式导读](../resources/mdimg/docs/loader-hot-reload.png)

## 工具模块（`src/utils/`）

| 模块 | 用途 |
|------|------|
| `runtime-globals.js` | `setRuntimeGlobal` / `getRuntimeGlobal`；`isShuttingDown` / `setShuttingDown`；`isProcessFlagSet` / `setProcessFlag` |
| `file-loader.js` | `importFresh`（热重载 cache-bust）、`forEachBatch` / `mapInBatches` |
| `loader-constants.js` | `LOADER_BATCH_SIZE`、`API_REGISTER_BATCH_SIZE` |
| `loader-shutdown.js` | 停机时 `stopAllLoaderWatchers()`（Plugins/Stream/Api/Config/runtimeConfig/Renderer） |
| `token-estimate.js` | `estimateTokensRough` / `estimateTokensMixed` |
| `sse-openai.js` | `writeSSEChunk`、`createOpenAIChunk` |
| `hot-reload-base.js` | chokidar 热重载唯一入口（`src/` 内除本文件外禁止直接 chokidar） |
| `core-fs.js` | `resolveCoreModuleKey` / `resolveQualifiedCoreModuleKey`（多 Core 防撞：`system-Core/admin`）；`scanFiles` |
| `string-array-utils.js` | 配置层字符串数组归一化 |

www 挂载（`src/infrastructure/http/`；权威文档 [www-mount.md](www-mount.md)）：

| 模块 | 用途 |
|------|------|
| `www-app-resolve.js` | 普通静态 vs 前端工程（sign）；URL / dist / proxy 决策 |
| `mount-core-www.js` | 挂载两类 www；proxy 跳过静态 |
| `frontend/launcher.js` | 仅拉起需反代的前端工程 |
引导、信号、路径等其余 `src/utils/` 模块见 [runtime-surface.md](runtime-surface.md)、[coding-style.md](coding-style.md)。

## 全局引导

- `src/bootstrap-globals.js`：在 `agent-runtime.js` 首行 import，`setRuntimeGlobal('PluginBase'|'msgSegment', …)`  
- 集成测试：`tests/helpers/bootstrap.mjs` 同样 import 一次，供 PluginLoader / HttpApiLoader 加载 `extends PluginBase` 模块  
- 业务：裸名 `msgSegment` / import 基类；见 [runtime-surface.md](runtime-surface.md)）

## Loader 标准模式

1. 类字段存放 watcher / 缓存 Map（禁止在 constructor 里 new 可变容器）
2. 扫描：`FileLoader.getCoreSubDirFiles(subDir)` 或 `paths.getCoreDirs()`（**全量** `core/*` 目录；勿用 loader 子目录反推，否则仅有 `www` 的 Core 会漏挂静态）
3. 加载：`FileLoader.importFresh(absPath)` + `forEachBatch(..., LOADER_BATCH_SIZE, ...)`
4. 热重载：`this._hotReload = new HotReloadBase({ loggerName })`，`watch(true, { dirs|files, onAdd, onChange, onUnlink })`；销毁时 `_hotReload?.stop()`
5. 模块 key 优先 `resolveQualifiedCoreModuleKey(file, dirs, subDir)`（如 `mongodb-Core/admin`），禁止仅 basename（多 Core 会互相覆盖）

**不支持热重载（改完需重启）**：`events/`（ListenerLoader）、`tasker/`（TaskerLoader）。AgentRuntime 启动日志会打 debug 提示。

## HotReloadBase 语义（`src/utils/hot-reload-base.js`）

各 Loader **禁止**直接使用 chokidar；统一经本类，避免重复实现与误触发。

### 何时会触发 handler

| 事件 | 行为 |
|------|------|
| `add` / `change` | 读文件 SHA256；与上次 hash **相同则跳过**（debug 日志「跳过热更新（内容未变）」） |
| `unlink` | **延迟 600ms** 再执行；若期间同路径 `add`/`change` 到来则取消（原子保存/重命名） |
| `ready` | 对当前已监视文件 **预填 hash**，避免启动后首次 phantom 事件误重载 |

其余：`lodash.debounce`（默认 500ms）、`awaitWriteFinish`（stability 300ms）、同路径 `_inFlight` 去重、`isShuttingDown()` 时不启动。

### Loader 侧约定

- **CommonConfigRegistry**：监视器回调用 **`reloadFile(绝对路径)`**，勿仅用 basename 调 `reload(name)`（多 Core 同名 schema 会歧义）。
- **PluginLoader**：`changePlugin(key, filePath)` 优先用监视器路径；`createTask()` 对 cron 指纹 `_taskScheduleKey` 去重，插件热更但 schedule 未变时不重建全部定时任务。
- **HttpApiLoader / AiWorkflowLoader**：`onChange` 应基于监视器报告的 `filePath` 重载（Api 实例已缓存 `filePath` 时等价）。
- **AgentRuntime.run watchSetup**：统一启动 Config / Stream / Plugins / **Api** 四监视器（Api 不再挂到 listener 阶段）。
- **runtimeConfig（`config.js`）**：单文件 `files` 模式 + `shouldHandle: () => true`；YAML 原子写入同样受 hash / unlink 延迟保护。
- **加载顺序**：`CommonConfigRegistry.load` → 挂载 `CommonConfigRegistry` → 再并行 Stream / Plugins / Api（避免插件 init 读不到配置）。

### 排查「未手改却热更」

1. 看日志是否含 **跳过热更新** — 有则说明 chokidar 触了但内容 dedup 已拦住（可开 debug）。
2. 若仍重载：查编辑器/同步盘/杀毒是否改写 mtime 或做 rename 保存；Windows 上偶发 `unlink`+`add` 已由延迟确认处理。
3. 13:00 等整点 `[定时任务]` 日志是 **cron 正常执行**，不是热重载。

## 文档入口

- 写法规范：[coding-style.md](coding-style.md)
- 运行时挂载：[runtime-surface.md](runtime-surface.md)
- HTTP API：[docs/http-api.md](http-api.md)
- 基类契约：[docs/base-classes.md](base-classes.md)
- 插件 / Tasker / 工作流：`.cursor/skills/xrk-*` 与 [docs/框架可扩展性指南.md](框架可扩展性指南.md)

---

*最后更新：2026-07-05*
