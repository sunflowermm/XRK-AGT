# Skill 索引（本仓库）

本文件列出 XRK-AGT 项目内 `.cursor/skills/`。  
全局技能见本机 `~/.cursor/AGENTS.md` · `~/.agents/skills/`。  
开发入口：仓库根 [`AGENTS.md`](../../AGENTS.md)。  
办事助手技能（`office-*` / `agent-*`）：`agents/skills/standard/` · [`docs/agents.md`](../../docs/agents.md)。

## 一眼锁定（任务 → Skill）

| 你在做什么 | 先读 |
|------------|------|
| 写/审 Core 或 `src/` 服务端 | `xrk-node-runtime` → `xrk-coding-style` |
| `core/*/www` / WebView / `sign.json` | `xrk-www-compat` |
| HTTP API / 响应形状 | `xrk-http-api` |
| 配置 YAML / schema / 模板路径 | `xrk-config` |
| 插件 / Loader / 基类 | `xrk-infrastructure` · `xrk-plugins` |
| AI 工作流 / MCP | `xrk-ai-workflow` · `xrk-mcp` |
| LLM 工厂 | `xrk-llm` · `xrk-v3-api` |
| Tasker / OneBot | `xrk-tasker` |
| 子服 / 第三方 apis | `xrk-subserver` |
| 爬虫 / Playwright | `xrk-crawl` |
| 文档导航 | `xrk-docs` |
| 架构总览 | `xrk-project-overview` |
| 外部方案调研 | `xrk-github-research` |
| 品红抠图 / 竖屏口播 | `immersive-short-video` |

## 设计与前端

- **`immersive-short-video`**：竖屏口播/科普；品红抠图；seek 逐帧 + NVENC（见 skill 内 `reference-capture.md`）
- `accessibility-compliance` · `design-system-patterns` · `fronted-design` · `interaction-design`
- `mobile-android-design` / `mobile-ios-design` / `react-native-design`
- `responsive-design` · `ui-ux-pro-max` · `visual-design-foundations` · `web-component-design`

## XRK 核心技能

- **`xrk-node-runtime`**：Node 26 API（写 Core/src 前）
- **`xrk-www-compat`**：Core `www/` 浏览器兼容、挂载、HttpResponse 前端解包
- **`xrk-config`**：配置模板归属与 schema 三同步
- **`xrk-http-api`**：HttpApi / HttpResponse 形状
- `xrk-ai-workflow` · `xrk-app-dev` · `xrk-auth` · `xrk-agent-runtime` · `xrk-runtime-util`
- `xrk-docker` · `xrk-docs` · `xrk-github-research`
- `xrk-infrastructure` · `xrk-llm` · `xrk-mcp` · `xrk-plugins`
- `xrk-project-overview` · `xrk-renderer` · `xrk-subserver` · `xrk-system-core`
- `xrk-tasker` · `xrk-v3-api` · `xrk-coding-style` · `xrk-crawl`
