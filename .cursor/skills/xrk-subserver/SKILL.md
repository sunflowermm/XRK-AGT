---
name: xrk-subserver
description: 子服插件开发；配置全在主服 CommonConfig，子服只读 data/；Bot.callSubserver 用 cfg.subserver。
---

## 配置（必读）

**[docs/subserver-commonconfig.md](../../docs/subserver-commonconfig.md)**

| 类型 | 主服编辑 | 子服 |
|------|----------|------|
| 子服 host/port | AIStream → 子服务端（`cfg.subserver`） | 被连接 |
| 业务插件 | `apis/<group>/core/commonconfig/*.js` | `load_plugin_config` 只读 yaml |

## 插件结构

```
apis/<group>/
  service.*
  default_config.yaml
  core/commonconfig/<group>.js
  core/plugin/*.js
```

## 文档

- [subserver-plugin-development.md](../../docs/subserver-plugin-development.md)
- [subserver/CONTRACT.md](../../subserver/CONTRACT.md)

参考：`subserver/pyserver/apis/jmcomic/`、`media-tools/`。
