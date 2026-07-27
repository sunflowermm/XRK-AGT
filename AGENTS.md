# AGENTS.md — XRK-AGT（本仓库）

面向在本仓库写代码、改 Core、排查框架的 AI。

**全局**技能栈、代理、PCB、Ponytail/Hallmark/Superpowers 安装与用法：见本机  
`~/.cursor/AGENTS.md`（系统级）。**勿**把本机环境写进本文件。

**项目定位**：通用后端 Runtime（`src/`）+ 业务 Core（`core/`）。业务不进 `src/`。

**首读**：[`docs/runtime-surface.md`](docs/runtime-surface.md) · [`docs/coding-style.md`](docs/coding-style.md) · [`docs/base-classes.md`](docs/base-classes.md)

运行时对话 Agent 的规则在 `data/ai-workspace/{id}/`；仓库种子在 `agents/`（`workspace/` 模板、`rules/`、`skills/standard`）。

## 本仓规则（`.cursor/rules/`）

| 规则 | 作用 |
|------|------|
| `xrk-project.mdc` | 架构、放码、配置归属；娱乐插件不进白名单 |
| `xrk-dev-requirements.mdc` | 裸名全局对象、HttpResponse、Core www、Node 26 |
| `xrk-agent-behavior.mdc` | 本仓边界与 skill 入口 |
| `xrk-third-party-plugins.mdc` | 主仓 gitignore / 子服插件约定 |

叠加全局：`~/.cursor/rules/ponytail.mdc` · `~/.cursor/rules/senior-engineer.mdc`。  
本仓写码：爬梯后优先复用 Loader / ConfigBase / HttpResponse / `#utils/*`，不平行造轮子。

## 放码与配置

- 业务：`core/<core名>/`（plugin · http · workflow · tasker · events · commonconfig · www）
- Runtime：`src/` — Core 开发者禁止改；框架维护者可改
- 独立 Core：`core/<名>/default/` + `commonconfig/` + `data/<产品>/`；勿进 `config/default_config/`
- HTTP：`HttpResponse`；全局：`AgentRuntime` / `msgSegment` 裸名

## 本仓技能

索引：[`.cursor/skills/SKILL_INDEX.md`](.cursor/skills/SKILL_INDEX.md)

| 主题 | Skill |
|------|-------|
| Node 26 | `xrk-node-runtime` |
| Core www | `xrk-www-compat` |
| HTTP | `xrk-http-api` |
| 扩展点 | `xrk-infrastructure` |
| 配置 | `xrk-config` |
| 架构 | `xrk-project-overview` |
| 调研 | `xrk-github-research` |
| 品红 / 短视频 | `immersive-short-video`（约定见系统级 AGENTS；脚本可在本 skill 或产品 Core） |

改 `core/` 前：Grep + 读对应 `xrk-*`。外部方案须说明如何接入既有 Loader / ConfigBase。

UI 落地页：全局 `hallmark` + 本仓 `xrk-www-compat`（浏览器 ≠ Node 26）。

## 文档约定（本仓）

只写现行契约。禁止变更旁白与踩坑叙事（细则见系统级 AGENTS）。  
产品 Core 的 `core/<core>/AGENTS.md` 面向产品 Agent，与本文件分工不同。

## GitHub MCP（可选）

模板：`.cursor/mcp.json.example`。PAT 只放本机 `~/.cursor/mcp.json`，勿提交。
