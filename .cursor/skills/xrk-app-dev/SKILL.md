---
name: xrk-app-dev
description: 当你需要从“应用视角”看 XRK-AGT（启动流程、Web 控制台、前后端协作、典型技术栈组合）时使用。
---

## 权威文档

- `docs/app-dev.md`

## 你要掌握的要点

- 启动链路：`node app` → `app.js`（环境/依赖/imports）→ `start.js` → `src/bot.js`。
- Web 控制台：`core/system-Core/www/xrk/*`，通过 `/xrk` 访问，调用 `core/system-Core/http/*` 暴露的 API。
- cfg 配置体系：全局 `data/server_bots/*.yaml` + 端口 `data/server_bots/{port}/*.yaml`（含 **`aistream.yaml`**，走 `getServerConfig('aistream')`，不在根目录）。
- 典型技术栈：简单 AI 对话（插件+工作流）；复杂 Agent（插件+工作流+Python 子服务端）；Web 应用（前端+HTTP API+工作流）；数据可视化（工作流+渲染器）；多平台（Tasker+插件+事件系统）。

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
