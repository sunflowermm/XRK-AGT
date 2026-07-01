<?php
declare(strict_types=1);

require_once __DIR__ . '/core/command_registry.php';
require_once __DIR__ . '/core/plugin_kit.php';
require_once __DIR__ . '/core/loader.php';

$cfg = load_runtime_config();
ApiLoader::loadAll();

if (!($cfg['server']['stdin']['enabled'] ?? false)) {
    fwrite(STDERR, "stdin 未启用，见 config server.stdin.enabled\n");
    exit(1);
}

$prompt = $cfg['server']['stdin']['prompt'] ?? 'php> ';
fwrite(STDOUT, "\n[PHP 子服务] 终端命令已就绪 · 输入 help 或 list\n");

while (true) {
    fwrite(STDOUT, $prompt);
    $line = trim(fgets(STDIN) ?: '');
    if ($line === '') continue;
    if ($line === 'exit' || $line === 'quit') {
        fwrite(STDOUT, "[PHP 子服务] 终端命令已退出\n");
        break;
    }
    fwrite(STDOUT, json_encode(CommandRegistry::runLine($line), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
}
