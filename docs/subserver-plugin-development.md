# 子服插件开发与主服融合

> **契约**：[`subserver/CONTRACT.md`](../subserver/CONTRACT.md)  
> **CommonConfig**：[`subserver-commonconfig.md`](subserver-commonconfig.md)  
> **HTTP 详情**：[`subserver-api.md`](subserver-api.md)

子服插件与主服通过 **HTTP 契约 + 目录扫描** 结合，**不在主服 `core/*/commonconfig/` 为子服业务写 JS schema**。

---

## 能力矩阵（按 runtime）

| 能力 | pyserver | goserver | phpserver | jserver | netserver | rustserver |
|------|:--------:|:--------:|:---------:|:-------:|:---------:|:----------:|
| `/health`、`/api/system/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `apis/<group>/` 自动装载 | ✅ 扫目录 | ✅ | ✅ | ✅ Spring | ✅ 反射 | ⚠️ 手动注册 |
| CommonConfig HTTP（`/api/system/commonconfig/list`、`/api/{group}/config/*`） | ✅ | ❌ 待对齐 | ❌ | ❌ | ❌ | ❌ |
| 主服扫描 `apis/<group>/core/plugin` | ✅ | ✅ | ✅ | ⚠️ 见下 | ✅ `Apis/` | ⚠️ 见下 |
| 主服 `Bot.callSubserver` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 主服控制台编辑业务配置 | ✅（pyserver + `plugin_config`） | ❌ | ❌ | ❌ | ❌ | ❌ |

**结论**：开发时可**一律**用 `Bot.callSubserver` 调任意 runtime；**控制台 CommonConfig + 主服 QQ 插件扫描** 目前以 **pyserver 标准目录** 为准。

### 主服 `core/plugin` 扫描路径

主服 `PluginsLoader` / `paths.js` 扫描：

```
subserver/<runtime>/apis/<group>/core/{plugin,http,stream,tasker,events}
```

（`Apis/` 大小写变体亦支持。）

| Runtime | 注意 |
|---------|------|
| **pyserver / goserver / phpserver / netserver** | 在 `apis/<group>/core/plugin/` 放 JS 即可 |
| **jserver** | 业务类在 `src/main/java/.../apis/`，**无** runtime 根下 `apis/`；需自建 `subserver/jserver/apis/<group>/core/plugin/` 镜像目录供主服扫描 |
| **rustserver** | 插件在 `src/plugins/` 编译注册；需同样自建 `subserver/rustserver/apis/<group>/core/plugin/` 若要与主服 QQ 融合 |

---

## 标准目录（pyserver · 推荐）

**完整参考**：`subserver/pyserver/apis/jmcomic/`（业务 + CommonConfig + 主服 QQ 插件）

**最小可控制台编辑**：`media-tools` / `doc-pipeline` / `web-fetch`

```
subserver/pyserver/apis/<group>/
  service.py              # 入口；export default 字典
  default_config.yaml     # 模板 → data/<group>/config.yaml
  config_schema.yaml      # 控制台 schema（CommonConfig 面板）
  requirements.txt        # 可选
  README.md               # 可选
  core/                   # 可选 — 仅主服扩展，不是子服 Python 代码
    plugin/*.js           # QQ 指令等
    http/*.js             # 主服 HTTP（少见）
```

### `service.py` 必备形状

```python
from pathlib import Path
from core.plugin_kit import load_plugin_config

_PLUGIN_DIR = Path(__file__).resolve().parent
config = load_plugin_config(_PLUGIN_DIR, "<group>")  # 默认值见 default_config.yaml

default = {
    "name": "<group>",
    "description": "...",
    "group": "<group>",           # URL 前缀 /api/<group>/*
    "plugin_dir": str(_PLUGIN_DIR),
    "plugin_config": config,      # 声明后自动挂载 /config/* + 控制台代理
    "priority": 100,
    "commands": {"status": cmd_status},
    "routes": [
        {"method": "POST", "path": "/api/<group>/action", "handler": handler},
    ],
}
```

**不要**在 `apis/<group>/core/commonconfig/` 或主服 `core/*/commonconfig/` 重复 schema。

### `config_schema.yaml` 必备形状

```yaml
name: mygroup
displayName: 显示名
description: 说明
schema:
  fields:
    some_key:
      type: string
      label: 字段标签
      component: Input
      default: ""
