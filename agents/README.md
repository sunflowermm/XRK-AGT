# agents/ — 办事助手种子

这里是**办事助手**的仓库种子：第一次启用某个工作区时，会把模板复制到 `data/ai-workspace/{id}/`，之后以运行时那份为准。

**完整说明（用户 / 运营向）**：[docs/agents.md](../docs/agents.md)

## 里面有什么

| 目录 / 文件 | 用途 |
|-------------|------|
| `workspace/` | 工作区模板：助手怎么帮你、你的偏好、本机备注、记忆结构 |
| `rules/` | 办事行为规则（回复安全、项目边界等） |
| `skills/standard/` | 技能种子：办公、检索、环境、基础路由 |
| `subagents.yaml` | 主助手与专项助手清单（规划、调研、文稿、工作区整理） |

## 你会改哪份

- **日常定制**：改 `data/ai-workspace/{id}/` 里的 `AGENTS.md`、`USER.md`、`TOOLS.md`、`memory/` 等。
- **更新默认模板给所有人**：改本目录种子，新工作区或缺省文件会跟着变；已在工作区里改过的副本不会被覆盖。
- **换助手角色说明**：工作区根 `subagents.yaml` 优先于本文件的 `subagents.yaml`。

配置项见 `ai-workflow.yaml` 的 `agentWorkspace`；实现细节见 [docs/agents.md](../docs/agents.md) 文末「实现索引」。
