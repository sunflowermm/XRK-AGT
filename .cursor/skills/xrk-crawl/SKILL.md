---
name: xrk-crawl
description: 当你需要开发/排查 HTTP 抓取、SSRF、Playwright 受控浏览器、本地字体增强截图，或判断 web_fetch 与 browser 工作流如何选型时使用。
---

## 统一入口（业务优先）

`core/system-Core/lib/crawl/index.js` — 插件、stream、HTTP 业务**只从这里 import**。

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
} from '../lib/crawl/index.js'
```

## 能力分层（何时用谁）

| 场景 | 能力 | 实现文件（均在 `lib/crawl/`） |
|------|------|------------------------------|
| 简单 API / 无需 JS 渲染 | `fetchWithPolicy` | 经 `../net/fetcher.js` 导出 |
| 正文提取、Readability、Firecrawl | `runWebFetch` | `web-fetch-executor.js` |
| 开放域检索 | `runWebSearch` | `web-search-executor.js` + `web-search-registry.js`（13 提供商） |
| 零配置免费检索 | `runParallelFreeSearch` | `web-search-parallel-free.js` + `web-search-mcp-client.js` |
| 浏览器运行时 | `buildBrowserRuntime` | `crawl-config.js`（aistream.crawl + renderer.playwright） |
| MCP `web_fetch` / `web_search` | `stream/web.js` | 内部用 crawl |
| JS 渲染、交互、截图 | `PlaywrightAgentSession` | `playwright-session.js` |
| MCP 受控浏览器 | `stream/browser.js` | `browser_*` 工具 |
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
lib/crawl/
  index.js
  ssrf-ip-policy.js
  ssrf-policy.js
  ssrf-guard.js
  fetch-guard.js
  redirect-headers.js
  browser-navigation-guard.js
  pw-page-state.js
  pw-role-snapshot.js
  pw-ref-locator.js
  act-policy.js
  playwright-session.js
  web-fetch-executor.js
  web-fetch-utils.js
  web-search-endpoint.js
  web-search-shared.js
  web-search-registry.js
  web-search-executor.js
  crawl-config.js
  web-search-mcp-client.js
  web-search-parallel-shared.js
  web-search-{duckduckgo,brave,perplexity,exa,tavily,parallel,parallel-free,gemini,kimi,minimax,firecrawl,searxng,ollama}.js
  page-screenshot-enhance.js
```

## 配置（commonconfig）

**Schema**：`core/system-Core/commonconfig/system.js` → `aistream.fields.crawl`  
**默认模板**：`config/default_config/aistream.yaml` → `crawl:`  
**运行时数据**：`data/server_bots/{port}/aistream.yaml` → `crawl.webFetch` / `crawl.webSearch` / `crawl.browser`

**优先级**：调用方 `overrides` > `aistream.crawl` > `renderer.playwright`（browser 启动）> 默认

**单一实现**：`crawl-config.js` — `resolveWebFetchRuntime` / `resolveWebSearchConfig` / `buildBrowserRuntime`  
**禁止**在 crawl 模块内读取 `process.env` 做业务配置；凭据与参数一律写 `data/server_bots/{port}/aistream.yaml` → `crawl.*`（控制台 commonconfig 编辑）。

## web_search 提供商

- 注册表：`web-search-registry.js`（`WEB_SEARCH_PROVIDERS`、`resolveAutoDetectProviderId`）
- 配置：`crawl-config.js` → `aistream.crawl`；`getWebSearchProviderScope` 对齐 `parallelFree` ↔ `parallel-free`；browser 另合并 `renderer.playwright`
- 执行器：`web-search-executor.js` → `buildWebSearchRuntime` / `runWebSearch`
- 端点封装：`web-search-endpoint.js`（`withTrustedWebSearchEndpoint` / 自托管 SearXNG·Firecrawl）
- 缺凭据时：`runWebSearch` 默认 `parallel-free`，回退链 **parallel-free → duckduckgo**

## 与工作流

- `stream/web.js` → `web_fetch`（默认 `pinDns: true`）
- `stream/browser.js` → 全量 `browser_*`（见 `docs/system-core.md` §7）

## 常见陷阱

- 扩展写在 `lib/crawl/` 内并在 `index.js` 导出，不要新建仅 re-export 的包装文件。
- 优先 `using` + `gotoAndCapture`，勿手写四段截图流程。

## Node 26

- `lib/net/fetcher.js`、`web-fetch-executor.js` 已用全局 `fetch` + `AbortSignal.timeout`；扩展时沿用，**禁止** `node-fetch`。
- 正文/截图二进制：`toBase64()` / `Uint8Array.fromBase64()`，勿 `toString('base64')`。
- catch 与 SSRF 错误：`Error.isError` / `normalizeError`（skill **`xrk-node-runtime`**）。

## 参考

- `docs/system-core.md`（web / browser 章节）
- 本地 vendor 插件：`core/system-Core/plugin/` 下未写入 `.gitignore` 白名单的 `.js` 仍会加载，但不计入框架 baseline
