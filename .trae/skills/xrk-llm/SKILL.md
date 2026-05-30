---
name: xrk-llm
description: 当你需要配置/新增/排查 LLM 提供商（OpenAI/Azure/Gemini/Anthropic/Ollama/各类兼容网关）时使用；确保 YAML/Schema/代码一致。
---

## 入口

`docs/factory.md`、`src/factory/llm/LLMFactory.js`、`core/system-Core/http/ai.js`

## 约定

- v3 请求 `model` = **provider key**；真实模型在 YAML 的 `model`/`chatModel`（Azure 用 `deployment`）。
- 配置：`data/server_bots/{port}/<provider>_llm.yaml` 或 `*_compat_llm.yaml`（`providers[].key`）。
- Schema：`core/system-Core/commonconfig/*.js` 与 YAML 字段一致。
- **HTTP**：LLM 客户端使用**全局 `fetch`** + `buildFetchOptionsWithProxy`（`#utils/llm/proxy-utils.js`）。**禁止** `node-fetch`、`https-proxy-agent`。
- 超时：`AbortSignal.timeout`；完整清单见 skill **`xrk-node-runtime`**。

## 排障顺序

1. provider 是否在 `LLMFactory.listProviders()` / `GET /api/v3/models`
2. `model` 是否为 provider key
3. `baseUrl` + `path` 拼接与 `authMode`
4. `enableStream`、`enableTools` 与 `workflow.streams` 白名单
