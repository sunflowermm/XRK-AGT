package com.xrk.subserver.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;

public final class CommandRegistry {

    private static final Map<String, String> TOP_ALIASES = Map.of(
            "帮助", "help",
            "列表", "list",
            "组", "list"
    );
    private static final Map<String, String> CMD_ALIASES = Map.of(
            "状态", "status",
            "更新", "update",
            "同步", "sync",
            "帮助", "help"
    );

    public static boolean isExitLine(String line) {
        if (line == null) return false;
        String t = line.trim();
        String lower = t.toLowerCase();
        return lower.equals("exit") || lower.equals("quit") || lower.equals("q")
                || t.equals("退出") || t.equals("离开");
    }

    private static String normalizeCliLine(String line) {
        if (line == null) return "";
        String[] parts = line.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) return line.trim();
        if (TOP_ALIASES.containsKey(parts[0])) {
            parts[0] = TOP_ALIASES.get(parts[0]);
        } else if (parts.length >= 2 && CMD_ALIASES.containsKey(parts[1])) {
            parts[1] = CMD_ALIASES.get(parts[1]);
        }
        return String.join(" ", parts);
    }

    public record PluginSet(
            String group,
            String description,
            String pluginDir,
            Map<String, Function<List<String>, Map<String, Object>>> commands
    ) {}

    private final Map<String, PluginSet> groups = new HashMap<>();

    public void register(PluginSet set) {
        if (set.group() == null || set.group().isBlank()) return;
        groups.put(set.group(), set);
    }

    public List<String> groups() {
        return groups.keySet().stream().sorted().toList();
    }

    public Map<String, Object> listHelp() {
        List<Map<String, Object>> items = new ArrayList<>();
        for (String name : groups()) {
            PluginSet g = groups.get(name);
            List<String> cmds = new ArrayList<>(commandNames(g));
            items.add(Map.of(
                    "group", name,
                    "description", g.description() == null ? "" : g.description(),
                    "commands", cmds
            ));
        }
        return Map.of("groups", items, "count", items.size());
    }

    public Map<String, Object> runLine(String line) {
        line = normalizeCliLine(line);
        if (line.isEmpty()) return Map.of("ok", false, "error", "空命令");
        String lower = line.toLowerCase();
        if (lower.equals("help") || lower.equals("?")) {
            Map<String, Object> out = new HashMap<>(listHelp());
            out.put("ok", true);
            out.put("hint", "用法: <组名> <命令> [参数...]");
            return out;
        }
        if (lower.equals("list") || lower.equals("groups")) {
            return Map.of("ok", true, "groups", groups());
        }
        String[] parts = line.split("\\s+");
        String group = parts[0];
        String cmd = parts.length > 1 ? parts[1] : "help";
        List<String> args = parts.length > 2 ? List.of(parts).subList(2, parts.length) : List.of();
        return dispatch(group, cmd, args);
    }

    public Map<String, Object> dispatch(String group, String cmd, List<String> args) {
        PluginSet g = groups.get(group);
        if (g == null) {
            return Map.of("ok", false, "error", "未知插件组: " + group, "available", groups());
        }
        cmd = cmd == null ? "help" : cmd.trim().toLowerCase();
        if (cmd.isEmpty() || cmd.equals("help")) {
            return Map.of("ok", true, "group", group, "commands", commandNames(g));
        }
        if (cmd.equals("update")) {
            Map<String, Object> result = PluginKit.defaultPluginUpdate(g.pluginDir());
            return Map.of("ok", result.get("ok"), "group", group, "result", result);
        }
        var handler = g.commands().get(cmd);
        if (handler == null) {
            return Map.of(
                    "ok", false, "error", "未知命令: " + cmd, "group", group,
                    "available", commandNames(g)
            );
        }
        Map<String, Object> res = new HashMap<>(handler.apply(args == null ? List.of() : args));
        res.putIfAbsent("ok", true);
        res.put("group", group);
        return res;
    }

    public Map<String, Object> apiList() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String name : groups()) {
            PluginSet g = groups.get(name);
            out.add(Map.of(
                    "name", name,
                    "description", g.description() == null ? "" : g.description(),
                    "group", name
            ));
        }
        return out;
    }

    public Map<String, Object> groupHealth(String group) {
        PluginSet g = groups.get(group);
        if (g == null) {
            return Map.of("ok", false, "error", "未知插件组: " + group);
        }
        return Map.of(
                "ok", true,
                "group", group,
                "name", group,
                "commands", commandNames(g)
        );
    }

    private static List<String> commandNames(PluginSet g) {
        TreeMap<String, Boolean> sorted = new TreeMap<>();
        sorted.put("help", true);
        sorted.put("update", true);
        if (g.commands() != null) g.commands().keySet().forEach(k -> sorted.put(k, true));
        return new ArrayList<>(sorted.keySet());
    }
}
