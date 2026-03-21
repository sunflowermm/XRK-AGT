---
name: xrk-system-core
description: 当你需要快速理解 system-Core 提供哪些 HTTP API/工作流/插件/Tasker/Web 控制台能力，或定位某个模块在哪实现时使用。
---

## 权威文档

- `docs/system-core.md`

## system-Core 的关键目录

- HTTP：`core/system-Core/http/*.js`
- Stream：`core/system-Core/stream/*.js`
- Plugin：`core/system-Core/plugin/*.js`
- Tasker：`core/system-Core/tasker/*.js`
- CommonConfig（前端表单 Schema）：`core/system-Core/commonconfig/*.js`
- Web UI：`core/system-Core/www/xrk/*`

## 常用定位

- v3 Chat Completions：`core/system-Core/http/ai.js`
- 配置管理 API：`core/system-Core/http/config.js`
- MCP API：`core/system-Core/http/mcp.js`
- 控制台入口：`core/system-Core/www/xrk/`

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
