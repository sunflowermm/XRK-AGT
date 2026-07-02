# 子服插件开发

> **配置分工（必读）**：[subserver-commonconfig.md](subserver-commonconfig.md) — 主服编辑、子服只读  
> **HTTP 契约**：[subserver/CONTRACT.md](../subserver/CONTRACT.md)

## 架构一句话

- **子服**：`apis/<group>/service.*` 执行业务，**只读** `data/<group>/config.yaml`
- **主服**：扫描 `apis/<group>/core/commonconfig/`、`core/plugin/`；控制台改配置；`cfg.subserver` 连子服

```
subserver/<runtime>/apis/<group>/
  service.py | service.go | …
  default_config.yaml
  core/
    commonconfig/<group>.js
    plugin/*.js
```

## 主服 Loader 扫描

与 `core/system-Core` 相同子目录：`commonconfig`、`plugin`、`http`、`stream`、`tasker`、`events`。

路径：`subserver/<runtime>/apis/<group>/core/<子目录>/`  
（jserver/rustserver 若源码不在 `apis/` 下，需自建该目录供主服扫描。）

## pyserver 最小模板

**service.py**

```python
from pathlib import Path
from core.plugin_kit import load_plugin_config

_PLUGIN_DIR = Path(__file__).resolve().parent
config = load_plugin_config(_PLUGIN_DIR, "mygroup")

async def cmd_status(_request, _args):
    return {"service": "mygroup", "config": str(config.runtime_file)}

default = {
    "name": "mygroup",
    "group": "mygroup",
    "plugin_dir": str(_PLUGIN_DIR),
    "commands": {"status": cmd_status},
    "routes": [],
}
```

**core/commonconfig/mygroup.js**

```javascript
import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class MygroupConfig extends ConfigBase {
  constructor() {
    super({
      name: 'mygroup',
      displayName: '我的插件',
      filePath: 'data/mygroup/config.yaml',
      defaultTemplatePath: 'subserver/pyserver/apis/mygroup/default_config.yaml',
      schema: { fields: { /* … */ } }
    });
  }
}
```

## 参考实现

| 场景 | 路径 |
|------|------|
| 业务 + QQ + CommonConfig | `subserver/pyserver/apis/jmcomic/` |
| 框架内置示例 | `media-tools/`、`doc-pipeline/`、`web-fetch/` |

## 调用子服

```javascript
await Bot.callSubserver('/api/mygroup/action', {
  method: 'POST',
  runtime: 'pyserver',
  body: {}
});
```

子服地址在 **CommonConfig → 系统配置 → AIStream → 子服务端**（`cfg.subserver`）。
