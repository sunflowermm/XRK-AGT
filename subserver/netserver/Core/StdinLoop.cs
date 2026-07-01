using Xrk.Subserver.Core;

namespace Xrk.Subserver;

public static class StdinLoop
{
    public static void Start(CommandRegistry registry, IConfiguration config)
    {
        var enabled = config.GetValue("Server:Stdin:Enabled", true);
        if (!enabled || Console.IsInputRedirected) return;

        var prompt = config.GetValue<string>("Server:Stdin:Prompt") ?? "net> ";
        _ = Task.Run(async () =>
        {
            Console.WriteLine("\n[.NET 子服务] 终端命令已就绪 · 输入 help 或 list");
            while (true)
            {
                Console.Write(prompt);
                var line = Console.ReadLine();
                if (line == null) break;
                line = line.Trim();
                if (line.Length == 0) continue;
                if (line is "exit" or "quit")
                {
                    Console.WriteLine("[.NET 子服务] 终端命令已退出（HTTP 继续）");
                    break;
                }
                var result = registry.RunLine(line);
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
            await Task.CompletedTask;
        });
    }
}
