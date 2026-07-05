package com.xrk.subserver.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

@Component
public class RuntimeConfig {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String host = "0.0.0.0";
    private int port = 8003;
    private boolean stdinEnabled = true;
    private String stdinPrompt = "子服> ";

    @PostConstruct
    void load() {
        mergeFile(Path.of("config", "default_config.json"));
        Path dataDir = resolveDataDir();
        try {
            Files.createDirectories(dataDir);
        } catch (Exception ignored) {
        }
        Path runtime = dataDir.resolve("config.json");
        if (!Files.isRegularFile(runtime)) {
            Path defaults = Path.of("config", "default_config.json");
            if (Files.isRegularFile(defaults)) {
                try {
                    Files.copy(defaults, runtime);
                } catch (Exception ignored) {
                }
            }
        }
        mergeFile(runtime);

        String envPort = System.getenv("PORT");
        if (envPort != null && !envPort.isBlank()) {
            try {
                port = Integer.parseInt(envPort.trim());
            } catch (NumberFormatException ignored) {
            }
        }
        String envHost = System.getenv("HOST");
        if (envHost != null && !envHost.isBlank()) {
            host = envHost.trim();
        }
    }

    public Map<String, Object> serverView() {
        Map<String, Object> stdin = new HashMap<>();
        stdin.put("enabled", stdinEnabled);
        stdin.put("prompt", stdinPrompt);
        Map<String, Object> server = new HashMap<>();
        server.put("host", host);
        server.put("port", port);
        server.put("stdin", stdin);
        Map<String, Object> out = new HashMap<>();
        out.put("runtime", "jserver");
        out.put("server", server);
        return out;
    }

    public boolean stdinEnabled() {
        return stdinEnabled;
    }

    public String stdinPrompt() {
        return stdinPrompt == null || stdinPrompt.isBlank() ? "子服> " : stdinPrompt;
    }

    private void mergeFile(Path path) {
        if (!Files.isRegularFile(path)) return;
        try {
            JsonNode root = MAPPER.readTree(path.toFile());
            JsonNode server = root.get("server");
            if (server == null) return;
            if (server.hasNonNull("host")) host = server.get("host").asText(host);
            if (server.has("port")) port = server.get("port").asInt(port);
            JsonNode stdin = server.get("stdin");
            if (stdin != null) {
                if (stdin.has("enabled")) stdinEnabled = stdin.get("enabled").asBoolean(stdinEnabled);
                if (stdin.hasNonNull("prompt")) stdinPrompt = stdin.get("prompt").asText(stdinPrompt);
            }
        } catch (Exception ignored) {
        }
    }

    private static Path resolveDataDir() {
        for (String candidate : new String[]{
                "../../data/jserver",
                "data/jserver"
        }) {
            Path p = Path.of(candidate).normalize();
            if (Files.exists(p.getParent()) || Files.isDirectory(p)) {
                return p.toAbsolutePath().normalize();
            }
        }
        return Path.of("../../data/jserver").toAbsolutePath().normalize();
    }
}
