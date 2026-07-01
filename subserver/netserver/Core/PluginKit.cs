using System.Diagnostics;
using System.Text.Json;

namespace Xrk.Subserver.Core;

public static class PluginKit
{
    public static Dictionary<string, object?> DefaultPluginUpdate(string pluginDir)
    {
        var steps = new List<Dictionary<string, object?>>();
        var csproj = string.IsNullOrWhiteSpace(pluginDir)
            ? Path.Combine(Directory.GetCurrentDirectory(), "netserver.csproj")
            : Path.Combine(pluginDir, $"{Path.GetFileName(pluginDir)}.csproj");

        if (File.Exists(csproj))
            steps.Add(RunProcess("dotnet", $"restore \"{csproj}\""));
        else if (File.Exists("netserver.csproj"))
            steps.Add(RunProcess("dotnet", "restore netserver.csproj"));
        else
            steps.Add(new Dictionary<string, object?> { ["ok"] = true, ["skipped"] = "no csproj" });

        var ok = steps.All(s => s.TryGetValue("ok", out var v) && v is true || s.ContainsKey("skipped"));
        return new Dictionary<string, object?>
        {
            ["ok"] = ok,
            ["plugin"] = string.IsNullOrWhiteSpace(pluginDir) ? "netserver" : Path.GetFileName(pluginDir),
            ["steps"] = steps
        };
    }

    public static Dictionary<string, object?> ParseCommandBody(JsonElement body, string group)
    {
        string cmd = GetString(body, "cmd");
        if (cmd.Length == 0) cmd = GetString(body, "command");

        var args = new List<string>();
        if (body.TryGetProperty("args", out var rawArgs))
        {
            if (rawArgs.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in rawArgs.EnumerateArray())
                    args.Add(item.ToString());
            }
            else if (rawArgs.ValueKind == JsonValueKind.String)
            {
                args.AddRange(rawArgs.GetString()!.Split(' ', StringSplitOptions.RemoveEmptyEntries));
            }
        }

        var line = GetString(body, "line");
        if (line.Length > 0 && cmd.Length == 0)
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var i = 0;
            if (parts.Length > 0 && parts[0].Equals(group, StringComparison.OrdinalIgnoreCase)) i = 1;
            if (parts.Length > i) cmd = parts[i++];
            for (; i < parts.Length; i++) args.Add(parts[i]);
        }

        if (cmd.Length == 0) cmd = "help";
        return new Dictionary<string, object?> { ["cmd"] = cmd, ["args"] = args };
    }

    public static async Task<Dictionary<string, object?>> ReadJsonBodyAsync(HttpRequest request)
    {
        try
        {
            var doc = await JsonDocument.ParseAsync(request.Body);
            var dict = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
                dict[prop.Name] = prop.Value.ValueKind == JsonValueKind.String ? prop.Value.GetString() : prop.Value.ToString();
            return dict;
        }
        catch
        {
            return new Dictionary<string, object?>();
        }
    }

    private static string GetString(JsonElement body, string name)
    {
        if (!body.TryGetProperty(name, out var value)) return "";
        return value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();
    }

    private static Dictionary<string, object?> RunProcess(string file, string args)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(file, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            });
            if (p == null)
                return new Dictionary<string, object?> { ["ok"] = false, ["cmd"] = $"{file} {args}", ["error"] = "start failed" };

            var stdout = p.StandardOutput.ReadToEnd();
            var stderr = p.StandardError.ReadToEnd();
            p.WaitForExit();
            return new Dictionary<string, object?>
            {
                ["ok"] = p.ExitCode == 0,
                ["cmd"] = $"{file} {args}",
                ["stdout"] = stdout.Trim(),
                ["stderr"] = stderr.Trim(),
                ["code"] = p.ExitCode
            };
        }
        catch (Exception ex)
        {
            return new Dictionary<string, object?> { ["ok"] = false, ["cmd"] = $"{file} {args}", ["error"] = ex.Message };
        }
    }
}
