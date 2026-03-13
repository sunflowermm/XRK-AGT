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

