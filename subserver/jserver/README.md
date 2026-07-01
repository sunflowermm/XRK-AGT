# jserver（Spring Boot）

Java 21 · 端口 **8003** · 契约见 [`../CONTRACT.md`](../CONTRACT.md)

## 示例插件

| 组名 | 类 | 路由 |
|------|-----|------|
| `datetime-tools` | `apis/datetime/DatetimePlugin.java` | `POST /api/datetime-tools/now` · `/format` |
| `json-tools` | `apis/json/JsonToolsPlugin.java` | `POST /api/json-tools/format` · `/validate` · `/keys` |

## 启动

```bash
cd subserver/jserver
mvn -q spring-boot:run
```

新插件：实现 `SubserverPlugin` + `@RestController`（Spring 自动注册）。

主服务地址：**CommonConfig → AIStream → 子服务端 → jserver**