```

---

## 主服如何衔接

### 1. 连接子服

| 配置 | 位置 |
|------|------|
| host / port / runtimes | `aistream.yaml` → `subserver` |
| 运行时读取 | **`cfg.subserver`** |
| 调用 | `Bot.callSubserver(path, { runtime, method, body })` |

控制台：**CommonConfig → 系统配置 → AIStream → 子服务端**。

### 2. 控制台业务配置（pyserver）

启动主 Bot 时 `ConfigLoader.registerFromSubserver()`：

1. `GET /api/system/commonconfig/list`（默认 pyserver）
2. 对每个插件 `GET /api/{group}/config/structure`
3. 注册 `SubserverConfigProxy` → 控制台出现对应面板

实现：`src/infrastructure/commonconfig/subserver-config-proxy.js`、`loader.js`。

### 3. 主服 QQ / HTTP 插件

放在 **`apis/<group>/core/plugin/`**（或 `http/` 等），主服 Loader **自动扫描**，无需复制到 `core/jm-Core/`。

插件内读配置推荐：

```javascript
import ConfigLoader from '#infrastructure/commonconfig/loader.js';

const entry = ConfigLoader.get('jmcomic');
const data = entry ? await entry.read() : {};
```

### 4. 扫描边界

| 扫描源 | 子目录 |
|--------|--------|
| 仓库 `core/<Core>/` | plugin, http, commonconfig, stream, tasker, events |
| 子服 `apis/<group>/core/` | plugin, http, stream, tasker, events（**不含 commonconfig**） |

业务 commonconfig **仅**走子服 HTTP API。

---

## 新建插件检查清单

### pyserver（与主服完整融合）

- [ ] `apis/<group>/service.py`，`default.group` 与目录名一致
- [ ] `default_config.yaml` → `data/<group>/config.yaml`
- [ ] `config_schema.yaml` + `default.plugin_config`
- [ ] 需 QQ 指令：`core/plugin/*.js`（继承 `#infrastructure/plugins/plugin.js`）
- [ ] 主服调用：`Bot.callSubserver('/api/<group>/...')`
- [ ] 子服端点已在 `cfg.subserver` 配置
- [ ] **未**在主服添加 `core/*/commonconfig/<group>.js`

### 其它 runtime（HTTP 业务）

- [ ] 实现 [`CONTRACT.md`](../subserver/CONTRACT.md) 系统路由
- [ ] `apis/<group>/service.*` 可被 runtime 装载
- [ ] 主服用 `Bot.callSubserver(..., { runtime: 'goserver' })` 等
- [ ] CommonConfig：待 runtime 对齐 pyserver 的 `plugin_config` + config HTTP
- [ ] 需主服 QQ：在 `subserver/<runtime>/apis/<group>/core/plugin/` 放置 JS（jserver/rustserver 需自建该路径）

---

## 参考示例

| 场景 | 路径 |
|------|------|
| 完整（配置 + QQ + 业务） | `subserver/pyserver/apis/jmcomic/` |
| 可控制台编辑的 HTTP 插件 | `media-tools`、`doc-pipeline`、`web-fetch` |
| Go HTTP | `subserver/goserver/apis/hash-tools/` |
| PHP | `subserver/phpserver/apis/string-tools/` |
| Java | `subserver/jserver/.../apis/datetime/` |
| .NET | `subserver/netserver/Apis/uuid-tools/` |
| Rust | `subserver/rustserver/src/plugins/regex_tools.rs` |

---

## 常见问题

**Q：子服插件的 CommonConfig 要不要写主服 `commonconfig/*.js`？**  
A：**不要**。子服 `config_schema.yaml` + `plugin_config`，主服自动代理。

**Q：非 pyserver 插件能在控制台编辑吗？**  
A：目前不能，除非该 runtime 实现 CommonConfig HTTP 契约（主服代理已 runtime 无关）。

**Q：子服连不上时 QQ 插件怎么办？**  
A：`formatSubserverError` / `getSubserverConfig` 返回友好提示；配置读取可 fallback 默认值。

**Q：jmcomic 为何不在 git 里？**  
A：第三方 clone，见 `.gitignore`；结构与框架示例相同，本地开发仍被 Loader 扫描。

---

## 相关文档

- [`plugins-loader.md`](plugins-loader.md) — 主服插件扫描
- [`base-classes.md`](base-classes.md) — ConfigBase / plugin 基类
- [`框架可扩展性指南.md`](框架可扩展性指南.md) — Core 扩展总览
- [`runtime-surface.md`](runtime-surface.md) — `Bot.callSubserver`、`ConfigLoader`
