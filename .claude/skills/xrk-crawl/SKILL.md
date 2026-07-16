---
name: xrk-crawl
description: 当你需要开发/排查 HTTP 抓取、SSRF、Playwright 受控浏览器、本地字体增强截图，或判断 web_fetch 与 browser 工作流如何选型时使用。
---

## 统一入口（业务优先）

`src/infrastructure/crawl/index.js` — 插件、workflow、HTTP **只从这里 import**（`#infrastructure/crawl/index.js`）。

```javascript
import {
  fetchWithPolicy,
  runWebFetch,
  buildWebFetchRuntime,
  assertUrlSafeForFetch,
  PlaywrightAgentSession,
  createLocalFontScreenshotHelper,
  DEFAULT_DEVICE_SCALE_FACTOR,
  DOM_TWEAK_LABEL_COLON_HALF,
} from '#infrastructure/crawl/index.js'
```

`fetchWithPolicy` 实现在 `#utils/fetch-with-retry.js`，由 crawl 门面 re-export。

## 能力分层（何时用谁）

| 场景 | 能力 | 实现文件（均在 `src/infrastructure/crawl/`） |
|------|------|------------------------------|
| 简单 API / 无需 JS 渲染 | `fetchWithPolicy` | `#utils/fetch-with-retry.js` |
| 正文提取、Readability、Firecrawl | `runWebFetch` | `web-fetch-executor.js` |
| 开放域检索 | `runWebSearch` | `web-search-executor.js` + `web-search-registry.js` |
| 零配置免费检索 | `runParallelFreeSearch` | `web-search-parallel-free.js` + `web-search-mcp-client.js` |
| 浏览器运行时 | `buildBrowserRuntime` | `crawl-config.js`（ai-workflow.crawl + renderer.playwright） |
| MCP `web_fetch` / `web_search` | `workflow/web.js` | 内部用 crawl |
| JS 渲染、交互、截图 | `PlaywrightAgentSession` | `playwright-session.js` |
| MCP 受控浏览器 | `workflow/browser.js` | `browser_*` 工具 |
| 截图字体/样式与线上一致 | `createLocalFontScreenshotHelper` | `page-screenshot-enhance.js` |

**选型**：HTTP 能拿正文 → `runWebFetch`；要渲染或 PNG → Playwright。

## SSRF

- `ssrf-policy.js`：allowlist、legacy IP、DNS pinning、`createPinnedDispatcher`
- `ssrf-guard.js`：对外 re-export `assertUrlSafeForFetch`
- `fetch-guard.js`：`fetchWithSsrFGuard`（每跳 pin DNS + 重定向环）
- `browser-navigation-guard.js`：`gotoWithNavigationGuard`（`page.route` 拦截）

## PlaywrightAgentSession 常用 API

| 方法 | 说明 |
|------|------|
| `roleSnapshot()` | ARIA ref 树 + `storeRoleRefsOnPage` |
| `runAct({ kind, ref, ... })` | 含 `batch`、`scrollIntoView`、`fill` fields |
| `listTabs` / `newTab` / `closeTab` / `focusTab` | 多标签 |
| `getConsoleMessages` / `getNetworkRequests` | 页面观测 |
| `armDialog` / `respondDialog` | 弹窗 |
| `goto(url)` | `gotoWithNavigationGuard` + 交互后 SSRF 复检 |

## 目录结构

```
src/infrastructure/crawl/
  index.js
  ssrf-*.js / fetch-guard.js / browser-navigation-guard.js
  playwright-session.js / pw-*.js / act-policy.js
  web-fetch-*.js / web-search-*.js / crawl-config.js
  page-screenshot-enhance.js
```

## 配置（commonconfig）

**Schema**：`core/system-Core/commonconfig/system.js` → `ai-workflow.fields.crawl`  
**默认模板**：`config/default_config/ai-workflow.yaml` → `crawl:`  
**运行时数据**：`data/server_bots/{port}/ai-workflow.yaml` → `crawl.webFetch` / `crawl.webSearch` / `crawl.browser`

**优先级**：调用方 `overrides` > `ai-workflow.crawl` > `renderer.playwright`（browser 启动）> 默认

**单一实现**：`crawl-config.js` — `resolveWebFetchRuntime` / `resolveWebSearchConfig` / `buildBrowserRuntime`  
**禁止**在 crawl 模块内读取 `process.env` 做业务配置；凭据与参数一律写 `data/server_bots/{port}/ai-workflow.yaml` → `crawl.*`。

## 与工作流

- `core/system-Core/workflow/web.js` → `web_fetch` / `web_search`
- `core/system-Core/workflow/browser.js` → 全量 `browser_*`（见 `docs/system-core.md`）

## 常见陷阱

- 扩展写在 `src/infrastructure/crawl/` 内并在 `index.js` 导出，不要在 Core 内复制一份。
- Core 业务只 import 门面，勿在 Core 写 SSRF/搜索驱动。

## Node 26

- `fetch-with-retry.js`、`web-fetch-executor.js` 已用全局 `fetch` + `AbortSignal.timeout`；扩展时沿用，**禁止** `node-fetch`。
- 正文/截图二进制：`toBase64()` / `Uint8Array.fromBase64()`，勿 `toString('base64')`。
- catch 与 SSRF 错误：`Error.isError` / `normalizeError`（skill **`xrk-node-runtime`**）。

## 参考

- `docs/system-core.md`（web / browser 章节）
- 本地 vendor 插件：`core/system-Core/plugin/` 下未写入 `.gitignore` 白名单的 `.js` 仍会加载，但不计入框架 baseline
