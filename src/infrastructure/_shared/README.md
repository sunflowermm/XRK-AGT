# 基础设施共享约定

各 Loader / 配置模块复用的工具与模式，**业务 Core 勿在此目录放码**。

## 工具模块（`src/utils/`）

| 模块 | 用途 |
|------|------|
| `file-loader.js` | `importFresh`（热重载 cache-bust）、`forEachBatch` / `mapInBatches` |
| `loader-constants.js` | `LOADER_BATCH_SIZE`、`API_REGISTER_BATCH_SIZE` |
| `loader-shutdown.js` | 停机时 `stopAllLoaderWatchers()`（Plugins/Stream/Api/Config） |
| `token-estimate.js` | `estimateTokensRough` / `estimateTokensMixed` |
| `sse-openai.js` | `writeSSEChunk`、`createOpenAIChunk` |
| `hot-reload-base.js` | chokidar 热重载唯一入口（`src/` 内除本文件外禁止直接 chokidar） |
| `core-fs.js` | `resolveCoreModuleKey`、`scanFiles` |
| `string-array-utils.js` | 配置层字符串数组归一化 |

## Loader 标准模式

1. 类字段存放 watcher / 缓存 Map（禁止在 constructor 里 new 可变容器）
2. 扫描：`FileLoader.getCoreSubDirFiles(subDir)` 或 `paths.getCoreDirs()`
3. 加载：`FileLoader.importFresh(absPath)` + `forEachBatch(..., LOADER_BATCH_SIZE, ...)`
4. 热重载：`this._hotReload = new HotReloadBase({ files, onChange, ... })`，销毁时 `_hotReload?.stop()`

## 文档入口

- HTTP API：`docs/http-api.md`
- 插件 / Tasker / 工作流：`.cursor/skills/xrk-*` 与 `docs/框架可扩展性指南.md`
