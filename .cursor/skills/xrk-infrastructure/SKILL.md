---
name: xrk-infrastructure
description: 当需要理解或扩展基础设施层（加载器、基类、路径、错误处理）等底层开发时使用。
---

## 文档

- 分层与工具模块：`docs/底层架构设计.md`
- 扩展点总览：`docs/框架可扩展性指南.md`

## 基类与加载器

| 扩展点 | 基类 | 加载器 | 扫描目录 |
|--------|------|--------|----------|
| 插件 | `#infrastructure/plugins/plugin.js` | `plugins/loader.js` | `core/*/plugin/*.js` |
| HTTP | `#infrastructure/http/http.js` | `http/loader.js` | `core/*/http/*.js` |
| 工作流 | `#infrastructure/aistream/aistream.js` | `aistream/loader.js` | `core/*/stream/*.js` |
| Tasker | — | `tasker/loader.js` | `core/*/tasker/*.js` |
| 事件 | `#infrastructure/listener/base.js` | `listener/loader.js` | `core/*/events/*.js` |
| 配置 | `#infrastructure/commonconfig/commonconfig.js` | `commonconfig/loader.js` | `core/*/commonconfig/*.js` |
| 渲染器 | `#infrastructure/renderer/Renderer.js` | `renderer/loader.js` | `src/renderers/*` |

## `#` 别名

`#utils/*`、`#infrastructure/*`、`#factory/*`、`#config/*`、`#data/*`、`#core/*`、`#renderers/*`、`#modules/*`。业务用全局 `segment`，勿 `import` `#oicq`。

## 约定

- 业务只放 `core/`；改 `src/` 仅限基类/加载器/工具。
- 日志：`BotUtil.makeLog`；HTTP 响应：`HttpResponse`（`#utils/http-utils.js`）；错误：`#utils/error-handler.js`。
- `cfg.aistream` → `data/server_bots/{port}/aistream.yaml`（非 `server_bots` 根目录）。
