using System.Text.Json;
using Xrk.Subserver.Core;

namespace Xrk.Subserver.Apis.UuidTools;

public sealed class UuidToolsPlugin : ISubserverPlugin
{
    public string Group => "uuid-tools";
    public string Description => "UUID / GUID 生成与校验";
    public string PluginDir => "";

    public void MapRoutes(WebApplication app, CommandRegistry registry)
    {
        var group = app.MapGroup($"/api/{Group}");

        group.MapPost("/generate", async (HttpRequest request) =>
        {
            var body = await PluginKit.ReadJsonBodyAsync(request);
            var count = 1;
            if (body.TryGetValue("count", out var raw) && int.TryParse(raw?.ToString(), out var n) && n > 0)
                count = Math.Min(n, 100);

            var ids = Enumerable.Range(0, count).Select(_ => Guid.NewGuid().ToString()).ToList();
            return Results.Json(new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["uuids"] = ids,
                ["count"] = ids.Count
            });
        });

        group.MapPost("/validate", async (HttpRequest request) =>
        {
            var body = await PluginKit.ReadJsonBodyAsync(request);
            var text = body.TryGetValue("text", out var t) ? t?.ToString()?.Trim() ?? "" : "";
            if (text.Length == 0)
                return Results.Json(new Dictionary<string, object?> { ["ok"] = false, ["error"] = "需要 text" });

            var valid = Guid.TryParse(text, out var guid);
            return Results.Json(new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["valid"] = valid,
                ["normalized"] = valid ? guid.ToString() : null
            });
        });
    }
}
