# AGENTS.md — XRK-AGT（本仓库）

面向在本仓库写代码、改 Core、排查框架的 AI / 开发者。

## 相关文档

| 文件 | 读者 | 内容 |
|------|------|------|
| **本文件** | Cursor / 框架与 Core 开发 | 放码、配置归属、本仓 skill 路由 |
| `~/.cursor/AGENTS.md` | 本机所有项目 | 全局技能、代理、PCB、生图/视频等 |
| [`docs/agents.md`](docs/agents.md) | 用户 / 运维 / 维护者 | 运行时对话 Agent（办事助手） |
| [`docs/agent-context.md`](docs/agent-context.md) | 框架 / Core / 运维 | Agent 跑通契约：概念地图、消息三层、Workspace、工具环 |
| `agents/workspace/AGENTS.md` → `data/ai-workspace/{id}/` | 办事助手模型 | 注入 prompt 的办事规则 |
| `core/<core>/AGENTS.md`（若有） | 产品 Agent | 该产品工作区与工具边界 |

写框架 / Core：本文件 + `.cursor/rules` + `xrk-*` skill。  
调办事助手：`agents/` 或 `data/ai-workspace/{id}/`，说明见 [`docs/agents.md`](docs/agents.md)。

## 项目定位

通用后端 Runtime（`src/`）+ 业务 Core（`core/`）。业务放在 `core/`。

- **首读**：[`docs/runtime-surface.md`](docs/runtime-surface.md) · [`docs/coding-style.md`](docs/coding-style.md) · [`docs/base-classes.md`](docs/base-classes.md)
- **文档导航**：skill `xrk-docs` · [`docs/README.md`](docs/README.md)
- **栈**：Node ≥ 26 · 包管理仅 **pnpm** · 启动 `node app` → `start.js` → `src/agent-runtime.js`

## 本仓规则（`.cursor/rules/`）

| 规则 | 作用 |
|------|------|
| `xrk-project.mdc` | 架构、放码、配置归属；娱乐插件白名单策略 |
| `xrk-dev-requirements.mdc` | 裸名全局对象、HttpResponse、Core www、Node 26 |
| `xrk-agent-behavior.mdc` | 本仓边界与 skill 入口 |
| `xrk-third-party-plugins.mdc` | 主仓 gitignore / 子服插件约定 |

叠加全局：`~/.cursor/rules/ponytail.mdc` · `~/.cursor/rules/senior-engineer.mdc`。  
写码优先复用 Loader / ConfigBase / HttpResponse / `#utils/*`。

## 一眼锁定（任务 → Skill）

改 `core/` / `src/` 前：Grep 调用方 → **Read** 对应 `SKILL.md` → 再动手。索引：[`.cursor/skills/SKILL_INDEX.md`](.cursor/skills/SKILL_INDEX.md)（含**读者分流**）。

| 读者 | 技能树 |
|------|--------|
| **Coding Agent**（本对话改代码） | `.cursor/skills/xrk-*` |
| **产品 / 办事助手模型** | `agents/skills/standard/**`（注入目录卡，细则 `tools.read`） |
| **人读契约** | `docs/*`（勿把 coding skill 写进产品 skill） |

| 你在做什么 | 先读 |
|------------|------|
| 写/审 Core 或 `src/` 服务端代码 | `xrk-node-runtime` → `xrk-coding-style` |
| `core/*/www` 静态页 / WebView / 挂载 / `sign.json` | `xrk-www-compat`；落地页加全局 `hallmark` |
| HTTP API / handler / 响应形状 | `xrk-http-api`；前端解包见 `xrk-www-compat` |
| 新增/改 YAML 字段、schema、模板路径 | `xrk-config` |
| 插件 / Loader / 基类扩展点 | `xrk-infrastructure` · `xrk-plugins` |
| AI 工作流 / 出站 / 策略安全 / MCP | `xrk-ai-workflow` · `xrk-mcp` · [`docs/agent-context.md`](docs/agent-context.md) |
| 办事助手种子 / 工作区注入 | [`docs/agents.md`](docs/agents.md) · [`docs/agent-context.md`](docs/agent-context.md) · `src/utils/agent-workspace.js` |
| LLM 工厂 / 代理 fetch | `xrk-llm` · `xrk-v3-api` |
| Tasker / OneBot | `xrk-tasker` |
| 子服 / 第三方 `apis/` | `xrk-subserver` · `xrk-third-party-plugins` |
| 爬虫 / Playwright | `xrk-crawl` |
| 架构总览 / 放哪 | `xrk-project-overview` · `xrk-project.mdc` |
| 外部方案调研再接入 | `xrk-github-research`（说明如何接 Loader / ConfigBase） |
| 品红抠图 / 竖屏口播 | `immersive-short-video`（跨项目约定见本机 AGENTS） |

冲突时：过程类（ponytail / 调试）→ 上表领域 skill → 细分子 skill。

## 放码与配置

| 类型 | 路径 |
|------|------|
| 业务 | `core/<core>/{plugin,http,workflow,tasker,events,commonconfig,www/<app>}/` |
| Runtime / 基类 / 工厂 | `src/infrastructure/` · `src/utils/` · `src/factory/` |
| system / 工厂配置模板 | `config/default_config/`（仅 AGT / 工厂 / system-Core） |
| 独立产品模板 / schema / 运行时 | `core/<core>/default/` · `commonconfig/` · `data/<产品>/` |
| 办事助手种子 | `agents/` → 运行时 `data/ai-workspace/{id}/` |

- Core 业务在 `core/`；扩 Runtime 能力改 `src/`，经文档 / commonconfig 暴露。
- 无 `package.json` 的 core：可用 `#infrastructure/*`、`#utils/*`。有 `package.json` 的 core：相对路径引用根 `src/`。
- HTTP：`HttpResponse`（`#utils/http-utils.js`）。全局：`AgentRuntime` / `msgSegment` 裸名。
- `www/<应用名>/` 为子目录；保留根名：`api` · `core` · `media` · `uploads` · `File` · `shared`。
- 娱乐插件：配置写插件顶部，本地忽略运行；不进 system-Core 白名单、默认不提交。

## 写法要点

| 场景 | 做法 |
|------|------|
| 产品配置 | `core/<core>/default/` + `commonconfig/` + `data/<产品>/` |
| `HttpResponse.success` 普通对象 | 字段拍平到顶层；前端用 `unwrapSuccess` 或读顶层字段 |
| Core www 超时 / ID / 克隆 | 内联与 `/xrk` 同源语义（见 `xrk-www-compat`） |
| AI 工作流目录与配置名 | `workflow` / `ai-workflow` |
| 改办事助手已有文稿 | `search_replace`（见 `docs/agents.md`） |
| 第三方 `apis/` | 框架白名单 + 本地 clone（`xrk-third-party-plugins`） |
| 启动早期读配置 | ConfigBase / 默认模板；等 `CommonConfigRegistry.load()` 后再用 `runtimeConfig` |
| 实例缓存 / 易变状态 | 类字段声明处或 `init()` 初始化 |

## 文档约定

- 只写现行契约；「在哪改」给到文件 + 函数/字段；与代码冲突以代码为准。
- 产品 Core：`README.md` 写集成；`AGENTS.md` / `skills/`（若有）写产品 Agent 工作区与工具。
- 索引：[docs/README.md](docs/README.md) · 办事助手：[docs/agents.md](docs/agents.md)

## GitHub MCP（可选）

模板：`.cursor/mcp.json.example`。PAT 放本机 `~/.cursor/mcp.json`。
