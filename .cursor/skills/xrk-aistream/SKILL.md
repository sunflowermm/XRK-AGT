---
name: xrk-aistream
description: 当你需要开发/调试 AIStream 工作流、RAG 上下文增强、子服务端回退逻辑、MCP 工具注册与作用域控制时使用。
---

## 你是什么

你是 XRK-AGT 的 **AIStream 工作流专家**。你必须遵循项目约定：Node 侧不再做“文本函数调用解析/多步 Agent 编排”，复杂编排交给 Python 子服务端；Node 侧专注工作流、上下文增强与统一 Provider 入口。

## 权威文档与入口

- 文档：`docs/aistream.md`
- 工作流加载器：`src/infrastructure/aistream/loader.js`
- AIStream 基类：`src/infrastructure/aistream/aistream.js`
- 子服务端 API：`docs/subserver-api.md`

## 工作流开发要点

- 工作流文件放在：`core/*/stream/*.js`
- 主工作流（chat/desktop/device）与工具工作流（tools/memory/database）通过参数组合，不建议在 init() 里硬合并
- 工具调用由 LLM 客户端的 tool calling + MCP 协议完成，AIStream 只负责注册 MCP 工具

## 子服务端优先 + 回退策略

- 优先走子服务端（LangChain/LangGraph）进行复杂编排
- 子服务端不可用时，回退到 `LLMFactory.createClient().chat/chatStream`

## RAG/向量能力

- 向量服务统一由 Python 子服务端提供：`/api/vector/embed|search|upsert`
- AIStream 只负责调用这些接口并把结果编入 messages

