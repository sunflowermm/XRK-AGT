---
name: xrk-docs
description: 需要快速定位「该看哪份文档/哪段代码/哪份配置」时使用；提供文档导航与权威路径。
---

## 目标

把 XRK-AGT 的文档体系当作可执行的导航：用户问「这块在哪配/在哪改/怎么接入」时，直接给出**最短路径**（配置路径、代码文件、对应文档）。

## 权威入口（按优先级）

1. 文档导航：`docs/README.md`
2. 工厂与 LLM：`docs/factory.md`
3. 工作流（AIStream）：`docs/aistream.md`
4. system-Core 能力：`docs/system-core.md`
5. HTTP API 与业务层：`docs/http-api.md`、`docs/http-business-layer.md`
6. 鉴权：`docs/AUTH.md`
7. MCP：`docs/mcp-guide.md`、`docs/mcp-config-guide.md`
8. 可扩展性（7 大扩展点、Core 开发）：`docs/框架可扩展性指南.md`

## 常见问题 → 跳转路径

- v3 OpenAI 兼容入口：`core/system-Core/http/ai.js`
- LLM 运营商选择：`data/server_bots/{port}/aistream.yaml` 字段 `llm.Provider`（随端口；模板见 `config/default_config/aistream.yaml`）
- 工作流发现：固定扫描 `core/*/stream/*.js`，与 `aistream.streamDir` 无关（见 `docs/aistream.md`）
- 某家 LLM 配置：`data/server_bots/{port}/*_llm.yaml` 或 `*_compat_llm.yaml`
- 前端表单 Schema：`core/system-Core/commonconfig/*.js`
- 鉴权职责：见 `docs/AUTH.md`（Server 层只做基础放行，system-Core HTTP 在模块内使用 `Bot.checkApiAuthorization(req)` 做系统级鉴权，其他 Core 可自行决定是否接入）。
- HTTP 统一响应：`src/utils/http-utils.js`（`HttpResponse`）。错误处理：`src/utils/error-handler.js`（`ErrorCodes`、`BotError`）。
- 基础设施层（加载器/基类/路径/错误）：skill `xrk-infrastructure`、`docs/框架可扩展性指南.md`。

## 回答规范

- 涉及「怎么配置」：必须给出**配置文件路径 + 关键字段 + 最小示例片段**。
- 涉及「为什么这样行为」：必须给出**代码入口路径 + 函数/类名**。
- 文档与代码不一致时：以**代码为准**，并注明需修订的文档路径。

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
