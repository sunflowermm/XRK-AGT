---
name: xrk-aistream
description: 当你需要开发/调试 AiWorkflow 工作流、RAG 上下文增强、MCP 工具注册与作用域控制时使用。
---

## 文档与代码

`docs/aistream.md`、`src/infrastructure/ai-workflow/ai-workflow.js`、`loader.js`

## 工作流

- 路径：`core/*/stream/*.js`（`AiStreamLoader` 扫描，**不用** `aistream.streamDir`）
- 配置：`data/server_bots/{port}/aistream.yaml`；schema 见 `commonconfig/system.js`
- 工具：LLM tool calling + MCP；`registerMCPTool` 注册到 `this.mcpTools`
- **LLM 调用**：统一 `LLMFactory.createClient().chat/chatStream`（**不**经 Python 子服务端）
- **上下文/RAG**：`MemoryManager` + 知识库工作流（如 `database` 关键词检索）
- Shell/系统命令：`#utils/exec-async.js`；禁止 `promisify(exec)`（skill **`xrk-node-runtime`**）

## 与子服务端关系

子服务端为**可选** Python 扩展；AiWorkflow 核心链路不依赖子服务。业务 Core 可通过 `AgentRuntime.callSubserver` 调用子服务 `apis/` 接口。
