---
name: xrk-project-overview
description: 当需要从整体理解 XRK-AGT 的架构、目录、运行流程和技术栈时使用。
---

## 权威文档

- 项目概览：`PROJECT_OVERVIEW.md`
- 文档导航：`docs/README.md`

## 架构要点

- **五层**：运行核心层（Bot）→ 基础设施层（加载器/基类）→ Tasker → 事件系统 → 业务层（插件/HTTP/工作流）。
- **目录约定**：`src/` 仅放基础设施与工厂；业务一律在 `core/<core名>/` 下，按子目录分为 `plugin/`、`http/`、`stream/`、`tasker/`、`events/`、`commonconfig/`、`www/<应用名>/`。
- **Node**：要求 Node ≥ 24.13，使用全局 URLPattern、Error.isError、原生 fetch、AbortController 等。

## 放码位置速查

- 业务 → `core/<core>/(plugin|http|stream)`；基类/工具 → `src/infrastructure/`、`src/utils/`；工厂 → `src/factory/*`；渲染 → `src/renderers/`；静态前端 → `core/<core>/www/<app-name>/`。

## 回答模式

- 问“某功能在哪层”：先按架构五层定位（Runtime → Infrastructure → Tasker/Events → Business），再给对应路径。
- 问“代码该放哪”：按上面放码位置速查给出具体目录，并提醒不要将业务写进 `src/`。

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
