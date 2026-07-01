package com.xrk.subserver.core;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class PluginKit {

    private PluginKit() {}

    public static Map<String, Object> defaultPluginUpdate(String pluginDir) {
        List<Map<String, Object>> steps = new ArrayList<>();
        if (pluginDir != null && !pluginDir.isBlank()) {
            steps.add(gitPull(Path.of(pluginDir)));
            Path pom = Path.of(pluginDir, "pom.xml");
            if (Files.isRegularFile(pom)) {
                steps.add(run("mvn -f " + pom.toAbsolutePath() + " -q dependency:resolve"));
            } else {
                steps.add(Map.of("ok", true, "skipped", "no pom.xml in plugin dir"));
            }
        } else {
            steps.add(gitPull(Path.of(".")));
            Path rootPom = Path.of("pom.xml");
            if (Files.isRegularFile(rootPom)) {
                steps.add(run("mvn -q dependency:resolve"));
            } else {
                steps.add(Map.of("ok", true, "skipped", "no pom.xml"));
            }
        }
        boolean ok = steps.stream().allMatch(s -> Boolean.TRUE.equals(s.get("ok")) || s.containsKey("skipped"));
        return Map.of(
                "ok", ok,
                "plugin", pluginDir == null || pluginDir.isBlank() ? "jserver" : Path.of(pluginDir).getFileName().toString(),
                "steps", steps
        );
    }

    private static Map<String, Object> gitPull(Path dir) {
        Path git = dir.resolve(".git");
        if (!Files.isDirectory(git)) {
            return Map.of("ok", true, "skipped", "not a git repo");
        }
        Map<String, Object> step = run("git -C \"" + dir.toAbsolutePath() + "\" pull --ff-only");
        step.put("action", "git_pull");
        return step;
    }

    private static Map<String, Object> run(String cmd) {
        try {
            Process p = Runtime.getRuntime().exec(cmd);
            int code = p.waitFor();
            String out = new String(p.getInputStream().readAllBytes());
            String err = new String(p.getErrorStream().readAllBytes());
            Map<String, Object> m = new HashMap<>();
            m.put("ok", code == 0);
            m.put("cmd", cmd);
            m.put("stdout", out.trim());
            m.put("stderr", err.trim());
            m.put("code", code);
            return m;
        } catch (Exception e) {
            return Map.of("ok", false, "cmd", cmd, "error", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseCommandBody(Map<String, Object> body, String group) {
        String cmd = str(body.get("cmd"));
        if (cmd.isEmpty()) cmd = str(body.get("command"));
        List<String> args = new ArrayList<>();
        Object rawArgs = body.get("args");
        if (rawArgs instanceof List<?> list) {
            list.forEach(x -> args.add(String.valueOf(x)));
        } else if (rawArgs instanceof String s && !s.isBlank()) {
            for (String p : s.split("\\s+")) args.add(p);
        }
        String line = str(body.get("line"));
        if (!line.isEmpty() && cmd.isEmpty()) {
            String[] parts = line.trim().split("\\s+");
            int i = 0;
            if (parts.length > 0 && parts[0].equals(group)) i = 1;
            if (parts.length > i) cmd = parts[i++];
            for (; i < parts.length; i++) args.add(parts[i]);
        }
        if (cmd.isEmpty()) cmd = "help";
        return Map.of("cmd", cmd, "args", args);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }
}
