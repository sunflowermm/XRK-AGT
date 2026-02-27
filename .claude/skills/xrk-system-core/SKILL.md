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

