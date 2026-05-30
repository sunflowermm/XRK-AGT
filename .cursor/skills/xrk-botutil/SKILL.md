---
name: xrk-botutil
description: 当你需要复用日志/缓存/文件/网络/批处理等基础能力，或为新模块选择合适的工具函数时使用。
---

## 文档与代码

`docs/botutil.md`、`src/utils/botutil.js`

## 要点

- 日志 `makeLog`、缓存 `getMap`/`cache`、文件与网络封装；优先用 BotUtil 而非裸 `fs`/`fetch`。
- `Bot.*` 代理部分静态方法（`Bot.makeLog`、`Bot.exec` 等）。
- 用户桌面路径：`src/utils/user-dirs.js`（勿写死 `~/Desktop`）。
