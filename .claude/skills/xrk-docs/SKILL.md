---
name: xrk-docs
description: 当你需要快速定位“应该看哪份文档/哪段代码/哪份配置”时使用；提供 XRK-AGT 文档导航与权威来源路径。
---

## 目标

把 XRK-AGT 的文档体系变成可执行的“导航地图”：当用户问“这块在哪配/在哪改/怎么接入”时，快速给出**最短路径**（配置文件、代码文件、对应文档）。

## 权威入口（优先级从高到低）

1. **文档导航**：`docs/README.md`
2. **工厂与 LLM**：`docs/factory.md`
3. **工作流（AIStream）**：`docs/aistream.md`
4. **system-Core 能力总览**：`docs/system-core.md`
5. **HTTP API 基类/业务层约定**：`docs/http-api.md`、`docs/http-business-layer.md`
6. **鉴权与认证**：`docs/AUTH.md`
7. **MCP 工具**：`docs/mcp-guide.md`、`docs/mcp-config-guide.md`

## 常见问题 → 直接跳转路径

- **v3 OpenAI 兼容入口在哪**：`core/system-Core/http/ai.js`
- **LLM 运营商选择在哪**：`data/server_bots/aistream.yaml`（字段：`llm.Provider`）
- **某家 LLM 的详细配置在哪**：`data/server_bots/{port}/*_llm.yaml` 或 `data/server_bots/{port}/*_compat_llm.yaml`
- **前端表单字段来源（Schema）在哪**：`core/system-Core/commonconfig/*.js`
- **为什么业务路由里没鉴权**：鉴权在 `src/bot.js` 的 `_authMiddleware`；解释见 `docs/AUTH.md`

## 回答规范

- 只要涉及“怎么配置”，必须给出：**配置文件路径 + 关键字段名 + 示例最小片段**（不要泛泛而谈）。
- 只要涉及“为什么行为这样”，必须给出：**代码入口文件路径 + 函数/类名**。
- 遇到“文档与代码冲突”，以**代码为准**，并标注需要修订的文档文件。

