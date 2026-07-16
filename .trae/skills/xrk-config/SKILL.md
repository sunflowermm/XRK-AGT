---
name: xrk-config
description: 当你需要新增/调整配置字段、确保 YAML 与 commonconfig schema 与代码消费一致、或解释配置路径规则时使用。
---

## 文档

`docs/config-base.md`、`core/system-Core/commonconfig/*.js`、`src/infrastructure/config/config-constants.js`

## 路径

| 类型 | 路径 | 示例 |
|------|------|------|
| 全局 | `data/server_bots/<name>.yaml` | `agt`、`redis` |
| 随端口 | `data/server_bots/{port}/<name>.yaml` | `server`、`ai-workflow`、`chatbot` |
| 工厂 LLM | `data/server_bots/{port}/<name>.yaml` | `openai_llm`、`*_compat_llm` |
| **底层模板** | `config/default_config/<name>.yaml` | 仅 AGT/工厂/system-Core；**禁止**产品 Core |
| **产品 Core 模板** | `core/<core名>/default/<name>.yaml` | `core/lsy-Core/default/lsy.yaml` |
| **产品运行时** | `data/<产品>/` | `data/lsy/lsy.yaml` |

## 改动须同步

**system-Core / 工厂 / 全局服务**

1. `config/default_config/<name>.yaml`
2. `core/system-Core/commonconfig/<name>.js` 或 `system.js` 内 schema
3. 消费该字段的代码

**独立产品 Core**（如 `lsy-Core`）

1. `core/<core名>/default/<name>.yaml`
2. `core/<core名>/commonconfig/<name>.js` schema；`read()` 从 Core 内 `default/` 复制，**不要**在 `config/default_config/` 加同名文件
3. 消费该字段的代码（均在 `core/<core名>/` 内）

4. system-Core `.gitignore` 白名单（若新增 **system-Core** commonconfig 文件）

**勿混淆**：`core/<core>/AGENTS.md` 给**产品 Agent**（工作区/工具），不含 LLM 工厂与 `default_config` 约定；上述路径与模板规则仅写在 **本 skill / `xrk-project` / `core/<core>/README.md`**。

`ai-workflow.yaml`：`embedding`、`mcp`、`agentWorkspace`、`tools` 等见 `docs/ai-workflow.md`。

## Node 26

- 消费配置的 Core 代码须遵守 skill **`xrk-node-runtime`**（fetch/exec/判错/二进制）。
- 新增 YAML 字段时，若涉及 HTTP 超时或 shell，文档与示例勿写 `node-fetch`、`promisify(exec)`。
