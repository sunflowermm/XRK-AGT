---
name: xrk-project-overview
description: 当需要从整体理解 XRK-AGT 的架构、目录、运行流程和技术栈时使用。
---

## 文档

- `PROJECT_OVERVIEW.md`、`docs/README.md`、`docs/底层架构设计.md`
- **Node 26**：`docs/node-26-runtime.md`、skill **`xrk-node-runtime`**（写 Core 必读）

## 要点

- 分层：Bot（Runtime）→ 基础设施（Loader/基类）→ Tasker / 事件 → Core 业务。
- 业务在 `core/<名>/(plugin|http|stream|tasker|events|commonconfig|www/<app>)`；`src/` 仅基础设施与工厂。
- Node ≥ 26.0（`package.json` engines）。

## Node 26 开发红线（AI 勿引导旧写法）

| 用 | 勿用 |
|----|------|
| 全局 `fetch` + `AbortSignal.timeout` | `node-fetch`、`AbortController`+`setTimeout` |
| `#utils/exec-async.js` | `promisify(exec)`、`child_process/promises` |
| `Error.isError` / `normalizeError` | `instanceof Error` 判错 |
| `toBase64()` / `fromBase64()` | `toString('base64')` |
| `new URLPattern(...)` | polyfill / 特性检测回退 |

细则与示例：skill **`xrk-node-runtime`**。

## 放码速查

| 类型 | 路径 |
|------|------|
| 业务 | `core/<core>/` 各子目录 |
| 基类/加载器 | `src/infrastructure/` |
| 工具 | `src/utils/`（`normalize-error.js`、`exec-async.js`） |
| 工厂 | `src/factory/` |
| 前端 | `core/<core>/www/<app>/` |
