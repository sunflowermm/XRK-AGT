---
name: xrk-config
description: 当你需要新增/调整配置字段、确保 YAML 与 commonconfig schema 与代码消费一致、或解释配置路径规则时使用。
---

## 权威文档与实现

- 配置基类文档：`docs/config-base.md`
- SystemConfig：`core/system-Core/commonconfig/system.js`
- 各配置 schema：`core/system-Core/commonconfig/*.js`

## 配置路径规则（核心）

权威常量：`src/infrastructure/config/config-constants.js`

| 分类 | 存储路径 | 配置名（示例） |
|------|----------|----------------|
| 全局 | `data/server_bots/<name>.yaml` | `agt`、`device`、`monitor`、`notice`、`mongodb`、`redis` |
| 随端口 | `data/server_bots/{port}/<name>.yaml` | `server`、`chatbot`、`group`、`aistream` |
| 工厂 LLM | `data/server_bots/{port}/<name>.yaml` | `openai_llm`、`volcengine_llm`、`gemini_compat_llm` 等（见 `FACTORY_CONFIG_PATTERNS`） |

- 默认模板：`config/default_config/<name>.yaml`（`Cfg` 在缺失时自动复制到目标路径）
- **Schema 来源**：
  - 独立文件：`core/system-Core/commonconfig/<name>.js`（与 YAML 同名，如 `openai_llm.js`）
  - 聚合在 `system.js`：`agt`、`server`、`chatbot`、`device`、`group`、`notice`、`redis`、`mongodb`、`monitor`、`aistream` 等（无单独 commonconfig 文件）
  - 仅代码侧：`tools.js`（无对应 default YAML）

## 变更清单（做配置相关改动必须检查）

1. `config/default_config/<name>.yaml`：默认模板字段是否完整
2. `core/system-Core/commonconfig/<name>.js`：schema 字段是否 1:1 对应，并有合理默认值/枚举
3. 客户端/工厂代码是否真正消费这些字段（避免“写了 schema 但没用”）
4. 若 system-Core 的 `.gitignore` 做了白名单：新增 commonconfig 文件要加入白名单

### aistream 专项

- 运行时：`data/server_bots/{port}/aistream.yaml`（`cfg.aistream`）；模板：`config/default_config/aistream.yaml`。
- 常见段落：`embedding`、`mcp`、`agentWorkspace`、`tools`（`file`→ToolsStream、`web.fetch`→WebStream、`agentBrowser`→BrowserStream）；desktop 工作流工具在 `desktop.js` 内实现，无 `tools.desktop` YAML。

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
