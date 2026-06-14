# XRK-AGT 项目概览

> **Node.js ≥ 26.0** · **包管理仅 pnpm**  
> XRK-AGT 是**融合智能体业务逻辑的通用后端**：`src/` 提供 Runtime 与基础设施，`core/*/` 承载插件、HTTP API、AI 工作流、Tasker 与智能体业务。

**入口导航**

| 目的 | 文档 |
|------|------|
| 安装与运行 | [README.md](README.md) |
| 文档索引 | [docs/README.md](docs/README.md) |
| 架构边界（先读） | [docs/底层架构设计.md](docs/底层架构设计.md) |
| 启动链 | [docs/startup.md](docs/startup.md) |
| 数据库 | [docs/database.md](docs/database.md) |
| 扩展开发 | [docs/框架可扩展性指南.md](docs/框架可扩展性指南.md) |
| 内置能力 | [docs/system-core.md](docs/system-core.md) |
| 测试 / 审查 | [docs/框架测试指南.md](docs/框架测试指南.md) · [docs/代码审查清单.md](docs/代码审查清单.md) |

---

## 技术栈摘要

- **运行时**：Node.js 26+，Express，全局 `Bot`（`src/bot.js`）
- **数据**：Redis + MongoDB（默认必需；无库调试 `XRK_OPTIONAL_DB=1`）
- **AI**：`AIStream` 工作流 + LLM/ASR/TTS 工厂 + MCP
- **接入**：OneBotv11 / QBQBot / GSUIDCORE / stdin / 自定义 Tasker
- **渲染**：Playwright（默认）/ Puppeteer；Chromium 可选安装

架构图、分层职责、消息与 AI 链路：**仅维护于 [docs/底层架构设计.md](docs/底层架构设计.md)**，本页不重复 mermaid。

---

## 目录结构

```
XRK-AGT/
├── app.js                    # → src/utils/bootstrap.js
├── start.js                  # 菜单 / PM2 / server
├── package.json
│
├── src/                      # Runtime + 基础设施（勿写业务）
│   ├── bot.js
│   ├── infrastructure/       # 加载器、基类、database、config…
│   ├── utils/                # bootstrap、process-signals、http-business…
│   ├── factory/              # LLM / ASR / TTS
│   └── renderers/
│
├── core/                     # 业务与智能体逻辑
│   ├── system-Core/          # 内置：http / stream / plugin / tasker / www/xrk
│   └── <your-core>/          # 自定义 Core
│
├── config/default_config/    # AGT 运行时配置模板（非独立产品业务 yaml）
├── data/server_bots/         # 运行时配置（gitignore）
├── docs/                     # 开发文档
├── www/                      # 可选根级静态站
└── resources/                # 渲染模板
```

### 关键路径

| 路径 | 说明 |
|------|------|
| `app.js` → `bootstrap.js` → `start.js` → `bot.js` | 启动链，见 [docs/startup.md](docs/startup.md) |
| `core/*/plugin/` | 指令与增强插件 |
| `core/*/http/` | HTTP API（`/api/` 默认鉴权） |
| `core/*/stream/` | AI 工作流（`AIStream`） |
| `core/*/tasker/` | 平台协议 → 统一事件 |
| `core/*/events/` | 去重、标准化 → `PluginsLoader.deal` |
| `core/*/www/<app>/` | 静态前端（如 `/xrk/`） |
| `core/*/commonconfig/` | 配置 Schema（独立 Core 模板在 `core/<名>/default/`） |

**规则**：业务只在 `core/`；`config/default_config/` 仅 AGT 运行时模板；独立产品配置见各 Core 的 `default/` + `data/<产品>/`。

---

## system-Core 规模（索引）

开箱即用模块数量以代码与 [docs/system-core.md](docs/system-core.md) 为准（约 11 HTTP / 7 工作流 / 15 插件 / 4 Tasker / Web 控制台 `/xrk/`）。MCP 工具数以 `registerMCPTool` 为准。

---

## 专题文档（不重复于此）

- **Node 26 API**：[docs/node-26-runtime.md](docs/node-26-runtime.md)
- **HTTP 业务层**：[docs/http-business-layer.md](docs/http-business-layer.md)
- **安全与鉴权**：[docs/server.md](docs/server.md) · [docs/AUTH.md](docs/AUTH.md)
- **应用 / Web 控制台**：[docs/app-dev.md](docs/app-dev.md)

---

*最后更新：2026-06-14*
