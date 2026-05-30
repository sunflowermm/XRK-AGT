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
| MCP `web_fetch` | `stream/web.js` | 内部用 crawl |
| JS 渲染、交互、截图 | `PlaywrightAgentSession` | `playwright-session.js` |
| MCP 受控浏览器 | `stream/browser.js` | `browser_*` 工具 |
| 截图字体/样式与线上一致 | `createLocalFontScreenshotHelper` | `page-screenshot-enhance.js` |

**选型**：HTTP 能拿正文 → `runWebFetch`；要渲染或 PNG → Playwright。

## SSRF

- `ssrf-guard.js`：`assertUrlSafeForFetch`、`SsrFBlockedError`
- `PlaywrightAgentSession.goto` 与 `runWebFetch` 共用
- 别名：`assertUrlSafeForBrowserNavigation`

## PlaywrightAgentSession 常用 API

| 方法 | 说明 |
|------|------|
| `PlaywrightAgentSession.launch(options)` | 默认 `deviceScaleFactor=2` |
| `PlaywrightAgentSession.using(options, fn)` | 自动 `close` |
| `attachScreenshotHelper(helper)` | 挂载增强截图助手 |
| `goto(url, { waitUntil, timeoutMs })` | 导航（含 SSRF） |
| `gotoAndCapture(url, { selector, settleMs, ... })` | prepare→goto→等待→截图 |
| `captureRegion(selector)` | 区域截图 |
| `regionText(selector)` | 区域 innerText |

## 目录结构

```
lib/crawl/
  index.js                  # 对外唯一入口
  ssrf-guard.js
  web-fetch-executor.js
  web-fetch-utils.js
  web-fetch-visibility.js
  web-shared.js
  external-content-wrap.js
  playwright-session.js
  page-screenshot-enhance.js
lib/net/fetcher.js          # 通用 HTTP（超时/重试/代理），由 crawl 再导出
```

## 与工作流

- `stream/web.js` → `web_fetch`
- `stream/browser.js` → `browser_*`（`browser_screenshot` 支持 `selector`）

## 常见陷阱

- 扩展写在 `lib/crawl/` 内并在 `index.js` 导出，不要新建仅 re-export 的包装文件。
- 优先 `using` + `gotoAndCapture`，勿手写四段截图流程。

## 参考

- `docs/system-core.md`（web / browser 章节）
- `core/system-Core/plugin/lkwg.js`
