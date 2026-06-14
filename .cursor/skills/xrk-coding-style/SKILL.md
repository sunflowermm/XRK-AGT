---
name: xrk-coding-style
description: 编写或审查 core/src 代码时的写法与性能规范（全局裸名、状态、I/O、异步、HTTP）。改 Core 前必读。
---

## 权威文档

- **主文档**：`docs/coding-style.md`（速查表 + 分节规范）
- 挂载：`docs/runtime-surface.md`
- Node API：`docs/node-26-runtime.md` · skill **`xrk-node-runtime`**
- Loader：`docs/infrastructure-shared.md`

## 30 秒记忆

1. 业务 **`core/`** — 裸名 `Bot`/`segment`，勿 `global.`；HTTP 用 `req.bot` + `HttpResponse`
2. **类字段**存 Map/缓存，constructor 只 `super()` + 固定配置
3. 热路径 **`fs/promises`**，批加载 **`forEachBatch`**，出站 **`fetch` + `AbortSignal.timeout`**
4. 错误 **`normalizeError`**，Shell **`#utils/exec-async.js`**
5. 有 `package.json` 的子 Core **不用 `#` 别名**

## 审查

改代码前对照 `docs/coding-style.md` 文末清单 + `.cursor/rules/xrk-dev-requirements.mdc`。
