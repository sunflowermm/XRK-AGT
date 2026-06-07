---
name: xrk-llm
description: 当你需要配置/新增/排查 LLM 提供商（OpenAI/Azure/Gemini/Anthropic/Ollama/各类兼容网关）时使用；确保 YAML/Schema/代码一致。
---

## 入口

`docs/factory.md`、`src/factory/llm/LLMFactory.js`、`core/system-Core/http/ai.js`

## 约定

- v3 请求 `model` = **provider key**；真实模型在 `providers[].model`（Azure 用 `deployment`）。
- 配置：各工厂 YAML 默认仅 `providers: []`；字段定义在 `core/system-Core/commonconfig/shared/llm-provider-fields.js` 的 `LLM_PROVIDER_PRESETS`。
- 同一 `baseUrl` 可配置多个 `providers[]` 条目（不同 `key` + `model`）。
- `aistream.yaml` 的 `llm.Provider` 填写 `providers[].key`。
- **兼容工厂**（`*_compat`）采用最大字段集：`OPENAI_CHAT_COMPAT` = 官方 Chat 字段 + 认证 + `stripToolTraces`；勿再精简子集。
- 字段与官方 API 对齐见下表；映射实现在各 Client 与 `openai-chat-utils.js`。
- **HTTP**：LLM 客户端使用**全局 `fetch`** + `buildFetchOptionsWithProxy`（`#utils/llm/proxy-utils.js`）。**禁止** `node-fetch`、`https-proxy-agent`。
- 超时：`AbortSignal.timeout`；完整清单见 skill **`xrk-node-runtime`**。

## 各工厂字段审计要点（2026-06）

| 工厂 | 官方文档要点 | Schema / Client |
|------|-------------|-----------------|
| **openai** | Chat Completions：`max_completion_tokens`、`reasoning_effort`、`prompt_cache_*`、`service_tier` | `OPENAI_CHAT_BUILTIN`；`openai-chat-utils` 映射 |
| **openai_compat** | 同上 + 多认证 + 网关 tool 历史兼容 | `OPENAI_CHAT_COMPAT` + `stripToolTraces` |
| **openai_responses_compat** | Responses API：`max_output_tokens`、`instructions`、`max_tool_calls` | 用 `maxOutputTokens`，非 `maxTokens` |
| **anthropic** / **anthropic_compat** | `max_tokens` 必填；`stop` → `stop_sequences`；`service_tier`: auto/standard_only（**非** OpenAI 枚举）；认证默认 `x-api-key`；Opus 4.7+ 非默认 `temperature/top_p/top_k` 会 400 | preset 含 `anthropicServiceTier`；Client 映射 `service_tier` + 多认证 |
| **gemini** / **gemini_compat** | Gemini 3 建议默认 temperature；thinking 用 `thinkingLevel`（`extraBody`） | 采样字段保留；无 MCP 工具字段 |
| **azure_openai** / **azure_openai_compat** | `deployment` + `api-version`；Chat 字段同 OpenAI | compat 对齐 builtin + `AUTH_FIELDS` + penalties + `stripToolTraces` |
| **volcengine** | OpenAI-like + `thinking.type`: enabled/disabled/**auto**；另有 `reasoning_effort` | preset 含 `reasoningEffort`；thinking enum 含 `auto` |
| **deepseek** | OpenAI-like + `thinking.type` enabled/disabled；`reasoning_effort` 仅 high/max；`user_id`；思考模式下采样参数无效；工具轮次需 `reasoning_content` | preset 固定 `tokenField=max_tokens`；Client 剥离思考模式无效采样字段 |
| **xiaomimimo** | `max_completion_tokens`；`thinking.type` 仅 enabled/disabled | preset 固定 `tokenField`；thinking 无 `auto` |
| **ollama_compat** | 参数在 `options`：`num_predict`、`top_p`、`stop`、`repeat_penalty` | Client 映射 stop / frequencyPenalty→repeat_penalty |
| **newapi_compat** / **cherryin_compat** | OpenAI-like 聚合网关 | 与 `openai_compat` 同字段集 `OPENAI_CHAT_COMPAT` |

## 排障顺序

1. provider 是否在 `LLMFactory.listProviders()` / `GET /api/v3/models`
2. `model` 是否为 provider key
3. `baseUrl` + `path` 拼接与 `authMode`
4. `enableStream`、`enableTools` 与 `workflow.streams` 白名单
5. 兼容网关 400：尝试 `stripToolTraces: true`
