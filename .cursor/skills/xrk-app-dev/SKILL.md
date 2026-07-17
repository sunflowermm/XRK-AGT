---
name: xrk-app-dev
description: 当你需要从“应用视角”看 XRK-AGT（启动流程、Web 控制台、前后端协作、典型技术栈组合）时使用。
---

## 文档

`docs/app-dev.md`

## 要点

- 启动：`node app` → `app.js`（校验 Node ≥26）→ `start.js` → `src/agent-runtime.js`
- 控制台：`core/system-Core/www/xrk/`，路径 `/xrk`
- 配置：全局 `data/server_bots/*.yaml`；端口 `data/server_bots/{port}/*.yaml`（含 `ai-workflow.yaml`）
- 运行时约定：`docs/node-26-runtime.md`、skill **`xrk-node-runtime`**

## Core www（浏览器 ≠ Node 26）

产品页在校园 WebView / HTTP 非安全上下文里跑时，**不要**直接用 Node 侧写法（`AbortSignal.timeout`、裸 `crypto.randomUUID`、默认 `json.data`）。

共享兼容层（system-Core 挂载）：

| 路径 | URL |
|------|-----|
| `core/system-Core/www/shared/xrk-web-compat.js` | `/shared/xrk-web-compat.js` |

导出：`randomId`、`unwrapSuccess`、`abortTimeout`、`deepClone`。

```javascript
import { randomId, unwrapSuccess, abortTimeout } from '/shared/xrk-web-compat.js';
```

- ESM 页：直接 import。
- 经典 `<script>`：内联同语义函数，或注明与 shared 对齐（见 xiaozhi）。
- 控制台 `www/xrk/modules/utils.js` 已再导出上述 API。
- HttpResponse 解包细则：skill **`xrk-http-api`**。

审计备忘：`randomUUID` 曾仅 psyche 踩坑；`AbortSignal.timeout`/`structuredClone` 曾在 `/xrk`；kaguya Astock 的 `json.data` 为服务端刻意 `success(res, { data })`，属正常。
