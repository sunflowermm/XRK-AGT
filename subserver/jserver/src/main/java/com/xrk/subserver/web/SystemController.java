package com.xrk.subserver.web;

import com.xrk.subserver.core.CommandRegistry;
import com.xrk.subserver.core.PluginKit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
public class SystemController {

    private final CommandRegistry registry;

    public SystemController(CommandRegistry registry) {
        this.registry = registry;
    }

    @GetMapping("/")
    public Map<String, Object> root() {
        return Map.of(
                "name", "XRK-AGT Java 子服务端",
                "runtime", "jserver",
                "version", "1.0.0",
                "status", "running"
        );
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "healthy", "runtime", "jserver");
    }

    @RequestMapping(value = "/health", method = RequestMethod.HEAD)
    public void healthHead() {}

    @GetMapping("/api/list")
    public Map<String, Object> apiList() {
        return Map.of("apis", registry.apiList(), "count", registry.apiList().size(), "runtime", "jserver");
    }

    @GetMapping("/api/system/ping")
    public Map<String, Object> ping() {
        return Map.of("ok", true, "service", "jserver-core");
    }

    @GetMapping("/api/system/config")
    public Map<String, Object> config() {
        return Map.of("runtime", "jserver", "server", Map.of("port", 8003));
    }

    @GetMapping("/api/system/groups")
    public Map<String, Object> groups() {
        Map<String, Object> out = new HashMap<>(registry.listHelp());
        out.put("ok", true);
        return out;
    }

    @PostMapping("/api/system/command")
    public Map<String, Object> command(@RequestBody Map<String, Object> body) {
        String line = body.get("line") != null ? String.valueOf(body.get("line")).trim() : "";
        if (line.isEmpty() && body.get("group") != null) {
            StringBuilder sb = new StringBuilder(String.valueOf(body.get("group")));
            if (body.get("command") != null) sb.append(" ").append(body.get("command"));
            if (body.get("args") instanceof List<?> list) list.forEach(x -> sb.append(" ").append(x));
            line = sb.toString().trim();
        }
        if (line.isEmpty()) line = "help";
        return registry.runLine(line);
    }

    @GetMapping("/api/{group}/health")
    public Map<String, Object> groupHealth(@PathVariable String group) {
        return registry.dispatch(group, "help", List.of());
    }

    @PostMapping("/api/{group}/command")
    public ResponseEntity<Map<String, Object>> groupCommand(
            @PathVariable String group,
            @RequestBody Map<String, Object> body
    ) {
        Map<String, Object> parsed = PluginKit.parseCommandBody(body, group);
        Map<String, Object> result = registry.dispatch(
                group,
                String.valueOf(parsed.get("cmd")),
                (List<String>) parsed.get("args")
        );
        boolean ok = !Boolean.FALSE.equals(result.get("ok"));
        return ResponseEntity.status(ok ? 200 : 400).body(result);
    }
}
