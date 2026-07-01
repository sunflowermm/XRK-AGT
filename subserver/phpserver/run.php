<?php
declare(strict_types=1);

require_once __DIR__ . '/core/plugin_kit.php';

$cfg = load_runtime_config();
$host = getenv('HOST') ?: ($cfg['server']['host'] ?? '0.0.0.0');
$port = getenv('PORT') ?: (string)($cfg['server']['port'] ?? 8002);
$addr = $host . ':' . $port;
passthru('php -S ' . escapeshellarg($addr) . ' server.php');
