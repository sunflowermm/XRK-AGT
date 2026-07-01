<?php
declare(strict_types=1);

require_once __DIR__ . '/plugin_kit.php';

final class CommandRegistry {
    /** @var array<string, array> */
    private static array $groups = [];

    public static function register(array $entry): void {
        $group = $entry['group'] ?? '';
        if ($group !== '') self::$groups[$group] = $entry;
    }

    /** @return list<string> */
    public static function groups(): array {
        $keys = array_keys(self::$groups);
        sort($keys);
        return $keys;
    }

    public static function listHelp(): array {
        $items = [];
        foreach (self::groups() as $name) {
            $g = self::$groups[$name];
            $cmds = array_keys($g['commands'] ?? []);
            $cmds[] = 'update';
            $cmds[] = 'help';
            sort($cmds);
            $items[] = ['group' => $name, 'description' => $g['description'] ?? '', 'commands' => $cmds];
        }
        return ['groups' => $items, 'count' => count($items)];
    }

    public static function dispatch(string $group, string $cmd, array $args = []): array {
        if (!isset(self::$groups[$group])) {
            return ['ok' => false, 'error' => "未知插件组: {$group}", 'available' => self::groups()];
        }
        return dispatch_plugin_command(self::$groups[$group], $group, $cmd, $args);
    }

    public static function runLine(string $line): array {
        $line = trim($line);
        if ($line === '') return ['ok' => false, 'error' => '空命令'];
        $lower = strtolower($line);
        if ($lower === 'help' || $lower === '?') {
            $out = self::listHelp();
            $out['ok'] = true;
            $out['hint'] = '用法: <组名> <命令> [参数...]';
            return $out;
        }
        if ($lower === 'list' || $lower === 'groups') {
            return ['ok' => true, 'groups' => self::groups()];
        }
        $parts = preg_split('/\s+/', $line) ?: [];
        return self::dispatch($parts[0] ?? '', $parts[1] ?? 'help', array_slice($parts, 2));
    }

    public static function apiList(): array {
        $out = [];
        foreach (self::groups() as $name) {
            $g = self::$groups[$name];
            $out[] = [
                'name' => $g['name'] ?? $name,
                'description' => $g['description'] ?? '',
                'group' => $name,
                'routes_count' => count($g['routes'] ?? []),
            ];
        }
        return $out;
    }
}
