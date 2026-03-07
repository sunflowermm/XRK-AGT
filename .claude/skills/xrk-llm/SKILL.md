---
name: xrk-llm
description: 当你需要配置/新增/排查 LLM 提供商（OpenAI/Azure/Gemini/Anthropic/Ollama/各类兼容网关）时使用；确保 YAML/Schema/代码一致。
---

## 你是什么

你是 XRK-AGT 的 **LLM 工厂与多运营商配置专家**。你必须以“配置驱动”为第一原则：**不建议硬编码**，优先调整 `*_llm.yaml` 与 `*_compat_llm.yaml`，并确保 `commonconfig` schema 字段与客户端实现一致。

## 关键入口

- 工厂：`src/factory/llm/LLMFactory.js`
- OpenAI Chat 协议工具：`src/utils/llm/openai-chat-utils.js`
- v3 网关：`core/system-Core/http/ai.js`（`POST /api/v3/chat/completions`）

## Provider 选择规则（对外约定）

- v3 请求体里的 `model`：**填 provider key**（例如 `openai`、`azure_openai`、`ollama-local`）。
- 真实模型名：写在 provider 配置 YAML 的 `model/chatModel`（或 Azure 的 `deployment`）。

## 配置文件地图

### 官方 provider（单一配置文件）

- OpenAI：`data/server_bots/{port}/openai_llm.yaml`
- Azure OpenAI：`data/server_bots/{port}/azure_openai_llm.yaml`
- Gemini：`data/server_bots/{port}/gemini_llm.yaml`
- （若启用）Anthropic：`data/server_bots/{port}/anthropic_llm.yaml`

### 兼容 provider（providers[] 多运营商聚合）

- OpenAI Chat：`data/server_bots/{port}/openai_compat_llm.yaml`
- OpenAI Responses：`data/server_bots/{port}/openai_responses_compat_llm.yaml`
- New API：`data/server_bots/{port}/newapi_compat_llm.yaml`
- CherryIN：`data/server_bots/{port}/cherryin_compat_llm.yaml`
- Ollama：`data/server_bots/{port}/ollama_compat_llm.yaml`
- Gemini：`data/server_bots/{port}/gemini_compat_llm.yaml`
- Anthropic：`data/server_bots/{port}/anthropic_compat_llm.yaml`
- Azure OpenAI：`data/server_bots/{port}/azure_openai_compat_llm.yaml`

## Schema（前端表单字段来源）

对应文件：`core/system-Core/commonconfig/*.js`  
原则：**YAML 字段必须能在 schema 里找到；schema 提供的字段必须被代码消费。**

## 排障清单（必须按顺序）

1. **provider key 是否存在**：`LLMFactory.listProviders()` / `GET /api/v3/models`
2. **v3 的 model 是否填对**：应该是 provider key，不是真实模型名
3. **端点拼接是否正确**：`baseUrl + path`（或 Azure `deployment + api-version`、Ollama `/api/chat`、Gemini `:generateContent`）  
   - OpenAI/兼容 Chat 协议：**默认约定 `baseUrl` 已包含版本前缀（如 `/v1`），`path` 只写资源路径（如 `/chat/completions`、`/responses`）**
4. **认证方式是否匹配**：
   - OpenAI 官方：`Authorization: Bearer`
   - Azure：`api-key`
   - Anthropic：`x-api-key` + `anthropic-version`
   - Gemini：query `key=...`
   - 兼容网关：用 `authMode`（bearer/api-key/header）配置
5. **流式开关**：provider 配置 `enableStream` 是否禁用
6. **工具注入（MCP）**：`enableTools` + `streams` 白名单（由请求体 workflow 整理出来）

## 文档来源（需要时引用）

- `docs/factory.md`
- `docs/aistream.md`（streams 白名单、MCP 注入与子服务端关系）
- `core/system-Core/http/ai.js`（v3 行为权威实现）

