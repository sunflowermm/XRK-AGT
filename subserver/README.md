# XRK-AGT 多语言子服务

主服务 **Node.js** 负责 LLM / AIStream；子服务用**其它语言**做可插拔业务（契约见 [`CONTRACT.md`](CONTRACT.md)）。

| ID | 语言 | 端口 | 示例插件 | CommonConfig |
|----|------|------|----------|:------------:|
| `pyserver` | Python | 8000 | media-tools, doc-pipeline, web-fetch, jmcomic* | ✅ |
| `goserver` | Go | 8001 | hash-tools | ❌ |
| `phpserver` | PHP | 8002 | string-tools | ❌ |
| `jserver` | Spring Boot | 8003 | datetime-tools, json-tools | ❌ |
| `netserver` | ASP.NET Core | 8004 | uuid-tools | ❌ |
| `rustserver` | Axum | 8005 | regex-tools | ❌ |

\* `jmcomic` 为本地 clone（gitignore），结构与框架示例相同。

选型说明：[`LANGUAGES.md`](LANGUAGES.md) · 注册表：[`registry.yaml`](registry.yaml) · **开发指南**：[`docs/subserver-plugin-development.md`](../docs/subserver-plugin-development.md)

## 统一目录

与主仓 `core/system-Core` 同理：**子服底层在 runtime 的 `core/`，业务插件在 `apis/<组名>/`**。

业务插件若需 QQ 指令等与主服融合，在 **`apis/<组名>/core/plugin/`**（等）下放置；业务 **配置** 用 `config_schema.yaml` + `plugin_config`，见 [docs/subserver-commonconfig.md](../docs/subserver-commonconfig.md)。

```
<subserver>/<runtime>/
  config/default_config.*     # 子服配置模板
  core/                       # 子服加载器、命令注册（底层）
  apis/
    system/                   # 框架系统 API
    <组名>/
      service.*               # 子服 HTTP/命令入口
      default_config.*        # 业务配置模板 → data/<组名>/
      core/                   # 可选：主服扩展（plugin、http…）
        plugin/
```

新建插件：**复制同 runtime 已有示例**（如 pyserver 的 `media-tools`），改 `group` 与路由即可。

## 各 runtime 参考示例

| Runtime | 底层 | 学习用示例 |
|---------|------|------------|
| pyserver | `core/` · `apis/system/` | `apis/media-tools/`（HTTP+CommonConfig）；完整融合见 `apis/jmcomic/` |
| goserver | `core/` | `apis/hash-tools/service.go` |
| phpserver | `core/` | `apis/string-tools/service.php` |
| jserver | `core/` · `src/.../apis/` | `DatetimePlugin.java`（主服 `core/plugin` 需自建 `apis/<group>/core/`） |
| netserver | `Core/` · `Web/SystemEndpoints.cs` | `Apis/uuid-tools/UuidToolsPlugin.cs` |
| rustserver | `src/core/` · `src/plugins/` | `regex_tools.rs`（手动注册；主服扫描需 `apis/<group>/core/`） |

## 启动（本地）

```bash
cd subserver/pyserver && uv run xrk
cd subserver/goserver && go run .
cd subserver/phpserver && php -S 0.0.0.0:8002 server.php
cd subserver/jserver && mvn -q spring-boot:run
cd subserver/netserver && dotnet run
cd subserver/rustserver && cargo run
```

## Docker Compose（五 runtime 一键）

```bash
docker compose up -d
```

主容器 `xrk-agt` 通过环境变量 `SUBSERVER_*_HOST` 自动指向各子服务容器（见 `docker-compose.yml`）。

## 主服务衔接

**子服务终端**（与主服 `>` 分离，统一提示符 `子服>`）

```text
子服> 帮助
子服> media-tools 状态
子服> @java datetime-tools 状态
```

各 runtime 底层对齐项：

| 能力 | pyserver | goserver | phpserver | jserver | netserver | rustserver |
|------|:--------:|:--------:|:---------:|:-------:|:---------:|:----------:|
| `/health` · `/api/system/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CommonConfig HTTP → 主服控制台 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 主服扫描 `apis/*/core/plugin` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| `apis/<group>/` 自动扫描 | ✅ | 生成 import | ✅ | Spring 扫描 | 反射发现 | 手动注册 |
| stdin `子服>` + 中文别名 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**代码调用**

```javascript
await Bot.callSubserver('/api/json-tools/format', {
  runtime: 'jserver',
  method: 'POST',
  body: { text: '{"a":1}' }
})
```

配置：**CommonConfig → AIStream → 子服务端**（`subserver.runtimes`）
