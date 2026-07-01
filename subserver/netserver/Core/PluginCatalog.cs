using Xrk.Subserver.Apis.UuidTools;

namespace Xrk.Subserver.Core;

public static class PluginCatalog
{
    public static IReadOnlyList<ISubserverPlugin> All { get; } =
    [
        new UuidToolsPlugin()
    ];
}
