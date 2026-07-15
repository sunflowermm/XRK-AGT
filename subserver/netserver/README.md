# netserver（ASP.NET Core 8）

.NET 8 · 端口 **8004** · 契约见 [`../CONTRACT.md`](../CONTRACT.md)

## 示例插件

| 组名 | 类 | 路由 |
|------|-----|------|
| `uuid-tools` | `apis/uuid-tools/UuidToolsPlugin.cs` | `POST /api/uuid-tools/generate` · `/validate` |

## 启动

```bash
cd subserver/netserver
dotnet run
```

新插件：复制 `Apis/uuid-tools/UuidToolsPlugin.cs`，改组名与路由，并在 `Core/PluginCatalog.cs` 注册。

主服务：**CommonConfig → AiWorkflow → 子服务端 → netserver**
