# agents/ — 办事助手种子

第一次启用工作区时，模板复制到 `data/ai-workspace/{id}/`，之后以运行时那份为准。

| 文档 | 路径 |
|------|------|
| 用户 / 运维 / 维护者 | [docs/agents.md](../docs/agents.md) |
| 模型注入规则（模板） | [workspace/AGENTS.md](workspace/AGENTS.md) |
| 框架 / Core 开发 | 仓库根 [AGENTS.md](../AGENTS.md) |

## 目录

| 路径 | 用途 |
|------|------|
| `workspace/` | 工作区模板：规则、偏好、本机备注、记忆结构 |
| `rules/` | 办事行为规则（注入 prompt） |
| `skills/standard/` | 技能种子：办公、检索、环境、基础路由 |
| `subagents.yaml` | 主助手与专项角色清单 |

## 改哪里

| 目的 | 路径 |
|------|------|
| 日常定制（语气、偏好、本机路径） | `data/ai-workspace/{id}/` |
| 更新默认模板 | 本目录种子（工作区已有同名技能时保留工作区版本） |
| 角色说明 | 工作区 `subagents.yaml`（优先）或本目录 `subagents.yaml` |
| 注入规则 | `agents/rules/`（[rules/README.md](rules/README.md)） |
| 技能 | `agents/skills/standard/<name>/SKILL.md`，再同步到工作区 |

配置：`ai-workflow.yaml` → `agentWorkspace`。实现索引：[docs/agents.md](../docs/agents.md) 文末。
