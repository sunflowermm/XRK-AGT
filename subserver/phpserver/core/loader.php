<?php
declare(strict_types=1);

require_once __DIR__ . '/command_registry.php';

final class ApiLoader {
    /** @var array<string, callable> */
    private static array $routes = [];

    public static function add(string $method, string $path, callable $handler): void {
        self::$routes[strtoupper($method) . ' ' . $path] = $handler;
    }

    public static function mountPlugin(array $entry): void {
        if (($entry['init'] ?? null) && is_callable($entry['init'])) ($entry['init'])();
        CommandRegistry::register($entry);
        $group = $entry['group'];
        $name = $entry['name'] ?? $group;

        self::add('GET', "/api/{$group}/health", function () use ($entry, $group, $name) {
            $cmds = array_keys($entry['commands'] ?? []);
            $cmds[] = 'update';
            sort($cmds);
            json_response(200, ['ok' => true, 'group' => $group, 'name' => $name, 'commands' => $cmds]);
        });

        self::add('POST', "/api/{$group}/command", function () use ($group) {
            $body = read_json_body();
            $cmd = trim((string)($body['cmd'] ?? $body['command'] ?? ''));
            $args = $body['args'] ?? [];
            if (is_string($args)) $args = preg_split('/\s+/', $args) ?: [];
            $line = (string)($body['line'] ?? '');
            if ($line !== '' && $cmd === '') {
                $parts = preg_split('/\s+/', trim($line)) ?: [];
                if (($parts[0] ?? '') === $group) array_shift($parts);
                $cmd = $parts[0] ?? 'help';
                $args = array_slice($parts, 1);
            }
            if ($cmd === '') $cmd = 'help';
            $result = CommandRegistry::dispatch($group, $cmd, is_array($args) ? $args : []);
            json_response(($result['ok'] ?? true) ? 200 : 400, $result);
        });

        foreach ($entry['routes'] ?? [] as $route) {
            self::add($route['method'] ?? 'GET', $route['path'], $route['handler']);
        }
    }

    public static function loadAll(): void {
        $apisDir = __DIR__ . '/../apis';
        if (!is_dir($apisDir)) return;
        foreach (scandir($apisDir) ?: [] as $dir) {
            if ($dir === '.' || $dir === '..' || str_starts_with($dir, '_')) continue;
            $groupDir = $apisDir . '/' . $dir;
            if (!is_dir($groupDir)) continue;
            foreach (glob($groupDir . '/*.php') ?: [] as $file) {
                if (str_starts_with(basename($file), '_')) continue;
                $entry = require $file;
                if (is_array($entry)) self::mountPlugin($entry);
            }
        }
    }

    public static function dispatch(string $method, string $path): bool {
        $key = strtoupper($method) . ' ' . $path;
        if (!isset(self::$routes[$key])) return false;
        (self::$routes[$key])();
        return true;
    }
}

function mount_system_routes(array $cfg): void {
    ApiLoader::add('GET', '/api/system/ping', fn () => json_response(200, ['ok' => true, 'service' => 'phpserver-core']));
    ApiLoader::add('GET', '/api/system/config', function () use ($cfg) {
        json_response(200, [
            'server' => $cfg['server'] ?? [],
            'runtime' => 'phpserver',
        ]);
    });
    ApiLoader::add('GET', '/api/system/groups', function () {
        $out = CommandRegistry::listHelp();
        $out['ok'] = true;
        json_response(200, $out);
    });
    ApiLoader::add('POST', '/api/system/command', function () {
        $body = read_json_body();
        $line = trim((string)($body['line'] ?? $body['cmd'] ?? ''));
        if ($line === '' && !empty($body['group'])) {
            $line = $body['group'] . ' ' . ($body['command'] ?? 'help');
            if (!empty($body['args']) && is_array($body['args'])) $line .= ' ' . implode(' ', $body['args']);
        }
        if ($line === '') $line = 'help';
        json_response(200, CommandRegistry::runLine($line));
    });
    ApiLoader::add('GET', '/', fn () => json_response(200, [
        'name' => 'XRK-AGT PHP 子服务端', 'runtime' => 'phpserver', 'version' => '1.0.0', 'status' => 'running',
    ]));
    ApiLoader::add('GET', '/health', fn () => json_response(200, ['status' => 'healthy', 'runtime' => 'phpserver']));
    ApiLoader::add('HEAD', '/health', function () { http_response_code(200); });
    ApiLoader::add('GET', '/api/list', fn () => json_response(200, [
        'apis' => CommandRegistry::apiList(), 'count' => count(CommandRegistry::apiList()), 'runtime' => 'phpserver',
    ]));
}
