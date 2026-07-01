using Xrk.Subserver;
using Xrk.Subserver.Core;
using Xrk.Subserver.Web;

var runtimeConfig = RuntimeConfig.Load();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://{runtimeConfig.Server.Host}:{runtimeConfig.Server.Port}");

var registry = new CommandRegistry();
foreach (var plugin in PluginCatalog.All)
    plugin.Register(registry);

var app = builder.Build();

app.MapSubserverSystem(registry, runtimeConfig);
foreach (var plugin in PluginCatalog.All)
    plugin.MapRoutes(app, registry);

StdinLoop.Start(registry, runtimeConfig);

Console.WriteLine("──────────────────────────────────────");
Console.WriteLine($"🌐 .NET 子服务  http://{runtimeConfig.Server.Host}:{runtimeConfig.Server.Port}");
Console.WriteLine("──────────────────────────────────────");

app.Run();
