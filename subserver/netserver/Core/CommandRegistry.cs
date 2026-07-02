namespace Xrk.Subserver.Core;

public sealed class CommandRegistry
{
    private static readonly Dictionary<string, string> TopAliases = new(StringComparer.Ordinal)
    {
        ["帮助"] = "help",
        ["列表"] = "list",
        ["组"] = "list",
    };

    private static readonly Dictionary<string, string> CmdAliases = new(StringComparer.Ordinal)
    {
        ["状态"] = "status",
        ["更新"] = "update",
        ["同步"] = "sync",
        ["帮助"] = "help",
    };

    private static readonly HashSet<string> ExitWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "exit", "quit", "q", "退出", "离开"
    };

    public static bool IsExitLine(string? line)
    {
        var t = (line ?? "").Trim();
        return t.Length > 0 && ExitWords.Contains(t);
    }

    private static string NormalizeCliLine(string line)
    {
        var parts = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return line.Trim();
        if (TopAliases.TryGetValue(parts[0], out var top)) parts[0] = top;
        else if (parts.Length >= 2 && CmdAliases.TryGetValue(parts[1], out var cmd)) parts[1] = cmd;
        return string.Join(' ', parts);
    }

    public sealed record PluginSet(
        string Group,
        string Description,
        string PluginDir,
        Dictionary<string, Func<IReadOnlyList<string>, Dictionary<string, object?>>> Commands
    );

    private readonly Dictionary<string, PluginSet> _groups = new(StringComparer.OrdinalIgnoreCase);

    public void Register(PluginSet set)
    {
        if (string.IsNullOrWhiteSpace(set.Group)) return;
        _groups[set.Group] = set;
    }

    public IReadOnlyList<string> Groups() => _groups.Keys.OrderBy(x => x).ToList();

    public Dictionary<string, object?> ListHelp()
    {
        var items = Groups().Select(name =>
        {
            var g = _groups[name];
            return new Dictionary<string, object?>
            {
                ["group"] = name,
                ["description"] = g.Description,
                ["commands"] = CommandNames(g)
            };
        }).ToList();

        return new Dictionary<string, object?>
        {
            ["groups"] = items,
            ["count"] = items.Count
        };
    }

    public Dictionary<string, object?> RunLine(string line)
    {
        line = NormalizeCliLine(line);
        if (line.Length == 0)
            return new Dictionary<string, object?> { ["ok"] = false, ["error"] = "空命令" };

        var lower = line.ToLowerInvariant();
        if (lower is "help" or "?")
        {
            var help = ListHelp();
            help["ok"] = true;
            help["hint"] = "用法: <组名> <命令> [参数...]";
            return help;
        }

        if (lower is "list" or "groups")
            return new Dictionary<string, object?> { ["ok"] = true, ["groups"] = Groups() };

        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var group = parts[0];
        var cmd = parts.Length > 1 ? parts[1] : "help";
        var args = parts.Length > 2 ? parts.Skip(2).ToList() : Array.Empty<string>();
        return Dispatch(group, cmd, args);
    }

    public Dictionary<string, object?> Dispatch(string group, string cmd, IReadOnlyList<string> args)
    {
        if (!_groups.TryGetValue(group, out var g))
        {
            return new Dictionary<string, object?>
            {
                ["ok"] = false,
                ["error"] = $"未知插件组: {group}",
                ["available"] = Groups()
            };
        }

        cmd = (cmd ?? "help").Trim().ToLowerInvariant();
        if (cmd is "" or "help")
        {
            return new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["group"] = group,
                ["commands"] = CommandNames(g)
            };
        }

        if (cmd == "update")
        {
            var result = PluginKit.DefaultPluginUpdate(g.PluginDir);
            return new Dictionary<string, object?>
            {
                ["ok"] = result["ok"],
                ["group"] = group,
                ["result"] = result
            };
        }

        if (!g.Commands.TryGetValue(cmd, out var handler))
        {
            return new Dictionary<string, object?>
            {
                ["ok"] = false,
                ["error"] = $"未知命令: {cmd}",
                ["group"] = group,
                ["available"] = CommandNames(g)
            };
        }

        var res = new Dictionary<string, object?>(handler(args));
        res.TryAdd("ok", true);
        res["group"] = group;
        return res;
    }

    public List<Dictionary<string, object?>> ApiList()
    {
        return Groups().Select(name =>
        {
            var g = _groups[name];
            return new Dictionary<string, object?>
            {
                ["name"] = name,
                ["description"] = g.Description,
                ["group"] = name
            };
        }).ToList();
    }

    public Dictionary<string, object?> GroupHealth(string group)
    {
        if (!_groups.TryGetValue(group, out var g))
            return new Dictionary<string, object?> { ["ok"] = false, ["error"] = $"未知插件组: {group}" };

        return new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["group"] = g.Group,
            ["name"] = g.Group,
            ["commands"] = CommandNames(g)
        };
    }

    private static List<string> CommandNames(PluginSet g)
    {
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase) { "help", "update" };
        foreach (var key in g.Commands.Keys) names.Add(key);
        return names.ToList();
    }
}
