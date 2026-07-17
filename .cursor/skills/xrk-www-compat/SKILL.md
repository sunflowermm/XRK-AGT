---
name: xrk-www-compat
description: 编写或审查 core/*/www 静态页、校园 WebView 兼容、HttpResponse 前端解包时使用。浏览器环境 ≠ Node 26。
---

# Core www 浏览器兼容（底层标准）

> **语义权威**：`core/system-Core/www/xrk/modules/web-compat.js`  
> **挂载**：`mountCoreWwwStatic`（`src/infrastructure/http/mount-core-www.js`）  
> **响应形状**：skill **`xrk-http-api`** · `HttpResponse.success`

## 一层边界

| 环境 | 超时 / ID / 克隆 | HttpResponse |
|------|------------------|--------------|
| Node（`core/*/http`、`src/`） | `AbortSignal.timeout`；**`xrk-node-runtime`** | 只写响应 |
| 浏览器 `www/` | `abortTimeout` / `randomId` / `deepClone` | `unwrapSuccess` 或读顶层 |

## 用法（强制，与 Core 一致）

| 场景 | 做法 |
|------|------|
| `/xrk` 控制台 | `import { … } from './web-compat.js'`（`utils.js` 再导出） |
| **其它产品 Core** | **只内联**同语义（psyche / xiaozhi 已如此）；**禁止**依赖 `/shared` 或跨应用 `/xrk/...` |
| 经典 `<script>` | 内联，注释写「对齐 web-compat.js」 |

| 导出 | 浏览器勿裸用 |
|------|----------------|
| `randomId` | `crypto.randomUUID()` |
| `unwrapSuccess` | 默认 `json.data.字段` |
| `abortTimeout` | `AbortSignal.timeout` |
| `deepClone` | 无降级 `structuredClone` |

新能力：**先改** `web-compat.js`，再同步各产品内联份。

## www 目录名

- 必须：`core/<core>/www/<应用名>/`
- **保留根名**（`RESERVED_ROOT_SEGMENTS`）：`api`、`core`、`media`、`uploads`、`File`、**`shared`**
- 产品静态用自有名（例：`www/lsy-shared` → `/lsy-shared`）
- 同名根路径：先挂占用，后挂 warn 跳过

## 审查

- [ ] 无裸 `randomUUID` / `AbortSignal.timeout` / 无降级 `structuredClone`
- [ ] 产品页未 `import` `/shared` 或 `/xrk/modules/web-compat.js`
- [ ] 未使用保留目录名 `shared`
- [ ] `tests/framework/www-web-compat.test.mjs`
