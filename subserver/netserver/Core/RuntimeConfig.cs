namespace Xrk.Subserver.Core;

public sealed class RuntimeConfig
{
    public ServerSection Server { get; set; } = new();

    public sealed class ServerSection
    {
        public string Host { get; set; } = "0.0.0.0";
        public int Port { get; set; } = 8004;
        public StdinSection Stdin { get; set; } = new();
    }

    public sealed class StdinSection
    {
        public bool Enabled { get; set; } = true;
        public string Prompt { get; set; } = "子服> ";
    }

    public static RuntimeConfig Load()
    {
        var cfg = new RuntimeConfig();
        var defaultPath = Path.Combine("config", "default_config.json");
        MergeFile(defaultPath, cfg);

        var dataDir = ResolveDataDir();
        Directory.CreateDirectory(dataDir);
        var runtimePath = Path.Combine(dataDir, "config.json");
        if (!File.Exists(runtimePath) && File.Exists(defaultPath))
            File.Copy(defaultPath, runtimePath, true);
        MergeFile(runtimePath, cfg);

        if (int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var port))
            cfg.Server.Port = port;
        var host = Environment.GetEnvironmentVariable("HOST");
        if (!string.IsNullOrWhiteSpace(host))
            cfg.Server.Host = host;

        return cfg;
    }

    private static string ResolveDataDir()
    {
        foreach (var candidate in new[]
        {
            Path.Combine("..", "..", "data", "netserver"),
            Path.Combine("/app", "data", "netserver"),
            Path.Combine("data", "netserver")
        })
        {
            if (Directory.Exists(Path.GetDirectoryName(candidate)!) || Directory.Exists(candidate))
                return Path.GetFullPath(candidate);
        }
        return Path.GetFullPath(Path.Combine("..", "..", "data", "netserver"));
    }

    private static void MergeFile(string path, RuntimeConfig cfg)
    {
        if (!File.Exists(path)) return;
        var json = File.ReadAllText(path);
        var doc = System.Text.Json.JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("server", out var server)) return;
        if (server.TryGetProperty("host", out var host)) cfg.Server.Host = host.GetString() ?? cfg.Server.Host;
        if (server.TryGetProperty("port", out var port) && port.TryGetInt32(out var p)) cfg.Server.Port = p;
        if (server.TryGetProperty("stdin", out var stdin))
        {
            if (stdin.TryGetProperty("enabled", out var en)) cfg.Server.Stdin.Enabled = en.GetBoolean();
            if (stdin.TryGetProperty("prompt", out var prompt)) cfg.Server.Stdin.Prompt = prompt.GetString() ?? cfg.Server.Stdin.Prompt;
        }
    }
}
