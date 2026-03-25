# agent-browser

Playwright 受控会话与导航前 SSRF 校验（`ssrf-guard` 与 `web_fetch` 一致）。由 **`core/system-Core/stream/browser.js`** 挂载 MCP。

| 文件 | 说明 |
|------|------|
| `playwright-session.js` | `PlaywrightAgentSession`：`launch`、`goto`、`title`、`textContent`、`screenshot`、`close` |
| `nav-ssrf.js` | `assertUrlSafeForBrowserNavigation` → `../openclaw-web/ssrf-guard.js` |
| `index.js` | 对外导出 |

配置：`aistream.tools.agentBrowser`（`config/default_config/aistream.yaml`、`commonconfig/system.js` schema）。
