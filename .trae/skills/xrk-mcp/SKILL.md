---
name: xrk-mcp
description: 当你需要理解或扩展 MCP 工具（Model Context Protocol）、工具注册/分组/远程 MCP 连接与 LLM tool calling 的关系时使用。
---

## 文档与代码

`docs/mcp-guide.md`、`docs/mcp-config-guide.md`、`core/system-Core/http/mcp.js`、`commonconfig/system.js`（`aistream.mcp`）

## 要点

- 工作流内 `registerMCPTool` → `MCPToolAdapter` → OpenAI tools。
- v3 / LangChain 的 tool calling 最终执行 MCP 工具。
- 远程 MCP：`aistream.mcp.remote`（stdio/HTTP/SSE 等）。

## Node 26

- MCP HTTP/远程连接走全局 `fetch` + `AbortSignal.timeout`；代理见 `proxy-utils.js`。
- 工具 handler 判错用 `Error.isError` / `normalizeError`（skill **`xrk-node-runtime`**）。
