---
name: xrk-v3-api
description: 当你需要对接/调试 `/api/v3/chat/completions` 与 SSE 流式输出、multipart 多模态上传、workflow->streams 工具白名单时使用。
---

## 你是什么

你是 XRK-AGT 的 **v3 OpenAI 兼容 API 专家**：确保对外行为“看起来就是 OpenAI Chat Completions”，同时内部正确路由到各 LLM 工厂。

## 权威实现

- `core/system-Core/http/ai.js`
  - `POST /api/v3/chat/completions`
  - `GET /api/v3/models`
  - `GET /api/ai/models`

## 兼容性原则

1. **入参兼容 OpenAI Chat Completions**：`model/messages/stream/tools/tool_choice/parallel_tool_calls/temperature/max_tokens/top_p/...`
2. **出参返回 OpenAI 风格**：
   - 非流式：`object=chat.completion`、`choices[0].message.content`
   - 流式：SSE `object=chat.completion.chunk`、`choices[0].delta.content`、最后 `[DONE]`
3. **v3 的 model 语义**：对外 `model=providerKey`（路由标识），真实模型由 YAML 内部配置决定。

## workflow → streams（工具白名单）

若请求体提供：

```json
{
  "workflow": {
    "workflows": ["chat", "desktop"],
    "streams": ["memory"]
  }
}
```

则后端会整理成 `streams` 数组透传给 LLM 客户端与 MCP 工具适配器，用于**只注入这些工作流的 MCP 工具**。

## multipart/form-data 多模态

v3 支持 `multipart/form-data`：

- `messages` 字段：JSON 字符串（数组）
- 文件字段：上传 `image/*` 会被转为 `data:<mime>;base64,...` 并追加到最后一条 user 消息中

## 常见错误定位

- 401：先看 `docs/AUTH.md`（system-Core HTTP 在模块内调用 `Bot.checkApiAuthorization(req)` 做系统级鉴权）
- provider 不存在：检查 `aistream.yaml.llm.Provider` 或 compat providers[].key
- stream 被禁用：provider 配置 `enableStream: false`
- 工具不生效：检查 `enableTools`、`workflow->streams`、是否存在 MCP 工具

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

- 只给概念，不给具体文件路径。
- 文档与代码冲突时未标注以代码为准。
- 忽略配置、Schema 与消费代码的一致性。
