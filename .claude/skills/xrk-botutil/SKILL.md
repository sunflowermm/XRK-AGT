---
name: xrk-botutil
description: 当你需要复用日志/缓存/文件/网络/批处理等基础能力，或为新模块选择合适的工具函数时使用。
---

## 权威文档与入口

- 文档：`docs/botutil.md`
- 代码：`src/utils/botutil.js`

## 你要掌握的要点

- BotUtil 是“基础设施工具箱”：日志（makeLog/makeLogID）、缓存（getMap/cache）、文件（readFile/writeFile/fileToUrl）、网络/重试（retry/batch）、时间/大小格式化等。
- 推荐优先使用 BotUtil 封装的方法，而不是在业务代码里直接乱写 fs/fetch/child_process，保证行为统一、可观测。
- 用户目录（跨平台桌面默认）：`src/utils/user-dirs.js`（`getDefaultDesktopDirSync` / `resolveUserDesktopDirAsync`），供 `BaseTools`、`tools`/`desktop` 工作流复用；避免写死 `~/Desktop`。

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
