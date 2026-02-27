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

