# agents/rules — 办事助手行为规则

运行时递归读取本目录 `**/*.{md,mdc}`，追加到办事助手的 system prompt（`includeRules`）。

| | `agents/rules/` | `.cursor/rules/` |
|--|-----------------|------------------|
| 给谁 | 群聊 / 控制台办事助手 | Cursor 写代码的维护者 |
| 写什么 | 回复、交付、安全边界 | 框架、Core、Node 开发约定 |
| 如何生效 | `agentWorkspace` → system prompt | Cursor IDE 上下文 |

## 文件

| 文件 | 作用 |
|------|------|
| `reply-style.mdc` | 先结论、再步骤、给验收点 |
| `response-safety.mdc` | 隐私、删改、外发、命令、数据真实性 |
| `group-chat.mdc` | QQ/群：何时回、一条一答 |
| `delivery.mdc` | 交付路径、验收、缺能力降级 |

相关：`agents/workspace/` · `agents/skills/standard/` · [docs/agents.md](../docs/agents.md)
