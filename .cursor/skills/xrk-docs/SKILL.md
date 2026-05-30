---
name: xrk-docs
description: 需要快速定位「该看哪份文档/哪段代码/哪份配置」时使用；提供文档导航与权威路径。
---

## 导航

主索引：`docs/README.md`。分层边界：`docs/底层架构设计.md`。

| 主题 | 文档 |
|------|------|
| 扩展点 | `docs/框架可扩展性指南.md` |
| LLM / v3 | `docs/factory.md`、`core/system-Core/http/ai.js` |
| 工作流 | `docs/aistream.md`（扫描 `core/*/stream/*.js`） |
| system-Core | `docs/system-core.md` |
| HTTP | `docs/http-api.md`、`docs/http-business-layer.md` |
| 鉴权 | `docs/AUTH.md` |
| MCP | `docs/mcp-guide.md` |
| 配置 | `docs/config-base.md`、skill `xrk-config` |

## 回答规范

- 配置类：给出 YAML 路径 + 字段 + 最小示例。
- 行为类：给出代码文件 + 函数/类名。
- 文档与代码冲突：以代码为准。
