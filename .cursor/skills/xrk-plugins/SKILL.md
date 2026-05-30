---
name: xrk-plugins
description: 当你需要理解/开发插件（plugin 基类）、插件加载与规则匹配、上下文和冷却机制时使用。
---

## 文档与代码

- `docs/plugin-base.md`、`docs/plugins-loader.md`、`docs/事件系统标准化文档.md`
- `src/infrastructure/plugins/plugin.js`、`plugins/loader.js`
- 示例：`core/system-Core/plugin/*.js`

## 约定

- 路径：`core/*/plugin/*.js`；入口 `PluginsLoader.deal(e)`。
- 全局 `segment`，勿 `import` `#oicq`；`extends plugin`，勿 `import plugin`。
- constructor 不建缓存/Map；`rule[].fnc(e)` 用 `e.msg`。
- 调 AI：`this.getStream('chat'|...)` + `stream.process(e, e.msg, options)`。
