<?php
declare(strict_types=1);

require_once __DIR__ . '/core/loader.php';

$cfg = load_runtime_config();
ApiLoader::loadAll();
mount_system_routes($cfg);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (ApiLoader::dispatch($method, $path)) exit;

json_response(404, ['ok' => false, 'error' => 'Not Found']);
