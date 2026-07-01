using System.Text.Json;
using Xrk.Subserver.Core;

namespace Xrk.Subserver.Web;

public static class SystemEndpoints
{
    public static void MapSubserverSystem(this WebApplication app, CommandRegistry registry)
    {
        app.MapGet("/", () => Results.Json(new Dictionary<string, object?>
        {
            ["name"] = "XRK-AGT .NET 子服务端",
            ["runtime"] = "netserver",
            ["version"] = "1.0.0",
            ["status"] = "running"
        }));

        app.MapGet("/health", () => Results.Json(new Dictionary<string, object?>
        {
            ["status"] = "healthy",
            ["runtime"] = "netserver"
        }));

        app.MapMethods("/health", ["HEAD"], () => Results.Ok());

        app.MapGet("/api/list", () => Results.Json(new Dictionary<string, object?>
        {
            ["apis"] = registry.ApiList(),
            ["count"] = registry.ApiList().Count,
            ["runtime"] = "netserver"
        }));

        app.MapGet("/api/system/ping", () => Results.Json(new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["service"] = "netserver-core"
        }));

        app.MapGet("/api/system/config", () => Results.Json(new Dictionary<string, object?>
        {
            ["runtime"] = "netserver",
            ["server"] = new Dictionary<string, object?> { ["port"] = 8004 }
        }));

        app.MapGet("/api/system/groups", () =>
        {
            var outMap = registry.ListHelp();
            outMap["ok"] = true;
            return Results.Json(outMap);
        });

        app.MapPost("/api/system/command", async (HttpRequest request) =>
        {
            using var doc = await JsonDocument.ParseAsync(request.Body);
            var root = doc.RootElement;
            var line = root.TryGetProperty("line", out var lineEl) ? lineEl.GetString()?.Trim() ?? "" : "";

            if (line.Length == 0 && root.TryGetProperty("group", out var groupEl))
            {
                var sb = new System.Text.StringBuilder(groupEl.GetString() ?? "");
                if (root.TryGetProperty("command", out var cmdEl)) sb.Append(' ').Append(cmdEl.GetString());
                if (root.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in argsEl.EnumerateArray())
                        sb.Append(' ').Append(item);
                }
                line = sb.ToString().Trim();
            }

            if (line.Length == 0) line = "help";
            return Results.Json(registry.RunLine(line));
        });

        app.MapGet("/api/{group}/health", (string group, CommandRegistry reg) =>
            Results.Json(reg.Dispatch(group, "help", Array.Empty<string>())));
    }
}
