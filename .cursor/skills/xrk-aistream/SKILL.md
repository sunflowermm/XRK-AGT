---
name: xrk-aistream
description: 当你需要开发/调试 AIStream 工作流、RAG 上下文增强、子服务端回退逻辑、MCP 工具注册与作用域控制时使用。
---

## 文档与代码

`docs/aistream.md`、`src/infrastructure/aistream/aistream.js`、`loader.js`、`docs/subserver-api.md`

## 工作流

- 路径：`core/*/stream/*.js`（`StreamLoader` 扫描，**不用** `aistream.streamDir`）。
- 配置：`data/server_bots/{port}/aistream.yaml`；schema 见 `commonconfig/system.js`。
- 工具：LLM tool calling + MCP；`registerMCPTool` 注册到 `this.mcpTools`。
- 子服务端优先复杂编排；不可用则 `LLMFactory.createClient().chat/chatStream`。
- 向量：`/api/vector/*` 由 Python 子服务端提供。
