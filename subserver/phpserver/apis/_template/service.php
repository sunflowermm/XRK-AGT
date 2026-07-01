<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/plugin_kit.php';

$pluginDir = __DIR__;
return [
    'name' => 'my-plugin',
    'description' => '我的 PHP 插件',
    'group' => 'my-plugin',
    'pluginDir' => $pluginDir,
    'priority' => 100,
    'commands' => [
        'status' => fn () => ['service' => 'my-plugin', 'ready' => true],
    ],
    'routes' => [
        [
            'method' => 'GET',
            'path' => '/api/my-plugin/hello',
            'handler' => fn () => json_response(200, ['ok' => true, 'message' => 'hello']),
        ],
    ],
];
