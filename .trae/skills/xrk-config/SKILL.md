---
name: xrk-config
description: 当你需要新增/调整配置字段、确保 YAML 与 commonconfig schema 与代码消费一致、或解释配置路径规则时使用。
---

## 权威文档与实现

- 配置基类文档：`docs/config-base.md`
- SystemConfig：`core/system-Core/commonconfig/system.js`
- 各配置 schema：`core/system-Core/commonconfig/*.js`

## 配置路径规则（核心）

- 全局配置：`data/server_bots/<name>.yaml`
- 随端口配置：`data/server_bots/{port}/<name>.yaml`
- 工厂/LLM 配置也属于随端口配置（例如 `openai_llm.yaml`、`openai_compat_llm.yaml` 等）

## 变更清单（做配置相关改动必须检查）

1. `config/default_config/<name>.yaml`：默认模板字段是否完整
2. `core/system-Core/commonconfig/<name>.js`：schema 字段是否 1:1 对应，并有合理默认值/枚举
3. 客户端/工厂代码是否真正消费这些字段（避免“写了 schema 但没用”）
4. 若 system-Core 的 `.gitignore` 做了白名单：新增 commonconfig 文件要加入白名单

