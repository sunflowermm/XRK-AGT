namespace Xrk.Subserver.Core;

public interface ISubserverPlugin
{
    string Group { get; }
    string Description { get; }
    string PluginDir { get; }

    Dictionary<string, Func<IReadOnlyList<string>, Dictionary<string, object?>>> Commands =>
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["status"] = _ => new Dictionary<string, object?> { ["service"] = Group, ["runtime"] = "dotnet" }
        };

    void Register(CommandRegistry registry)
    {
        registry.Register(new CommandRegistry.PluginSet(Group, Description, PluginDir, Commands));
    }

    void MapRoutes(WebApplication app, CommandRegistry registry);
}
