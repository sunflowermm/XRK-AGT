# AGENTS.md — XRK-AGT 开发助手

本文件面向 **在本仓库内写代码、改 Core、排查框架** 的 AI（如 Cursor Agent）。

**运行时对话 Bot** 的规则在 `data/ai-workspace/{id}/`（`AGENTS.md`、`SOUL.md`、`memory/` 等），由 `aistream.agentWorkspace` 注入；仓库内 `agents/workspace/` 仅为首次引导模板。

## 必读（优先 `.cursor/rules/`）

- `xrk-project.mdc` — 架构、放码位置、配置模板归属
- `xrk-dev-requirements.mdc` — Node 26、全局 Bot/segment、HttpResponse

## 技能与文档

- 框架能力：`.cursor/skills/xrk-*/SKILL.md`
- 文档导航：`docs/`、skill `xrk-docs`

## 产品 Core

各 Core 若有 `core/<core>/AGENTS.md`，那是**产品 Agent** 的工作区说明（如李诗雅），与根目录本文件分工不同。
