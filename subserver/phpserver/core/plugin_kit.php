<?php
declare(strict_types=1);

function repo_root(): string {
    return realpath(__DIR__ . '/../..') ?: dirname(__DIR__, 2);
}

function load_runtime_config(): array {
    $dir = repo_root() . '/data/phpserver';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $runtime = $dir . '/config.json';
    $default = __DIR__ . '/../config/default_config.json';
    if (!file_exists($runtime) && file_exists($default)) copy($default, $runtime);
    $cfg = file_exists($default) ? (json_decode(file_get_contents($default) ?: '{}', true) ?: []) : [];
    if (file_exists($runtime)) {
        $user = json_decode(file_get_contents($runtime) ?: '{}', true) ?: [];
        $cfg = array_replace_recursive($cfg, $user);
    }
    return $cfg;
}

function json_response(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
}

function read_json_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    if (trim($raw) === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function load_plugin_config(string $pluginDir, string $dataName, array $defaults = []): array {
    $runtime = repo_root() . '/data/' . $dataName . '/config.json';
    $def = $pluginDir . '/default_config.json';
    if (!is_dir(dirname($runtime))) mkdir(dirname($runtime), 0755, true);
    if (!file_exists($runtime)) {
        if (file_exists($def)) copy($def, $runtime);
        else file_put_contents($runtime, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
    $base = file_exists($def) ? (json_decode(file_get_contents($def) ?: '{}', true) ?: []) : $defaults;
    $user = json_decode(file_get_contents($runtime) ?: '{}', true) ?: [];
    return array_merge($base, $user);
}

function default_plugin_update(string $pluginDir): array {
    $steps = [];
    if (file_exists($pluginDir . '/composer.json')) {
        $cmd = 'composer install --no-dev --working-dir=' . escapeshellarg($pluginDir);
        exec($cmd, $out, $code);
        $steps[] = ['ok' => $code === 0, 'action' => 'composer_install', 'output' => implode("\n", $out)];
    } else {
        $steps[] = ['ok' => true, 'skipped' => 'no composer.json'];
    }
    $ok = true;
    foreach ($steps as $s) {
        if (isset($s['ok']) && $s['ok'] === false) $ok = false;
    }
    return ['ok' => $ok, 'plugin' => basename($pluginDir), 'steps' => $steps];
}

function dispatch_plugin_command(array $entry, string $group, string $cmd, array $args): array {
    $cmd = strtolower(trim($cmd));
    if ($cmd === 'help' || $cmd === '') {
        $cmds = array_keys($entry['commands'] ?? []);
        $cmds[] = 'update';
        sort($cmds);
        return ['ok' => true, 'group' => $group, 'commands' => $cmds];
    }
    if ($cmd === 'update') {
        $onUpdate = $entry['onUpdate'] ?? null;
        if (is_callable($onUpdate)) $result = $onUpdate($args);
        elseif (!empty($entry['pluginDir'])) $result = default_plugin_update($entry['pluginDir']);
        else return ['ok' => false, 'error' => '未配置更新逻辑'];
        return ['ok' => (bool)($result['ok'] ?? true), 'group' => $group, 'result' => $result];
    }
    $handler = $entry['commands'][$cmd] ?? null;
    if (!is_callable($handler)) {
        $cmds = array_keys($entry['commands'] ?? []);
        $cmds[] = 'update';
        return ['ok' => false, 'error' => "未知命令: {$cmd}", 'group' => $group, 'available' => $cmds];
    }
    $data = $handler($args);
    if (is_array($data)) {
        $data['ok'] = $data['ok'] ?? true;
        $data['group'] = $group;
        return $data;
    }
    return ['ok' => true, 'group' => $group, 'data' => $data];
}
