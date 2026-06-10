---
name: agent-memory
description: 工作区 Markdown 记忆 + memory 工作流向量记忆的使用边界
---

## 两层记忆

| 层 | 位置 | 用途 |
|----|------|------|
| **文件记忆** | `memory/YYYY-MM-DD.md`、`memory/MEMORY.md` | 用户偏好、固定联系人、长期约束（推荐） |
| **向量记忆** | memory 工作流 MCP | 语义检索历史片段（需启用 `memory` 工作流） |

默认办公 Agent **不自动启用** memory 工作流；跨会话事实优先写入 `MEMORY.md`。

## 文件记忆（默认）

- 当日流水 → `memory/YYYY-MM-DD.md`
- 值得长期保留 → `MEMORY.md`（用 tools.write 追加）
- **不要写入**：密钥、token、身份证号、一次性闲聊

## 向量记忆（可选）

启用 `memory` 工作流后可用：

| 工具 | 用途 |
|------|------|
| save_memory | 存入可检索片段 |
| query_memory | 语义查询 |
| list_memories | 列举条目 |
| delete_memory | 删除（需确认） |

与 `MEMORY.md` 冲突时：**以用户最新明示为准**；向量库适合大量历史，Markdown 适合可读长期偏好。

## 何时写入

- 用户说「记住」「以后都这样」
- 反复出现的格式/联系人/路径约定
- 项目级决策与验收标准

## 何时不写入

- 未确认的猜测
- 可从工作区文件直接读到的内容
- 敏感凭证
