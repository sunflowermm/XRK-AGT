---
name: xrk-v3-api
description: 当你需要对接/调试 `/api/v3/chat/completions` 与 SSE 流式输出、multipart 多模态上传、workflow->streams 工具白名单时使用。
---

## 实现

`core/system-Core/http/ai.js`：`POST /api/v3/chat/completions`、`GET /api/v3/models`

## 约定

- 入参/出参兼容 OpenAI Chat Completions（含 SSE `[DONE]`）。
- `model` = provider key。
- `workflow.workflows` / `workflow.streams` → MCP 工具白名单。
- `multipart`：`messages` 为 JSON 字符串；`image/*` 转 base64 并入最后一条 user 消息。

## Node 26

- 实现位于 `core/system-Core/http/ai.js`：出站 LLM 用全局 `fetch` + `buildFetchOptionsWithProxy`。
- multipart 图片编码用 `toBase64()`，勿 `toString('base64')`；超时用 `AbortSignal.timeout`。
- 完整 API 表：skill **`xrk-node-runtime`**。

## 排障

401 → `docs/AUTH.md`；无 provider → 端口下 `aistream.yaml` / compat YAML；无工具 → `enableTools` 与 `streams` 白名单。
