---
name: xrk-llm
description: 当你需要配置/新增/排查 LLM 提供商（OpenAI/Azure/Gemini/Anthropic/Ollama/各类兼容网关）时使用；确保 YAML/Schema/代码一致。
---

## 入口

`docs/factory.md`、`src/factory/llm/LLMFactory.js`、`core/system-Core/http/ai.js`

## 外仓吸收三准则（必须同时满足）

1. **本项目没有**（无等价能力，不是「差一点」）
2. **本产品有必要**（QQ/多通道 AgentRuntime 真刚需，不是酷炫）
3. **对方做得明显更好**（可移植且更稳/更对）

不满足则不学、不融。

## 出站链

```
slash/recipe → messages → toolPair → compaction(+sidecar) → trim → LLM
```

并行：`policies` + `security.toolScan`（`approval` 默认关）+ SystemContext 指纹。

## 已吸收（过三准则）

| 能力 | 来源 | 落点 |
|------|------|------|
| 压缩链 / sidecar / toolPair / finalize | opencode/goose/cline | `context-*` · `tool-loop-finalize` |
| Policy + 威胁扫描 + 可选审批 | opencode/goose | `runtime-policy` · `security.*` |
| Recipe / slash | goose | `recipes/` · `slash-commands` |
| apply_edit / verify / PageRank map | aider | tools MCP |
| triggers microagents | OpenHands | `trigger-microagents` |
| aux / variants / reasoning budget / 重试 | goose/cline/opencode | 既有 LLM 工厂 |

## 刻意不学（未过准则）

| 项 | 原因 |
|----|------|
| 会话标题 / Critic / 改文件 revert 快照 | 非刚需或本仓已有替代路径 |
| body 字段规则矩阵 | 本仓已有 max_tokens 等专项处理；无证明刚需 |
| Docker 沙箱 / FAISS / Agent Canvas | 产品形态不合或过重 |
| Effect 运行时 / 完整 Condensation 事件 | 架构不合 |

## 关键配置

- `security.toolScan`（含 `argKeys`）· `security.approval`（默认 false）· `recipes.scheduleEnabled`
- `policies[]`（effect/action Select；`ask` 工具仍注入，执行时审批）· `mcp.connect` 在远程 MCP 连接前生效
- `context.compaction`（含 `toolOutputMaxChars` / `sessionCache`）· `llm.aux` · provider `contextWindow` / `variant`/`variants`
- 安全门禁统一在 `MCPServer.handleToolCall`（覆盖 LLM / HTTP / WS / JSON-RPC）
- 工具轮预算用尽：各 Chat Completions 客户端 chat/chatStream 均有 finalize；Responses 链式 previousResponseId 收尾
