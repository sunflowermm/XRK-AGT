<?php
declare(strict_types=1);

$pluginDir = __DIR__;
require_once __DIR__ . '/../../core/plugin_kit.php';

$config = load_plugin_config($pluginDir, 'string-tools', ['maxLength' => 500000]);

return [
    'name' => 'string-tools',
    'description' => '字符串 trim / 长度 / 分割 / 合并',
    'group' => 'string-tools',
    'pluginDir' => $pluginDir,
    'priority' => 150,
    'commands' => [
        'status' => fn () => ['service' => 'string-tools', 'maxLength' => $config['maxLength'] ?? 500000],
    ],
    'routes' => [
        [
            'method' => 'POST',
            'path' => '/api/string-tools/trim',
            'handler' => function () {
                $body = read_json_body();
                json_response(200, ['ok' => true, 'text' => trim((string)($body['text'] ?? ''))]);
            },
        ],
        [
            'method' => 'POST',
            'path' => '/api/string-tools/length',
            'handler' => function () {
                $body = read_json_body();
                $text = (string)($body['text'] ?? '');
                json_response(200, ['ok' => true, 'length' => mb_strlen($text, 'UTF-8')]);
            },
        ],
        [
            'method' => 'POST',
            'path' => '/api/string-tools/split',
            'handler' => function () {
                $body = read_json_body();
                $text = (string)($body['text'] ?? '');
                $sep = (string)($body['separator'] ?? ',');
                json_response(200, ['ok' => true, 'parts' => $sep === '' ? str_split($text) : explode($sep, $text)]);
            },
        ],
        [
            'method' => 'POST',
            'path' => '/api/string-tools/join',
            'handler' => function () {
                $body = read_json_body();
                $parts = $body['parts'] ?? [];
                if (!is_array($parts)) {
                    json_response(400, ['ok' => false, 'error' => 'parts 必须为数组']);
                    return;
                }
                $sep = (string)($body['separator'] ?? ',');
                json_response(200, ['ok' => true, 'text' => implode($sep, array_map('strval', $parts))]);
            },
        ],
    ],
];
