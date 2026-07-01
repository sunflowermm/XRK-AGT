package com.xrk.subserver.apis.json;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.xrk.subserver.core.SubserverPlugin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/json-tools")
public class JsonToolsPlugin implements SubserverPlugin {

    private final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    @Override
    public String group() {
        return "json-tools";
    }

    @Override
    public String description() {
        return "JSON 格式化与校验";
    }

    @Override
    public String pluginDir() {
        return "";
    }

    @PostMapping("/format")
    public Map<String, Object> format(@RequestBody Map<String, Object> body) throws Exception {
        String text = body.get("text") != null ? String.valueOf(body.get("text")) : "";
        if (text.isBlank()) {
            return Map.of("ok", false, "error", "需要 text");
        }
        JsonNode node = mapper.readTree(text);
        return Map.of("ok", true, "formatted", mapper.writeValueAsString(node));
    }

    @PostMapping("/validate")
    public Map<String, Object> validate(@RequestBody Map<String, Object> body) {
        String text = body.get("text") != null ? String.valueOf(body.get("text")) : "";
        if (text.isBlank()) {
            return Map.of("ok", false, "error", "需要 text");
        }
        try {
            JsonNode node = mapper.readTree(text);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("valid", true);
            out.put("type", node.getNodeType().name().toLowerCase());
            return out;
        } catch (Exception e) {
            return Map.of("ok", true, "valid", false, "error", e.getMessage());
        }
    }

    @PostMapping("/keys")
    public Map<String, Object> keys(@RequestBody Map<String, Object> body) throws Exception {
        String text = body.get("text") != null ? String.valueOf(body.get("text")) : "";
        if (text.isBlank()) {
            return Map.of("ok", false, "error", "需要 text");
        }
        JsonNode node = mapper.readTree(text);
        if (!node.isObject()) {
            return Map.of("ok", false, "error", "根节点须为 JSON 对象");
        }
        List<String> keys = new java.util.ArrayList<>();
        node.fieldNames().forEachRemaining(keys::add);
        return Map.of("ok", true, "keys", keys, "count", keys.size());
    }
}
