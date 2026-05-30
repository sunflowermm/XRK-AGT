---
name: xrk-config
description: 当你需要新增/调整配置字段、确保 YAML 与 commonconfig schema 与代码消费一致、或解释配置路径规则时使用。
---

## 文档

`docs/config-base.md`、`core/system-Core/commonconfig/*.js`、`src/infrastructure/config/config-constants.js`

## 路径

| 类型 | 路径 | 示例 |
|------|------|------|
| 全局 | `data/server_bots/<name>.yaml` | `agt`、`redis`、`mongodb` |
| 随端口 | `data/server_bots/{port}/<name>.yaml` | `server`、`aistream`、`chatbot` |
| 工厂 LLM | `data/server_bots/{port}/<name>.yaml` | `openai_llm`、`*_compat_llm` |
| 模板 | `config/default_config/<name>.yaml` | 缺失时自动复制 |

## 改动须同步

1. `config/default_config/<name>.yaml`
2. `commonconfig/<name>.js` 或 `system.js` 内 schema
3. 消费该字段的代码
4. system-Core `.gitignore` 白名单（若新增 commonconfig 文件）

`aistream.yaml`：`embedding`、`mcp`、`agentWorkspace`、`tools` 等见 `docs/aistream.md`。
