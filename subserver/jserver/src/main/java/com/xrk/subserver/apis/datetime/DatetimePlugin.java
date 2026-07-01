package com.xrk.subserver.apis.datetime;

import com.xrk.subserver.core.SubserverPlugin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@RestController
@RequestMapping("/api/datetime-tools")
public class DatetimePlugin implements SubserverPlugin {

    @Override
    public String group() {
        return "datetime-tools";
    }

    @Override
    public String description() {
        return "时间戳与格式化";
    }

    @Override
    public String pluginDir() {
        return "";
    }

    @PostMapping("/now")
    public Map<String, Object> now(@RequestBody(required = false) Map<String, Object> body) {
        String zone = body != null && body.get("zone") != null ? String.valueOf(body.get("zone")) : "UTC";
        Instant instant = Instant.now();
        return Map.of(
                "ok", true,
                "iso", instant.toString(),
                "epoch_ms", instant.toEpochMilli(),
                "zone", zone
        );
    }

    @PostMapping("/format")
    public Map<String, Object> format(@RequestBody Map<String, Object> body) {
        String pattern = body.get("pattern") != null ? String.valueOf(body.get("pattern")) : "yyyy-MM-dd HH:mm:ss";
        String zone = body.get("zone") != null ? String.valueOf(body.get("zone")) : "Asia/Shanghai";
        var formatter = DateTimeFormatter.ofPattern(pattern).withZone(ZoneId.of(zone));
        String formatted = formatter.format(Instant.now());
        return Map.of("ok", true, "formatted", formatted, "pattern", pattern, "zone", zone);
    }
}
