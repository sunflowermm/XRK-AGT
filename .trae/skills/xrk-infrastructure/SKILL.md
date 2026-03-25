---
name: xrk-infrastructure
description: 当需要理解或扩展基础设施层（加载器、基类、路径、错误处理）等底层开发时使用。
---

## 权威文档与入口

- 可扩展性总览：`docs/框架可扩展性指南.md`
- 基类与加载器：见下方「基类与加载器一览」；各基类文档在 `docs/` 对应同名 md。

## 基类与加载器一览

| 扩展点 | 基类路径 | 加载器路径 | 扫描目录 |
|--------|----------|------------|----------|
| 插件 | `#infrastructure/plugins/plugin.js` | `#infrastructure/plugins/loader.js` | `core/*/plugin/*.js` |
| HTTP API | `#infrastructure/http/http.js` | `#infrastructure/http/loader.js` | `core/*/http/*.js` |
| 工作流 | `#infrastructure/aistream/aistream.js` | `#infrastructure/aistream/loader.js` | `core/*/stream/*.js` |
| Tasker | - | `#infrastructure/tasker/loader.js` | `core/*/tasker/*.js` |
| 事件监听器 | `#infrastructure/listener/base.js` | `#infrastructure/listener/loader.js` | `core/*/events/*.js` |
| 配置 | `#infrastructure/commonconfig/commonconfig.js` | `#infrastructure/commonconfig/loader.js` | `core/*/commonconfig/*.js` |
| 渲染器 | `#infrastructure/renderer/Renderer.js` | `#infrastructure/renderer/loader.js` | `src/renderers/*` + 配置 |

## 路径与 # 别名（package.json imports）

- `#utils/*` → `src/utils/*`
- `#infrastructure/*` → `src/infrastructure/*`
- `#factory/*` → `src/factory/*`
- `#config/*` → `config/*`
- `#data/*` → `data/*`
- `#core/*` → `core/*`
- `#renderers/*` → `src/renderers/*`
- `#modules/*` → `src/modules/*`
- `#oicq` → `src/modules/oicq/index.js`（业务层用全局 `segment`，无需从此导入）

根路径与 core 目录解析：`#utils/paths.js`（getCoreDirs、root 等）。

- **注意**：`cfg.aistream` 对应 **`data/server_bots/{port}/aistream.yaml`**（`getServerConfig`），不在 `server_bots` 根目录；与 `docs/app-dev.md`、`docs/aistream.md` 一致。

## 错误处理标准化

- 入口：`#utils/error-handler.js`
- 使用 `errorHandler.handle(error, options)` 统一记录与分类；HTTP 层用 `HttpResponse.error()`，内部会调 error-handler。
- 错误码：`ErrorCodes`（WORKFLOW_*、PLUGIN_*、INPUT_VALIDATION_FAILED、SYSTEM_ERROR、NOT_FOUND、CONFIG_* 等）；自定义错误可用 `BotError`。

## 底层开发约定

- **src/ 只放基础设施与工厂**：不写业务逻辑；新增能力优先在 core 内扩展，必须扩展底层时再改 src（如新基类、新加载器）。
- **保持接口稳定**：基类与加载器的对外 API（如 `routes`、`deal(e)`、`process(e, msg)`）变更需与文档和现有 core 兼容。
- **日志与工具**：底层统一用 `BotUtil.makeLog` / `#utils/botutil.js`，错误用 error-handler，不直接 console 打业务日志。

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
