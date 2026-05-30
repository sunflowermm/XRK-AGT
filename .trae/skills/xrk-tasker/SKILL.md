---
name: xrk-tasker
description: 当你需要理解或编写新的 Tasker（OneBotv11/GSUIDCORE/QBQBot/stdin 等协议适配层）时使用。
---

## 文档与代码

`docs/tasker-loader.md`、`docs/tasker-base-spec.md`、`docs/事件系统标准化文档.md`、`core/system-Core/tasker/*.js`

## 职责

协议入站 → 统一事件 `e` → 事件监听器 / 插件。新协议：在 `core/<core>/tasker/` 实现 Tasker 接口。

## Node 26

- 消息二进制：`Buffer#toBase64()`，勿 `toString('base64')`（参考 `OneBotv11.js`、`QBQBot.js`）。
- 错误与网络：skill **`xrk-node-runtime`**。
