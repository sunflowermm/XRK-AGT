---
name: xrk-runtime-util
description: 当你需要复用日志/缓存/文件/网络/批处理等基础能力，或为新模块选择合适的工具函数时使用。
---

## 文档与代码

`docs/runtime-util.md`、`src/utils/runtime-util.js`

## 要点

- 日志 `makeLog`、缓存 `getMap`（`Map.getOrInsertComputed`）/`cache`、文件与网络封装；优先用 RuntimeUtil 而非裸 `fs`/`fetch`。
- `RuntimeUtil.Buffer` / 网络下载：内部已用全局 `fetch` + `AbortSignal.timeout`。
- 二进制：`toBase64()` / `Uint8Array.fromBase64()`，勿 `toString('base64')`。
- `AgentRuntime.*` 代理部分静态方法（`AgentRuntime.makeLog`、`AgentRuntime.exec` 等）。
- 用户桌面路径：`src/utils/user-dirs.js`（勿写死 `~/Desktop`）。
- Shell：`#utils/exec-async.js`，勿在业务里 `promisify(exec)`。

## Node 26

详见 skill **`xrk-node-runtime`**。
