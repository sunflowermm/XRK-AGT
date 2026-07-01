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

新插件：实现 `ISubserverPlugin`，加入 `Core/PluginCatalog.cs`。

主服务：**CommonConfig → AIStream → 子服务端 → netserver**
