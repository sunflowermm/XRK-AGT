package com.xrk.subserver.core;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** 对齐 pyserver default 字典；实现类注册 commands 并自行暴露 @RestController 路由 */
public interface SubserverPlugin {

    String group();

    String description();

    default String pluginDir() {
        return "";
    }

    default Map<String, Function<List<String>, Map<String, Object>>> commands() {
        return Map.of(
                "status", args -> Map.of("service", group(), "runtime", "java")
        );
    }

    default void register(CommandRegistry registry) {
        registry.register(new CommandRegistry.PluginSet(
                group(), description(), pluginDir(), commands()
        ));
    }
}
