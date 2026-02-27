---
name: xrk-project-overview
description: 当你需要在高层面理解 XRK-AGT 的整体架构、目录结构、运行流程和技术栈选型时使用。
---

## 权威文档

- `PROJECT_OVERVIEW.md`
- `docs/README.md`

## 你要掌握的要点

- 分层架构（运行核心层 / 基础设施层 / Tasker / 事件系统 / 业务层）及其责任边界。
- 目录结构：`src/` 只放基础设施和工厂；所有业务（插件/HTTP/工作流/Tasker/前端）都在 `core/*` 下。
- Node 版本与特性：要求 Node ≥ 24.13，广泛使用 fetch / URLPattern / Error.isError 等新特性。

## 常用回答模式

- 当用户不知道“某个功能大概在哪层”时，先用架构图定位：Runtime → Infrastructure → Tasker/Events → Business。
- 当用户问“这东西大概放哪写更合适”时：\n
  - 纯业务逻辑 → `core/<your-core>/(plugin|http|stream)`。\n
  - 通用基类/工具 → `src/infrastructure/` 或 `src/utils/`。\n
  - LLM/ASR/TTS 工厂 → `src/factory/*`。\n
  - 渲染相关 → `src/renderers/` + `resources/`。\n
  - 静态前端 → `core/<core>/www/<app-name>/`（通过 `/<app-name>/*` 暴露）。\n
