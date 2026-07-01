# XRK-AGT 多语言子服务

主服务 **Node.js** 负责 LLM / AIStream；子服务用**其它语言**做可插拔业务（契约见 [`CONTRACT.md`](CONTRACT.md)）。

| ID | 语言 | 端口 | 示例插件 |
|----|------|------|----------|
| `pyserver` | Python | 8000 | media-tools, doc-pipeline, web-fetch, jmcomic |
| `goserver` | Go | 8001 | hash-tools |
| `phpserver` | PHP | 8002 | string-tools |
| `jserver` | Spring Boot | 8003 | datetime-tools, json-tools |
| `netserver` | ASP.NET Core | 8004 | uuid-tools |
| `rustserver` | Axum | 8005 | regex-tools |

选型说明：[`LANGUAGES.md`](LANGUAGES.md) · 注册表：[`registry.yaml`](registry.yaml)

## 统一目录

```
<subserver>/
  config/default_config.*
  core/{config,plugin_kit,command_registry,loader}.*
  apis/<group>/service.*
  apis/_template/
```

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

**QQ / 终端命令**

```text
#子服 jmcomic update
#子服 @java datetime-tools status
#子服 @net uuid-tools status
```

**代码调用**

```javascript
await Bot.callSubserver('/api/json-tools/format', {
  runtime: 'jserver',
  method: 'POST',
  body: { text: '{"a":1}' }
})
```

配置：**CommonConfig → AIStream → 子服务端**（`subserver.runtimes`）
