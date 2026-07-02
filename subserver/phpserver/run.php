<?php
declare(strict_types=1);

require_once __DIR__ . '/core/plugin_kit.php';
require_once __DIR__ . '/core/stdin_loop.php';

$cfg = load_runtime_config();
$host = getenv('HOST') ?: ($cfg['server']['host'] ?? '0.0.0.0');
$port = getenv('PORT') ?: (string)($cfg['server']['port'] ?? 8002);
$addr = $host . ':' . $port;
$router = __DIR__ . '/server.php';
$serverCmd = escapeshellarg(PHP_BINARY) . ' -S ' . escapeshellarg($addr) . ' ' . escapeshellarg($router);

$stdinEnabled = (bool)($cfg['server']['stdin']['enabled'] ?? true);
$interactive = function_exists('stream_isatty') && stream_isatty(STDIN);

if ($stdinEnabled && $interactive) {
    if (PHP_OS_FAMILY === 'Windows') {
        pclose(popen('cmd /c start /B "" ' . $serverCmd . ' 2>nul', 'r'));
    } else {
        exec($serverCmd . ' > /dev/null 2>&1 &');
    }
    usleep(400000);
    fwrite(STDOUT, "──────────────────────────────────────\n");
    fwrite(STDOUT, "🌐 PHP 子服务  http://{$addr}\n");
    fwrite(STDOUT, "──────────────────────────────────────\n");
    run_stdin_loop($cfg);
    exit(0);
}

passthru($serverCmd);
