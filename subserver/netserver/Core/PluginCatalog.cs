using System.Reflection;
using Xrk.Subserver.Core;

namespace Xrk.Subserver;

public static class PluginCatalog
{
    public static IReadOnlyList<ISubserverPlugin> All { get; } = Discover();

    private static IReadOnlyList<ISubserverPlugin> Discover()
    {
        return Assembly.GetExecutingAssembly()
            .GetTypes()
            .Where(t => typeof(ISubserverPlugin).IsAssignableFrom(t)
                        && t is { IsAbstract: false, IsInterface: false, IsClass: true })
            .Select(t => (ISubserverPlugin)Activator.CreateInstance(t)!)
            .OrderBy(p => p.Group, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
