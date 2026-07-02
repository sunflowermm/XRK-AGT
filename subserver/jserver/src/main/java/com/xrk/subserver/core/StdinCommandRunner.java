package com.xrk.subserver.core;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Scanner;

@Component
public class StdinCommandRunner implements ApplicationRunner {

    private final CommandRegistry registry;
    private final RuntimeConfig runtimeConfig;

    public StdinCommandRunner(CommandRegistry registry, RuntimeConfig runtimeConfig) {
        this.registry = registry;
        this.runtimeConfig = runtimeConfig;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (System.console() == null || !runtimeConfig.stdinEnabled()) return;

        Thread t = new Thread(() -> {
            System.out.println("\n[子服] 终端命令已就绪 · 输入 帮助 或 list");
            String prompt = runtimeConfig.stdinPrompt();
            try (Scanner sc = new Scanner(System.in)) {
                while (true) {
                    System.out.print(prompt);
                    if (!sc.hasNextLine()) break;
                    String line = sc.nextLine().trim();
                    if (line.isEmpty()) continue;
                    if (CommandRegistry.isExitLine(line)) {
                        System.out.println("[子服] 终端已关闭（HTTP 继续运行）");
                        break;
                    }
                    System.out.println(formatResult(registry.runLine(line)));
                }
            }
        }, "jserver-stdin");
        t.setDaemon(true);
        t.start();
    }

    private static String formatResult(Map<String, Object> payload) {
        if (Boolean.FALSE.equals(payload.get("ok"))) {
            Object err = payload.getOrDefault("error", "失败");
            Object available = payload.get("available");
            if (available instanceof List<?> list && !list.isEmpty()) {
                return "✗ " + err + "\n  可用: " + String.join(", ", list.stream().map(String::valueOf).toList());
            }
            return "✗ " + err;
        }
        return String.valueOf(payload);
    }
}
