---
name: xrk-project-overview
description: 当需要从整体理解 XRK-AGT 的架构、目录、运行流程和技术栈时使用。
---

## 文档

- `PROJECT_OVERVIEW.md`、`docs/README.md`、`docs/底层架构设计.md`

## 要点

- 分层：Bot（Runtime）→ 基础设施（Loader/基类）→ Tasker / 事件 → Core 业务。
- 业务在 `core/<名>/(plugin|http|stream|tasker|events|commonconfig|www/<app>)`；`src/` 仅基础设施与工厂。
- Node ≥ 24.12（`package.json` engines）。

## 放码速查

| 类型 | 路径 |
|------|------|
| 业务 | `core/<core>/` 各子目录 |
| 基类/加载器 | `src/infrastructure/` |
| 工具 | `src/utils/` |
| 工厂 | `src/factory/` |
| 前端 | `core/<core>/www/<app>/` |
