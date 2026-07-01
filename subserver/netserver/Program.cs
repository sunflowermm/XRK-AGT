using Xrk.Subserver;
using Xrk.Subserver.Core;
using Xrk.Subserver.Web;

var builder = WebApplication.CreateBuilder(args);

var port = 8004;
if (int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var envPort))
    port = envPort;
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var registry = new CommandRegistry();
foreach (var plugin in PluginCatalog.All)
    plugin.Register(registry);

var app = builder.Build();

app.MapSubserverSystem(registry);
foreach (var plugin in PluginCatalog.All)
    plugin.MapRoutes(app, registry);

StdinLoop.Start(registry, builder.Configuration);

Console.WriteLine("──────────────────────────────────────");
Console.WriteLine($"🌐 .NET 子服务  http://0.0.0.0:{port}");
Console.WriteLine("──────────────────────────────────────");

app.Run();
