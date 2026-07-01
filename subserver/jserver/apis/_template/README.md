# Java 插件模板

1. 复制 `ExamplePlugin.java` 到 `src/main/java/com/xrk/subserver/apis/<组名>/`
2. 改 `group()`、`@RequestMapping("/api/<组名>")`、`pluginDir()` 与各 `@PostMapping` 路由
3. 重启 jserver（`mvn spring-boot:run`）

Spring 自动扫描 `@RestController`，**无需**改 `PluginLoader`。

命令行：`#子服 @java <组名> status`
