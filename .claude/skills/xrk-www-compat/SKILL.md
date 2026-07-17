---
name: xrk-www-compat
description: 编写或审查 core/*/www 静态页、校园 WebView 兼容、HttpResponse 前端解包时使用。浏览器环境 ≠ Node 26。
---

# Core www 浏览器兼容（底层标准）

> **权威实现**：`core/system-Core/www/xrk/modules/web-compat.js` → **`/xrk/modules/web-compat.js`**（随 xrk 进 git，勿再用已废弃的 `/shared`）  
> **挂载**：`mountCoreWwwStatic`（`www/<子目录>` → `/<子目录>`）  
> **服务端响应形状**：skill **`xrk-http-api`** · `HttpResponse.success`

## 分层边界

| 环境 | 超时 / UUID / 克隆 | HttpResponse 消费 |
|------|-------------------|-------------------|
| **Node 服务端** | `AbortSignal.timeout`；见 **`xrk-node-runtime`** | 只写响应 |
| **浏览器 Core www** | `abortTimeout` / `randomId` / `deepClone` | `unwrapSuccess` 或读顶层 |

**禁止**把 Node 26 写法原样抄进 `www/`。

## API

```javascript
// 控制台内部
import { randomId, unwrapSuccess, abortTimeout, deepClone } from './web-compat.js';

// 其它 Core ESM（可选）
import { unwrapSuccess } from '/xrk/modules/web-compat.js';
```

| 导出 | 勿用（浏览器） |
|------|----------------|
| `randomId` | 裸 `crypto.randomUUID()` |
| `unwrapSuccess` | 默认 `json.data.xxx` |
| `abortTimeout` | 裸 `AbortSignal.timeout` |
| `deepClone` | 无降级的 `structuredClone` |

- **产品页亦可内联**同语义（psyche / xiaozhi），避免跨应用硬依赖。
- **勿**再建 `www/shared` 抢根路径 `/shared`（lsy 用 `lsy-shared`）。

## 审查清单

- [ ] 无裸 `crypto.randomUUID` / `AbortSignal.timeout` / 无降级 `structuredClone`
- [ ] 消费 API：`unwrapSuccess` 或读顶层
- [ ] 新能力优先扩 `web-compat.js`，再同步内联份
- [ ] `tests/framework/www-web-compat.test.mjs`
