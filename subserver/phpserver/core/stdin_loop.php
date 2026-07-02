<?php
declare(strict_types=1);

require_once __DIR__ . '/command_registry.php';
require_once __DIR__ . '/plugin_kit.php';
require_once __DIR__ . '/loader.php';

function format_stdin_result(array $payload): string {
    if (($payload['ok'] ?? null) === false) {
        $err = $payload['error'] ?? $payload['detail'] ?? '失败';
        if (!empty($payload['available']) && is_array($payload['available'])) {
            return '✗ ' . $err . "\n  可用: " . implode(', ', $payload['available']);
        }
        return '✗ ' . $err;
    }
    if (isset($payload['groups'], $payload['count'])) {
        $lines = ['插件组:'];
        foreach ($payload['groups'] as $item) {
            $cmds = implode(', ', $item['commands'] ?? []);
            $lines[] = sprintf('  · %s — %s [%s]', $item['group'], $item['description'] ?? '', $cmds);
        }
        if (!empty($payload['hint'])) $lines[] = (string)$payload['hint'];
        return implode("\n", $lines);
    }
    if (isset($payload['groups']) && is_array($payload['groups']) && !isset($payload['count'])) {
        return '已注册: ' . implode(', ', $payload['groups']);
    }
    return json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) ?: '';
}

function run_stdin_loop(array $cfg): void {
    if (!($cfg['server']['stdin']['enabled'] ?? true)) return;
    if (!function_exists('stream_isatty') || !stream_isatty(STDIN)) return;

    ApiLoader::loadAll();
    $prompt = $cfg['server']['stdin']['prompt'] ?? '子服> ';
    fwrite(STDOUT, "\n[子服] 终端命令已就绪 · 输入 帮助 或 list\n");

    while (true) {
        fwrite(STDOUT, $prompt);
        $line = trim(fgets(STDIN) ?: '');
        if ($line === '') continue;
        if (is_exit_line($line)) {
            fwrite(STDOUT, "[子服] 终端已关闭（HTTP 继续运行）\n");
            break;
        }
        fwrite(STDOUT, format_stdin_result(CommandRegistry::runLine($line)) . "\n");
    }
}
