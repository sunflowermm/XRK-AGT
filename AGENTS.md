# AGENTS.md — XRK-AGT 开发助手

本文件面向 **在本仓库内写代码、改 Core、排查框架** 的 AI（如 Cursor Agent）。

**项目定位**：融合智能体业务逻辑的**通用后端** — Runtime 在 `src/`，业务在 `core/`（勿在 `src/` 写业务）。

**开发首读**：[`docs/runtime-surface.md`](docs/runtime-surface.md) · [`docs/coding-style.md`](docs/coding-style.md) · [`docs/base-classes.md`](docs/base-classes.md)

**运行时对话 AgentRuntime** 的规则在 `data/ai-workspace/{id}/`（`AGENTS.md`、`SOUL.md`、`memory/` 等），由 `ai-workflow.agentWorkspace` 注入；仓库内 `agents/workspace/` 仅为首次引导模板。

## 必读（优先 `.cursor/rules/`）

- `xrk-project.mdc` — 架构、放码、配置归属；娱乐插件不进底层 / 不加白名单
- `xrk-dev-requirements.mdc` — 全局裸名、HttpResponse、Core www、Node 26（详见 `docs/coding-style.md`）

## 技能与文档

- 全局工程师准则：`~/.cursor/rules/senior-engineer.mdc`
- 工程师 skill 源码（已 clone）：`~/.agents/skills-sources/`（superpowers、planning-with-files、awesome-cursorrules 等）
- 其它 skill：`~/.agents/skills/`（不含与 skills-sources 重复的 obra/planning 副本）
- 框架能力：`.cursor/skills/xrk-*/SKILL.md` · 索引 `SKILL_INDEX.md`
  - 写 **www**：`xrk-www-compat`；写 **HTTP**：`xrk-http-api`；写 **Node API**：`xrk-node-runtime`
- 文档导航：`docs/`、skill `xrk-docs`
- 外部调研：`xrk-github-research`
- XRK 边界补充：`.cursor/rules/xrk-agent-behavior.mdc`

## GitHub MCP（可选）

在 `~/.cursor/mcp.json` 配置 GitHub MCP（模板见 `.cursor/mcp.json.example`，**勿把 PAT 提交进仓库**）。配置后重启 Cursor；验证：Settings → MCP Tools 出现 green dot。CLI 可 `gh auth login` 与 MCP 共用同一 PAT。

## 产品 Core

各 Core 若有 `core/<core>/AGENTS.md`，那是**产品 Agent** 的工作区说明（如李诗雅），与根目录本文件分工不同。
