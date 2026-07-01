package com.xrk.subserver.apis.example;

import com.xrk.subserver.core.SubserverPlugin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 复制到 src/main/java/com/xrk/subserver/apis/&lt;组名&gt;/，改 group、路径与 handler。
 * Spring 会自动扫描 @RestController，无需改 PluginLoader。
 */
@RestController
@RequestMapping("/api/example-tools")
public class ExamplePlugin implements SubserverPlugin {

    @Override
    public String group() {
        return "example-tools";
    }

    @Override
    public String description() {
        return "示例插件（复制后改名）";
    }

    @Override
    public String pluginDir() {
        return "apis/example-tools";
    }

    @PostMapping("/ping")
    public Map<String, Object> ping(@RequestBody(required = false) Map<String, Object> body) {
        return Map.of("ok", true, "message", "pong", "input", body != null ? body : Map.of());
    }
}
