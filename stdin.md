# XRK-Yunzai 开放接口文档

XRK-Yunzai 是一个基于 Node.js 的机器人框架，提供了强大的 API 接口，允许开发者通过 HTTP 请求与机器人进行交互。本文档将详细介绍 XRK-Yunzai 的开放接口，包括接口的使用方法、参数说明、返回值格式、调用示例以及兼容性说明。文档旨在帮助开发者快速上手并将内容部署到 GitCode 等平台，支持部分 HTML 格式以增强可读性。

---

## 目录

1. [概述](#概述)
2. [API 鉴权](#api-鉴权)
3. [API 列表](#api-列表)
   - [执行命令](#执行命令)
   - [发送消息](#发送消息)
   - [触发事件](#触发事件)
   - [获取机器人状态](#获取机器人状态)
   - [文件上传与下载](#文件上传与下载)
4. [UserInfo 参数说明](#userinfo-参数说明)
5. [调用示例](#调用示例)
   - [PHP 示例](#php-示例)
   - [Curl 示例](#curl-示例)
6. [兼容性说明](#兼容性说明)

---

## 概述

XRK-Yunzai 是一个多功能的机器人框架，支持通过 HTTP API 实现以下核心功能：

- **执行命令**：通过 API 发送命令给机器人，机器人执行后返回结果。
- **发送消息**：向指定用户或群组发送文本、图片、视频等多种类型的消息。
- **触发事件**：模拟触发机器人内部事件，例如消息事件或通知事件。
- **获取机器人状态**：查询机器人的运行状态、在线信息等。
- **文件上传与下载**：支持上传文件到服务器并获取 URL，或下载服务器上的文件。

所有 API 请求均通过 HTTP 方法（GET 或 POST）发送，并需要携带 API 密钥进行鉴权。以下是 XRK-Yunzai 的典型应用场景：

- 自动化任务管理
- 消息推送与通知
- 文件共享与处理

---

## API 鉴权

为确保安全性，XRK-Yunzai 的所有 API 请求需要进行鉴权。鉴权通过在请求头中添加 `X-API-Key` 字段实现，密钥值在机器人启动时生成并通过日志输出。

### 请求头示例
```http
X-API-Key: your_api_key_here
```

### 鉴权失败
如果请求未携带 API 密钥或密钥错误，服务器将返回以下响应：
```json
{
  "error": "Unauthorized",
  "status": 403
}
```

> **注意**：请妥善保存 API 密钥，避免泄露。建议在本地连接时跳过鉴权（由框架自动处理）。

---

## API 列表

以下是 XRK-Yunzai 提供的核心 API 接口及其详细说明。

### 执行命令

- **URL**: `/api/stdin/execute`
- **方法**: `POST`
- **描述**: 执行指定的命令并返回结果，支持字符串或消息数组。
- **请求参数**:
  | 参数名      | 类型          | 必填 | 描述                     |
  |-------------|---------------|------|--------------------------|
  | `messages`  | String/Array  | 是   | 命令内容，可以是字符串或消息数组 |
  | `user_info` | Object        | 否   | 用户信息对象，见 [UserInfo 参数说明](#userinfo-参数说明) |
- **请求示例**:
  ```json
  {
    "messages": "你好",
    "user_info": {
      "user_id": "123456",
      "nickname": "测试用户"
    }
  }
  ```
- **返回值**:
  | 字段名      | 类型    | 描述                     |
  |-------------|---------|--------------------------|
  | `success`   | Boolean | 是否成功                 |
  | `code`      | Integer | 状态码（200 表示成功）   |
  | `message`   | String  | 返回消息                 |
  | `timestamp` | Integer | 时间戳（Unix 时间，秒）  |
  | `results`   | Array   | 执行结果数组（如果有）   |
- **返回示例**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "命令已处理",
    "timestamp": 1698765432,
    "results": ["你好"]
  }
  ```

### 发送消息

- **URL**: `/api/message/send`
- **方法**: `POST`
- **描述**: 向指定用户或群组发送消息，支持多种消息类型（文本、图片等）。
- **请求参数**:
  | 参数名       | 类型          | 必填 | 描述                     |
  |--------------|---------------|------|--------------------------|
  | `messages`   | String/Array  | 是   | 消息内容，可以是字符串或消息数组 |
  | `target_type`| String        | 是   | 目标类型（`friend` 或 `group`） |
  | `target_id`  | String        | 是   | 目标 ID（用户 ID 或群组 ID） |
  | `user_info`  | Object        | 否   | 用户信息对象，见 [UserInfo 参数说明](#userinfo-参数说明) |
  | `files`      | File          | 否   | 上传的文件（支持多文件） |
- **请求示例**:
  ```json
  {
    "messages": "你好",
    "target_type": "friend",
    "target_id": "123456",
    "user_info": {
      "user_id": "654321",
      "nickname": "测试用户"
    }
  }
  ```
- **返回值**:
  | 字段名      | 类型    | 描述                     |
  |-------------|---------|--------------------------|
  | `success`   | Boolean | 是否成功                 |
  | `code`      | Integer | 状态码（200 表示成功）   |
  | `message_id`| String  | 消息 ID                  |
  | `content`   | Array   | 消息内容                 |
  | `timestamp` | Integer | 时间戳（Unix 时间，秒）  |
- **返回示例**:
  ```json
  {
    "success": true,
    "code": 200,
    "message_id": "123456_1698765432_789",
    "content": [{"type": "text", "text": "你好"}],
    "timestamp": 1698765432
  }
  ```

### 触发事件

- **URL**: `/api/event/trigger`
- **方法**: `POST`
- **描述**: 触发指定的事件，支持自定义事件类型和数据。
- **请求参数**:
  | 参数名      | 类型   | 必填 | 描述                     |
  |-------------|--------|------|--------------------------|
  | `event_type`| String | 是   | 事件类型（例如 `message.private`） |
  | `event_data`| Object | 是   | 事件数据对象             |
- **请求示例**:
  ```json
  {
    "event_type": "message.private",
    "event_data": {
      "user_id": "123456",
      "message": "测试消息"
    }
  }
  ```
- **返回值**:
  | 字段名      | 类型    | 描述                     |
  |-------------|---------|--------------------------|
  | `success`   | Boolean | 是否成功                 |
  | `code`      | Integer | 状态码（200 表示成功）   |
  | `message`   | String  | 返回消息                 |
  | `event_id`  | String  | 事件 ID                  |
  | `event_data`| Object  | 事件数据                 |
  | `results`   | Array   | 执行结果数组（如果有）   |
- **返回示例**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "已触发 message.private 事件",
    "event_id": "123456_1698765432_123",
    "event_data": {
      "user_id": "123456",
      "message": "测试消息"
    },
    "results": []
  }
  ```

### 获取机器人状态

- **URL**: `/api/bot/status`
- **方法**: `GET`
- **描述**: 获取机器人的运行状态和在线信息。
- **请求参数**: 无
- **返回值**:
  | 字段名      | 类型    | 描述                     |
  |-------------|---------|--------------------------|
  | `success`   | Boolean | 是否成功                 |
  | `code`      | Integer | 状态码（200 表示成功）   |
  | `status`    | Object  | 机器人状态对象           |
  - `status` 字段包含：
    | 子字段      | 类型    | 描述                     |
    |-------------|---------|--------------------------|
    | `uptime`    | Number  | 运行时间（秒）           |
    | `start_time`| Integer | 启动时间（Unix 时间，秒）|
    | `memory`    | Object  | 内存使用情况             |
    | `bots`      | Array   | 在线机器人列表           |
    | `adapters`  | Array   | 适配器列表               |
    | `version`   | String  | 版本号                   |
    | `server`    | Object  | 服务器信息               |
- **返回示例**:
  ```json
  {
    "success": true,
    "code": 200,
    "status": {
      "uptime": 3600,
      "start_time": 1698761832,
      "memory": {
        "rss": 52428800,
        "heapTotal": 16777216,
        "heapUsed": 8388608
      },
      "bots": [
        {
          "uin": "123456",
          "online": true,
          "nickname": "测试机器人",
          "adapter": "stdin"
        }
      ],
      "adapters": [
        {
          "id": "stdin",
          "name": "StdinBot"
        }
      ],
      "version": "1.0.0",
      "server": {
        "url": "http://localhost:3000",
        "port": 3000
      }
    }
  }
  ```

### 文件上传与下载

#### 文件上传
- **URL**: `/api/files/upload`
- **方法**: `POST`
- **描述**: 上传文件到服务器，支持最大 100MB 的文件。
- **请求参数**:
  | 参数名 | 类型 | 必填 | 描述           |
  |--------|------|------|----------------|
  | `file` | File | 是   | 上传的文件数据 |
- **返回值**:
  | 字段名      | 类型    | 描述                     |
  |-------------|---------|--------------------------|
  | `success`   | Boolean | 是否成功                 |
  | `code`      | Integer | 状态码（200 表示成功）   |
  | `file_id`   | String  | 文件 ID                  |
  | `file_name` | String  | 文件名                   |
  | `file_url`  | String  | 文件访问 URL             |
  | `mime_type` | String  | MIME 类型                |
  | `size`      | Integer | 文件大小（字节）         |
- **返回示例**:
  ```json
  {
    "success": true,
    "code": 200,
    "file_id": "01H1234567890ABCDEF",
    "file_name": "test.jpg",
    "file_url": "http://localhost:3000/api/files/01H1234567890ABCDEF.jpg",
    "mime_type": "image/jpeg",
    "size": 102400
  }
  ```

#### 文件下载
- **URL**: `/api/files/:fileId`
- **方法**: `GET`
- **描述**: 下载指定 ID 的文件。
- **请求参数**: 无（通过 URL 中的 `:fileId` 指定文件 ID）
- **返回值**: 文件内容（二进制流）
- **失败返回示例**:
  ```json
  {
    "error": "File not found",
    "status": 404
  }
  ```

---

## UserInfo 参数说明

`user_info` 是一个可选的对象，用于提供额外的用户信息，以模拟不同的用户身份和环境。它可以包含以下字段：

| 字段名       | 类型    | 描述                     | 默认值         |
|--------------|---------|--------------------------|----------------|
| `user_id`    | String  | 用户 ID                  | `"api"`        |
| `nickname`   | String  | 用户昵称                 | 与 `user_id` 相同 |
| `adapter`    | String  | 适配器名称               | `"stdin"`      |
| `message_type`| String | 消息类型（`private` 或 `group`） | `"private"` |
| `post_type`  | String  | 帖子类型（`message`、`notice` 等） | `"message"` |
| `sub_type`   | String  | 子类型（`friend`、`group` 等） | `"friend"`  |
| `self_id`    | String  | 机器人 ID                | `"stdin"`      |
| `seq`        | Integer | 序列号                   | `888`          |
| `time`       | Integer | 时间戳（Unix 时间，秒）  | 当前时间       |
| `uin`        | String  | 用户 UIN                 | 与 `user_id` 相同 |
| `isMaster`   | Boolean | 是否为管理员             | `true`         |
| `group_id`   | String  | 群组 ID（如果适用）      | 无             |
| `group_name` | String  | 群组名称（如果适用）     | 无             |
| `guild_id`   | String  | 频道 ID（如果适用）      | 无             |
| `channel_id` | String  | 频道子 ID（如果适用）    | 无             |

### 使用说明
- **灵活性**：`user_info` 可以根据需求设置任意字段，未设置的字段将使用默认值。
- **模拟身份**：通过设置 `user_id` 和 `nickname`，可以模拟不同用户发送请求。
- **环境模拟**：通过 `group_id` 或 `guild_id`，可以模拟群聊或频道环境。

### 示例
```json
{
  "user_id": "123456",
  "nickname": "测试用户",
  "group_id": "789012",
  "group_name": "测试群",
  "isMaster": false
}
```

---

## 调用示例

以下提供 PHP 和 Curl 的调用示例，涵盖所有 API 接口。

### PHP 示例

#### 执行命令
```php
<?php
$apiUrl = 'http://localhost:3000/api/stdin/execute';
$apiKey = 'your_api_key_here';
$command = '你好';

$data = [
    'messages' => $command,
    'user_info' => [
        'user_id' => '123456',
        'nickname' => '测试用户'
    ]
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $apiUrl);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'X-API-Key: ' . $apiKey
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

echo $response;
```

#### 发送消息（带文件）
```php
<?php
$apiUrl = 'http://localhost:3000/api/message/send';
$apiKey = 'your_api_key_here';

$data = [
    'messages' => '你好，这是一张图片',
    'target_type' => 'friend',
    'target_id' => '123456',
    'user_info' => [
        'user_id' => '654321',
        'nickname' => '测试用户'
    ]
];
$file = new CURLFile('/path/to/test.jpg', 'image/jpeg', 'test.jpg');

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $apiUrl);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, ['data' => json_encode($data), 'files' => $file]);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'X-API-Key: ' . $apiKey
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

echo $response;
```

#### 获取机器人状态
```php
<?php
$apiUrl = 'http://localhost:3000/api/bot/status';
$apiKey = 'your_api_key_here';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $apiUrl);
curl_setopt($ch, CURLOPT_HTTPGET, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'X-API-Key: ' . $apiKey
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

echo $response;
```

### Curl 示例

#### 执行命令
```bash
curl -X POST http://localhost:3000/api/stdin/execute \
     -H "Content-Type: application/json" \
     -H "X-API-Key: your_api_key_here" \
     -d '{
           "messages": "你好",
           "user_info": {
               "user_id": "123456",
               "nickname": "测试用户"
           }
         }'
```

#### 发送消息（带文件）
```bash
curl -X POST http://localhost:3000/api/message/send \
     -H "X-API-Key: your_api_key_here" \
     -F "data={\"messages\":\"你好，这是一张图片\",\"target_type\":\"friend\",\"target_id\":\"123456\",\"user_info\":{\"user_id\":\"654321\",\"nickname\":\"测试用户\"}}" \
     -F "files=@/path/to/test.jpg"
```

#### 触发事件
```bash
curl -X POST http://localhost:3000/api/event/trigger \
     -H "Content-Type: application/json" \
     -H "X-API-Key: your_api_key_here" \
     -d '{
           "event_type": "message.private",
           "event_data": {
               "user_id": "123456",
               "message": "测试消息"
           }
         }'
```

#### 获取机器人状态
```bash
curl -X GET http://localhost:3000/api/bot/status \
     -H "X-API-Key: your_api_key_here"
```

#### 文件上传
```bash
curl -X POST http://localhost:3000/api/files/upload \
     -H "X-API-Key: your_api_key_here" \
     -F "file=@/path/to/test.jpg"
```

#### 文件下载
```bash
curl -X GET http://localhost:3000/api/files/01H1234567890ABCDEF.jpg \
     -H "X-API-Key: your_api_key_here" \
     -o downloaded_file.jpg
```

---

## 兼容性说明

XRK-Yunzai 的 API 接口具有良好的兼容性，支持多种消息类型、事件类型和平台。以下是详细说明：

### 消息类型
- **文本消息**：支持纯文本、带表情的文本等。
- **媒体消息**：
  - **图片**：支持 JPG、PNG、GIF 等格式。
  - **视频**：支持 MP4 等格式。
  - **音频**：支持 MP3、WAV 等格式。
  - **文件**：支持任意文件类型（需符合大小限制）。
- **特殊消息**：
  - **@（提及）**：支持通过 `at` 类型指定用户。
  - **转发消息**：支持嵌套消息数组。
  - **戳一戳**：支持通过 `poke` 类型触发。

### 事件类型
- **消息事件**：
  - `message.private`：私聊消息
  - `message.group`：群聊消息
  - `message.guild`：频道消息
- **通知事件**：
  - `notice.friend`：好友相关通知
  - `notice.group`：群组相关通知
- **请求事件**：
  - `request.friend`：加好友请求
  - `request.group`：加群请求

### 适配器
- 支持 **ICQQ**、**OICQ**、**StdinBot** 等适配器。
- 可通过 `user_info.adapter` 指定适配器类型。

### 平台
- 支持 **Windows**、**Linux**、**macOS** 等操作系统。
- 通过 HTTP 接口调用，与客户端语言无关。

### 注意事项
- **文件大小限制**：
  - `/api/stdin/execute` 和 `/api/message/send`：10MB
  - `/api/files/upload`：100MB
- **消息格式**：建议使用 JSON 格式，确保参数正确解析。
- **事件触发**：`event_type` 支持点号分隔的多级类型，例如 `message.private.friend`。

---

这份文档全面介绍了 XRK-Yunzai 的开放接口及其用法，包括详细的参数说明、调用示例和兼容性信息