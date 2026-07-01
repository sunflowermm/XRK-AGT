package com.xrk.subserver.core;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.Scanner;

@Component
public class StdinCommandRunner implements ApplicationRunner {

    private final CommandRegistry registry;

    public StdinCommandRunner(CommandRegistry registry) {
        this.registry = registry;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (System.console() == null) return;

        Thread t = new Thread(() -> {
            System.out.println("\n[Java 子服务] 终端命令已就绪 · 输入 help 或 list");
            String prompt = "java> ";
            try (Scanner sc = new Scanner(System.in)) {
                while (true) {
                    System.out.print(prompt);
                    if (!sc.hasNextLine()) break;
                    String line = sc.nextLine().trim();
                    if (line.isEmpty()) continue;
                    if (line.equals("exit") || line.equals("quit")) {
                        System.out.println("[Java 子服务] 终端命令已退出（HTTP 继续）");
                        break;
                    }
                    System.out.println(registry.runLine(line));
                }
            }
        }, "jserver-stdin");
        t.setDaemon(true);
        t.start();
    }
}
