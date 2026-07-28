# agents/rules — 办事助手行为规则

运行时递归读取本目录 `**/*.{md,mdc}`，追加到办事助手的 system prompt（`includeRules`）。

## 与 IDE 规则的区别

| | `agents/rules/`（本目录） | `.cursor/rules/` |
|--|---------------------------|------------------|
| 给谁用 | 群聊 / 控制台 **办事助手** | Cursor 里写代码的维护者 |
| 写什么 | 怎么回复、怎么交付、安全边界 | 框架、Core、Node 等开发约定 |
| 注入方式 | `agentWorkspace` → system prompt | Cursor IDE 上下文 |

本目录**不**包含 Node、Core 放码、插件开发等内容；那些只在 `.cursor/rules` 与 `docs/` 里维护。

## 文件说明

| 文件 | 作用 |
|------|------|
| `reply-style.mdc` | 回复结构：先结论、再步骤、给验收点 |
| `response-safety.mdc` | 隐私、删改、外发、命令、数据真实性与凭证 |
| `group-chat.mdc` | QQ/群：何时回、不刷屏、@ 与一条一答 |
| `delivery.mdc` | 交付路径（`docs/`、`exports/`）、验收方式、缺能力时降级 |

可按需增删 `.mdc` 文件；改完重启或热加载后生效（取决于运行时配置）。

## 相关

- 工作区模板：`agents/workspace/`（AGENTS、TOOLS、ENV 等）
- 技能细则：`agents/skills/standard/`
- 完整契约：[docs/agents.md](../docs/agents.md)
