---
name: xrk-subserver
description: 当你需要理解或修改子服务端插件、与主服 HTTP/CommonConfig/QQ 插件融合时使用。
---

## 文档（按场景）

| 场景 | 文档 |
|------|------|
| **新建/改子服插件** | `docs/subserver-plugin-development.md` |
| CommonConfig 代理 | `docs/subserver-commonconfig.md` |
| HTTP 契约 | `subserver/CONTRACT.md` · `docs/subserver-api.md` |
| Python 实现 | `subserver/pyserver/README.md` |

## 主服衔接

| 能力 | 入口 |
|------|------|
| 调子服 API | `Bot.callSubserver` · `#utils/subserver-client.js` |
| 子服地址 | `cfg.subserver`（`aistream.yaml`） |
| 控制台业务配置 | `ConfigLoader.registerFromSubserver()` → **pyserver + `plugin_config`** |
| QQ 插件 | `subserver/<runtime>/apis/<group>/core/plugin/*.js`（主服 Loader 扫描） |

**不要**在 main `core/*/commonconfig/` 为子服业务写 schema；用子服 `config_schema.yaml`。

## 参考示例

- HTTP + CommonConfig：`subserver/pyserver/apis/media-tools/`
- 完整（QQ + 业务）：`subserver/pyserver/apis/jmcomic/`

## 调用示例

```javascript
await Bot.callSubserver('/api/media-tools/resize', {
  method: 'POST',
  body: { path: 'data/foo.png', width: 800 }
});

import ConfigLoader from '#infrastructure/commonconfig/loader.js';
const cfg = await ConfigLoader.get('media-tools')?.read();
```

Node 26：`fetch` + `AbortSignal.timeout`（skill **`xrk-node-runtime`**）。
