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
