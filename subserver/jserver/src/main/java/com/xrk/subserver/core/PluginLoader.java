package com.xrk.subserver.core;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class PluginLoader {

    @Bean
    CommandRegistry commandRegistry(List<SubserverPlugin> plugins) {
        CommandRegistry registry = new CommandRegistry();
        plugins.forEach(p -> p.register(registry));
        return registry;
    }
}
