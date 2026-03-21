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
