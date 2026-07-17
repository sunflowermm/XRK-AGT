---
name: xrk-www-compat
description: 编写或审查 core/*/www 静态页、校园 WebView 兼容、HttpResponse 前端解包、/shared/xrk-web-compat 时使用。浏览器环境 ≠ Node 26。
---

# Core www 浏览器兼容（底层标准）

> **权威实现**：`core/system-Core/www/shared/xrk-web-compat.js` → 挂载 **`/shared/xrk-web-compat.js`**  
> **挂载逻辑**：`src/infrastructure/http/mount-core-www.js`（`www/<子目录>` → `/<子目录>`）  
> **服务端响应形状**：skill **`xrk-http-api`** · `HttpResponse.success`  
> **应用视角**：skill **`xrk-app-dev`** · `docs/app-dev.md`

## 分层边界（必须分清）

| 环境 | 超时 / UUID / 克隆 | HttpResponse 消费 |
|------|-------------------|-------------------|
| **Node 服务端**（`core/*/http`、`src/`） | `AbortSignal.timeout`、Node `crypto`；见 **`xrk-node-runtime`** | 只写响应，不跑浏览器 API |
| **浏览器 Core www** | **`abortTimeout` / `randomId` / `deepClone`**（本 skill） | **`unwrapSuccess`** 或读顶层字段 |

**禁止**把 Node 26 写法原样抄进 `www/`（校园 WebView、HTTP 非安全上下文常缺 `crypto.randomUUID`、`AbortSignal.timeout`、`structuredClone`）。

## 共享模块 API

```javascript
import {
  randomId,
  unwrapSuccess,
  abortTimeout,
  deepClone,
} from '/shared/xrk-web-compat.js';
```

| 导出 | 用途 | 勿用（浏览器） |
|------|------|----------------|
| `randomId(prefix?)` | 本地 ID | 裸 `crypto.randomUUID()` |
| `unwrapSuccess(json)` | 解包 `HttpResponse.success` | 默认 `json.data.xxx` |
| `abortTimeout(ms)` | `fetch` 超时 signal | 裸 `AbortSignal.timeout` |
| `deepClone(value)` | 深拷贝 | 裸 `structuredClone`（可作优先路径，须有降级） |

- **ESM 页**：直接 import 绝对路径 `/shared/...`（与当前 host 同源）。
- **经典 `<script>`**：内联同语义，并注释「与 `/shared/xrk-web-compat.js` 对齐」（例：xiaozhi）。
- **控制台**：`core/system-Core/www/xrk/modules/utils.js` 再导出上述四函数，供 `/xrk` 内部使用。

## `unwrapSuccess` 与拍平约定

`HttpResponse.success(res, data)`：

- **普通对象** → 字段拍平到顶层（**无**外层 `data`）
- **数组 / 标量** → 放在 `data`
- 业务要顶层 `data` → 服务端显式 `success(res, { data: payload })`（kaguya / xiaozhi config 属此）

```javascript
// ✅
const payload = unwrapSuccess(json);
// 或直接 json.assessments / json.configs

// ❌
const { webVersion } = json.data; // 对象拍平后 data 常为 undefined
```

## www 放码与挂载

- 路径：`core/<core>/www/<应用名>/`（**必须**子目录；`shared` 为 system-Core 共享名，勿被其它 Core 抢占 `/shared`）
- 同名子目录先挂载者占用；冲突打 warn 并跳过
- 含 `sign.json` 的子目录跳过根路径静态挂载（前端自建构建产物约定）
- 保留段不可作应用名：`api`、`core`、`media`、`uploads`、`File`

## 审查清单（改 www 前）

- [ ] 无裸 `crypto.randomUUID` / `AbortSignal.timeout` / 无降级的 `structuredClone`
- [ ] 消费 API：用 `unwrapSuccess` 或读顶层；不默认 `json.data.字段`
- [ ] 新共享能力优先扩 `xrk-web-compat.js`，再改各 Core 复制份
- [ ] 单测：改 shared 时跑 `tests/framework/www-web-compat.test.mjs`（已入 `test:fast`）

## 反例备忘（已修）

| 症状 | 根因 | 标准做法 |
|------|------|----------|
| `undefined.webVersion` | `return json.data` | `unwrapSuccess` |
| `crypto.randomUUID is not a function` | 旧 WebView / 非安全上下文 | `randomId` |
| `/xrk` 超时抛错 | 无 `AbortSignal.timeout` | `abortTimeout` |
