# 子服与主服：配置分工

> **原则**：**配置管理全在主服**（控制台 CommonConfig）；**子服只读**运行时 yaml/json。  
> **插件开发**：[subserver-plugin-development.md](subserver-plugin-development.md) · **HTTP**：[subserver-api.md](subserver-api.md)

---

## 三类配置

| 类型 | 谁编辑 | 谁读取 | 文件 / 入口 |
|------|--------|--------|-------------|
| **子服连接** | 主服控制台 | 主服 `AgentRuntime.callSubserver` | `ai-workflow.yaml` → **`runtimeConfig.subserver`**（系统配置 → AiWorkflow → 子服务端） |
| **业务插件** | 主服控制台 | 子服 `load_plugin_config` / 主服 QQ 插件 | `data/<group>/config.yaml` |
| **子服进程**（可选） | 部署 / 子服本地 | pyserver 启动 | `data/subserver/config.yaml`（监听地址等，与主服「连哪个端口」无关） |

主服编辑子服 **host/port** 时，改的是 **AiWorkflow → 子服务端**（`subserver.runtimes.pyserver` 等），不是业务插件 yaml。

---

## 业务插件 CommonConfig（与主仓 Core 同模式）

schema 放在子服插件目录下的 **`core/commonconfig/`**，由主服 `CommonConfigRegistry` 扫描——**不是**子服 HTTP API，**不是**主仓 `core/*/commonconfig/` 再写一份。

```
subserver/pyserver/apis/<group>/
  default_config.yaml              # 首次引导模板（仅复制用）
  service.py                       # 子服业务，load_plugin_config 只读
  core/
    commonconfig/<group>.js        # ConfigBase → 控制台编辑
    plugin/*.js                    # 可选：主服 QQ
```

### 数据流

```
控制台保存
    → ConfigBase.write()
    → data/<group>/config.yaml
    → 子服 PluginConfig.get() / reload()
    → 主服 CommonConfigRegistry.get('<group>').read()
```

子服**不提供**配置写入 API；改配置后子服需 **reload 配置或重启** 才能读到新值（各插件可在 `status` 命令里提示）。

### 示例

| 控制台名称 | commonconfig 文件 | 运行时数据 |
|------------|-------------------|------------|
| 禁漫本子 | `apis/jmcomic/core/commonconfig/jmcomic.js` | `data/jmcomic/config.yaml` |
| 媒体工具 | `apis/media-tools/core/commonconfig/media-tools.js` | `data/media-tools/config.yaml` |

`defaultTemplatePath` 指向 `subserver/pyserver/apis/<group>/default_config.yaml`。

---

## 主服扫描路径

`src/utils/paths.js` 合并：

| 来源 | 子目录 |
|------|--------|
| `core/<Core>/` | plugin, http, **commonconfig**, stream, tasker, events |
| `subserver/*/apis/<group>/core/` | 同上 |

实现：`src/infrastructure/commonconfig/loader.js`。

---

## 子服侧（只读）

```python
from core.plugin_kit import load_plugin_config

config = load_plugin_config(_PLUGIN_DIR, "<group>")
value = config.get("limits.max_pages", 300)
config.reload()  # 主服改 yaml 后可选刷新
```

**禁止**在子服实现配置写入 HTTP、或在主仓 `core/*/commonconfig/` 重复业务 schema。

---

## 主服侧

```javascript
import CommonConfigRegistry from '#infrastructure/commonconfig/loader.js';
import runtimeConfig from '#infrastructure/config/config.js';

// 业务配置
const data = await CommonConfigRegistry.get('jmcomic')?.read();

// 子服连接
await AgentRuntime.callSubserver('/api/jmcomic/download', { body: { album_id: '123' } });
// 端点来自 runtimeConfig.subserver
```

---

## 新建业务插件检查清单

- [ ] `default_config.yaml` + `data/<group>/config.yaml`
- [ ] `core/commonconfig/<group>.js`（ConfigBase + `defaultTemplatePath`）
- [ ] 子服 `service.*` 仅 `load_plugin_config` 读取
- [ ] 需 QQ：`core/plugin/*.js`
- [ ] 未在主仓 `core/*/commonconfig/` 重复 schema
- [ ] 未在子服实现 config HTTP 写入

---

## 相关文档

- [subserver-plugin-development.md](subserver-plugin-development.md) — 目录与 HTTP 契约
- [subserver/CONTRACT.md](../subserver/CONTRACT.md) — 子服路由
- [base-classes.md](base-classes.md) — ConfigBase 基类
