using Xrk.Subserver.Core;

namespace Xrk.Subserver;

public static class StdinLoop
{
    public static void Start(CommandRegistry registry, RuntimeConfig config)
    {
        if (!config.Server.Stdin.Enabled || Console.IsInputRedirected) return;

        var prompt = string.IsNullOrWhiteSpace(config.Server.Stdin.Prompt)
            ? "子服> "
            : config.Server.Stdin.Prompt;
        _ = Task.Run(async () =>
        {
            Console.WriteLine("\n[子服] 终端命令已就绪 · 输入 帮助 或 list");
            while (true)
            {
                Console.Write(prompt);
                var line = Console.ReadLine();
                if (line == null) break;
                line = line.Trim();
                if (line.Length == 0) continue;
                if (CommandRegistry.IsExitLine(line))
                {
                    Console.WriteLine("[子服] 终端已关闭（HTTP 继续运行）");
                    break;
                }
                var result = registry.RunLine(line);
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
            await Task.CompletedTask;
        });
    }
}
