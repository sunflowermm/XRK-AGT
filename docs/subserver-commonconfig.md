# 子服插件 CommonConfig（扩展性）

业务子服插件的配置**由子服维护**，主服控制台通过 HTTP 代理读写，不在主服 `core/*/commonconfig/` 重复 schema。

> **开发总览**：[subserver-plugin-development.md](subserver-plugin-development.md)

## 实现状态

| Runtime | CommonConfig HTTP | 说明 |
|---------|:-----------------:|------|
| **pyserver** | ✅ | `plugin_kit.py` + `plugin_config_api.py` + `base_api.py` |
| goserver / phpserver / jserver / netserver / rustserver | ❌ | 契约已定义，实现待对齐；主服 `SubserverConfigProxy` 已 runtime 无关 |

## 子服插件约定（pyserver）

**完整参考**：`subserver/pyserver/apis/jmcomic/`  
**框架示例**：`media-tools`、`doc-pipeline`、`web-fetch`

```
apis/<group>/
  service.py              # default 字典含 plugin_config: PluginConfig
  default_config.yaml     # 默认值 → data/<group>/config.yaml
  config_schema.yaml      # CommonConfig 面板 schema
  core/plugin/            # 可选：主服 QQ 插件等
```

**不要**在 `apis/<group>/core/commonconfig/` 或主服 `core/*/commonconfig/` 为子服业务重复写 schema。

`default` 字典声明：

```python
default = {
    "group": "mygroup",
    "plugin_config": config,  # load_plugin_config(...) 实例
    ...
}
```

框架自动挂载：

| 方法 | 路径 |
|------|------|
| GET | `/api/system/commonconfig/list` |
| GET | `/api/{group}/config/structure` |
| GET | `/api/{group}/config/read` |
| POST | `/api/{group}/config/write` |

实现：`subserver/pyserver/core/plugin_kit.py`、`plugin_config_api.py`、`base_api.py`。

## 主服

1. **连接**：`cfg.subserver`（来自 `aistream.yaml` → `subserver` 段）供 `Bot.callSubserver` / `getSubserverConfig()` 使用。
2. **控制台**：`ConfigLoader.registerFromSubserver()` 启动时拉取子服 list + structure，注册 `SubserverConfigProxy`（`src/infrastructure/commonconfig/subserver-config-proxy.js`）。
3. **扫描边界**：主服仅扫描子服 `apis/<group>/core/{plugin,http,stream,tasker,events}`，**不**扫描 `core/commonconfig`。

子服端点编辑：**CommonConfig → 系统配置 → AIStream → 子服务端**（`system.js` / `aistream.yaml`）。

## 插件内读配置（主服 JS）

```javascript
import ConfigLoader from '#infrastructure/commonconfig/loader.js';
const data = await ConfigLoader.get('jmcomic')?.read();
```

与子服控制台、`data/<group>/config.yaml` 同源（经 HTTP 代理）。

## 其它 runtime

对齐同一 HTTP 契约后，无需改主服代理逻辑。见 [subserver-plugin-development.md](subserver-plugin-development.md) 能力矩阵。
