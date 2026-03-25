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

- 工作流文件放在：`core/*/stream/*.js`；**`StreamLoader` 用 `paths.getCoreSubDirs('stream')` 扫描，不读取 `aistream.streamDir`**（该键仅为 Schema/备注）。
- 典型 system-Core 流：`chat`、`desktop`、`tools`、`memory`、`database`、`web`（`web_fetch`）、`browser`（Playwright，见 `stream/browser.js` + `lib/agent-browser/`）。
- **`aistream.yaml`（运行时 `data/server_bots/{port}/aistream.yaml`）**：除 `llm`/`mcp`/`subserver` 外，关注 **`embedding`**（全局合并到各流）、**`tools.file` / `tools.web.fetch`**、**`agentWorkspace`**；`desktop` 工作流 MCP 无单独 `tools.desktop` 段。模板与 **`core/system-Core/commonconfig/system.js`** 中 `aistream.schema` 对齐。
- 工具调用由 LLM 的 tool calling + MCP 完成；AIStream 侧 `registerMCPTool` 注册到 `this.mcpTools`。

## 子服务端优先 + 回退策略

- 优先走子服务端（LangChain/LangGraph）进行复杂编排
- 子服务端不可用时，回退到 `LLMFactory.createClient().chat/chatStream`

## RAG/向量能力

- 向量服务统一由 Python 子服务端提供：`/api/vector/embed|search|upsert`
- AIStream 只负责调用这些接口并把结果编入 messages

## 权威入口

- 项目概览：`PROJECT_OVERVIEW.md`
- 代码入口：`src/` 与 `core/` 对应子目录
- 相关文档：`docs/` 下对应主题文档

## 适用场景

- 需要定位该子系统的实现路径与配置入口。
- 需要快速给出改动落点与兼容性注意事项。

## 非适用场景

- 不用于替代其他子系统的实现说明。
- 不在缺少证据时臆造路径或字段。

## 执行步骤

1. 先确认需求属于该技能的职责边界。
2. 再给出代码路径、配置路径与关键字段。
3. 最后补充风险点、验证步骤与回归范围。

## 常见陷阱

- 误以为 `streamDir` 控制加载路径（实际始终扫描 `core/*/stream`）。
- 只给概念，不给具体文件路径。
- 文档与代码冲突时未标注以代码为准。
- 忽略 `default_config` YAML、`system.js` schema、消费代码 三者一致。
