# xiaozhi-esp32 对接指南

> **说明**：本文档说明如何在 XRK-AGT 平台中对接 xiaozhi-esp32 设备，实现 WebSocket 服务端功能。

## 📋 目录

- [项目概述](#项目概述)
- [对接方案](#对接方案)
- [实现步骤](#实现步骤)
- [代码示例](#代码示例)
- [配置说明](#配置说明)
- [测试验证](#测试验证)
- [常见问题](#常见问题)

---

## 项目概述

### xiaozhi-esp32 简介

xiaozhi-esp32 是一个基于 ESP32 的 AI 语音交互项目，支持：
- **WebSocket 协议**：控制消息和音频数据都通过 WebSocket 传输（推荐）
- **MQTT+UDP 协议**：控制消息通过 MQTT，音频数据通过 UDP（加密传输）
- **音频格式**：Opus 编码，16kHz（设备端发送），24kHz（服务端发送）
- **消息格式**：JSON 控制消息 + 二进制音频数据

### 通信协议要点

1. **Hello 消息交换**：连接建立后需要交换 Hello 消息
2. **音频数据**：二进制 Opus 编码音频帧
3. **控制消息**：JSON 格式，包含 type、session_id 等字段
4. **消息类型**：hello、listen、stt、tts、llm、mcp、abort、system 等

详细协议文档请参考：
- [WebSocket 协议文档](https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md)
- [MQTT+UDP 协议文档](https://github.com/78/xiaozhi-esp32/blob/main/docs/mqtt-udp.md)

---

## 对接方案

### 方案一：WebSocket Tasker（推荐）

创建一个 WebSocket Tasker 来处理 xiaozhi-esp32 设备的连接，将设备消息转换为 XRK-AGT 的标准事件。

**优势**：
- 符合 XRK-AGT 的架构设计
- 可以复用现有的事件系统和插件系统
- 便于扩展和维护

### 方案二：HTTP API + WebSocket

创建一个 HTTP API 模块，提供 WebSocket 端点处理 xiaozhi-esp32 连接。

**优势**：
- 更灵活的控制
- 可以集成到现有的 API 系统

**推荐使用方案一**，因为它更符合 XRK-AGT 的架构设计。

---

## 实现步骤

### 步骤 1：创建 Tasker 目录结构

在 `core` 目录下创建新的 core 模块（如 `xiaozhi-core`），或使用现有的 core 模块：

```
core/
└── xiaozhi-core/          # 新建 core 模块
    ├── tasker/
    │   └── xiaozhi-esp32.js    # WebSocket Tasker
    ├── events/
    │   └── xiaozhi.js          # 事件监听器
    ├── plugin/
    │   └── xiaozhi-handler.js  # 业务插件（可选）
    └── commonconfig/
        └── xiaozhi.yaml        # 配置文件
```

### 步骤 2：实现 WebSocket Tasker

创建 `core/xiaozhi-core/tasker/xiaozhi-esp32.js`，实现 WebSocket 连接处理。

### 步骤 3：实现事件监听器

创建 `core/xiaozhi-core/events/xiaozhi.js`，处理 xiaozhi-esp32 事件。

### 步骤 4：实现业务插件（可选）

创建 `core/xiaozhi-core/plugin/xiaozhi-handler.js`，处理具体的业务逻辑。

---

## 代码示例

### 1. WebSocket Tasker 实现

创建文件：`core/xiaozhi-core/tasker/xiaozhi-esp32.js`

```javascript
import { ulid } from "ulid";
import crypto from 'crypto';

export default class XiaozhiEsp32Tasker {
  id = 'xiaozhi-esp32';
  name = 'Xiaozhi ESP32';
  path = 'xiaozhi-esp32';

  constructor() {
    // 存储活跃连接
    this.connections = new Map(); // session_id -> { ws, device_id, client_id }
    this.deviceBots = new Map();  // device_id -> bot instance
  }

  load() {
    // 注册 WebSocket 路径
    if (!Bot.wsf[this.path]) {
      Bot.wsf[this.path] = [];
    }

    Bot.wsf[this.path].push((ws, req) => {
      this.handleConnection(ws, req);
    });

    Bot.makeLog('XiaozhiEsp32', 'info', `WebSocket Tasker 已加载，路径: /${this.path}`);
  }

  async handleConnection(ws, req) {
    // 从请求头获取设备信息
    const headers = req.headers;
    const deviceId = headers['device-id'] || headers['Device-Id'] || 'unknown';
    const clientId = headers['client-id'] || headers['Client-Id'] || 'unknown';
    const authToken = (headers['authorization'] || headers['Authorization'] || '').replace('Bearer ', '');
    const protocolVersion = headers['protocol-version'] || headers['Protocol-Version'] || '1';

    // 生成会话 ID
    const sessionId = ulid();

    // 创建或获取 Bot 实例
    let bot = this.deviceBots.get(deviceId);
    if (!bot) {
      bot = this.createBotInstance(deviceId, clientId);
      this.deviceBots.set(deviceId, bot);
    }

    // 存储连接信息
    this.connections.set(sessionId, {
      ws,
      deviceId,
      clientId,
      authToken,
      protocolVersion,
      bot,
      sessionId,
      connectedAt: Date.now(),
      lastMessageTime: Date.now()
    });

    Bot.makeLog('XiaozhiEsp32', 'info', `设备连接: device_id=${deviceId}, session_id=${sessionId}`);

    // 设置 WebSocket 事件处理
    ws.on('message', (data) => {
      this.handleMessage(sessionId, data, ws);
    });

    ws.on('close', () => {
      this.handleDisconnect(sessionId);
    });

    ws.on('error', (error) => {
      Bot.makeLog('XiaozhiEsp32', 'error', `WebSocket 错误: ${error.message}`);
      this.handleDisconnect(sessionId);
    });
  }

  createBotInstance(deviceId, clientId) {
    const botId = `xiaozhi-${deviceId}`;

    if (!Bot.uin.includes(botId)) {
      Bot.uin.push(botId);
    }

    const bot = {
      uin: botId,
      self_id: botId,
      nickname: `Xiaozhi-${deviceId}`,
      avatar: '',
      tasker: { id: this.id, name: this.name },
      tasker_type: this.id,
      stat: { start_time: Date.now() / 1000 },
      version: { id: this.id, name: this.name, version: '1.0.0' },
      config: {},
      sendMsg: async (msg, target, extraData) => {
        return this.sendMessage(botId, msg, target, extraData);
      },
      sendAudio: async (audioData, sessionId) => {
        return this.sendAudioData(botId, audioData, sessionId);
      },
      sendTTS: async (text, sessionId) => {
        return this.sendTTSMessage(botId, text, sessionId);
      }
    };

    Bot[botId] = bot;
    return bot;
  }

  async handleMessage(sessionId, data, ws) {
    const conn = this.connections.get(sessionId);
    if (!conn) {
      Bot.makeLog('XiaozhiEsp32', 'warn', `未找到连接: session_id=${sessionId}`);
      return;
    }

    conn.lastMessageTime = Date.now();

    try {
      // 判断消息类型：二进制（音频）或文本（JSON）
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        // 二进制消息（音频数据）
        await this.handleAudioData(sessionId, data, conn);
      } else {
        // JSON 消息
        const message = JSON.parse(data.toString());
        await this.handleJSONMessage(sessionId, message, conn);
      }
    } catch (error) {
      Bot.makeLog('XiaozhiEsp32', 'error', `处理消息错误: ${error.message}`);
    }
  }

  async handleJSONMessage(sessionId, message, conn) {
    const { type } = message;

    switch (type) {
      case 'hello':
        await this.handleHello(sessionId, message, conn);
        break;
      case 'listen':
        await this.handleListen(sessionId, message, conn);
        break;
      case 'abort':
        await this.handleAbort(sessionId, message, conn);
        break;
      case 'mcp':
        await this.handleMCP(sessionId, message, conn);
        break;
      default:
        Bot.makeLog('XiaozhiEsp32', 'warn', `未知消息类型: ${type}`);
    }
  }

  async handleHello(sessionId, message, conn) {
    const { ws, deviceId, bot } = conn;

    Bot.makeLog('XiaozhiEsp32', 'info', `收到 Hello 消息: device_id=${deviceId}`);

    // 验证 transport
    if (message.transport !== 'websocket') {
      ws.close(1008, 'Unsupported transport');
      return;
    }

    // 保存音频参数
    const audioParams = message.audio_params || {};
    conn.audioParams = {
      deviceSampleRate: audioParams.sample_rate || 16000,
      serverSampleRate: 24000, // 服务器使用 24kHz
      format: audioParams.format || 'opus',
      channels: audioParams.channels || 1,
      frameDuration: audioParams.frame_duration || 60
    };

    // 发送 Hello 响应
    const response = {
      type: 'hello',
      transport: 'websocket',
      session_id: sessionId,
      audio_params: {
        format: 'opus',
        sample_rate: 24000,
        channels: 1,
        frame_duration: 60
      }
    };

    ws.send(JSON.stringify(response));

    // 触发连接事件
    Bot.em('xiaozhi.device.connected', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_connected_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId,
      audio_params: conn.audioParams
    });
  }

  async handleListen(sessionId, message, conn) {
    const { ws, bot, deviceId } = conn;
    const { state, mode } = message;

    Bot.makeLog('XiaozhiEsp32', 'info', `收到 Listen 消息: state=${state}, mode=${mode}`);

    // 触发监听事件
    Bot.em('xiaozhi.device.listen', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_listen_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId,
      state: state, // 'start', 'stop', 'detect'
      mode: mode,   // 'auto', 'manual', 'realtime'
      text: message.text || ''
    });
  }

  async handleAbort(sessionId, message, conn) {
    const { bot, deviceId } = conn;
    const { reason } = message;

    Bot.makeLog('XiaozhiEsp32', 'info', `收到 Abort 消息: reason=${reason}`);

    // 触发中止事件
    Bot.em('xiaozhi.device.abort', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_abort_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId,
      reason: reason
    });
  }

  async handleMCP(sessionId, message, conn) {
    const { bot, deviceId } = conn;
    const { payload } = message;

    Bot.makeLog('XiaozhiEsp32', 'debug', `收到 MCP 消息: device_id=${deviceId}`);

    // 触发 MCP 事件
    Bot.em('xiaozhi.device.mcp', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_mcp_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId,
      payload: payload
    });
  }

  async handleAudioData(sessionId, audioData, conn) {
    const { bot, deviceId } = conn;

    // 触发音频数据事件
    Bot.em('xiaozhi.device.audio', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_audio_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId,
      audio_data: audioData,
      audio_params: conn.audioParams
    });
  }

  handleDisconnect(sessionId) {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    const { bot, deviceId } = conn;

    Bot.makeLog('XiaozhiEsp32', 'info', `设备断开连接: device_id=${deviceId}, session_id=${sessionId}`);

    // 触发断开事件
    Bot.em('xiaozhi.device.disconnected', {
      self_id: bot.self_id,
      tasker: this.id,
      tasker_id: this.id,
      tasker_name: this.name,
      event_id: `xiaozhi_disconnected_${Date.now()}`,
      time: Date.now(),
      bot: bot,
      device_id: deviceId,
      session_id: sessionId
    });

    // 清理连接
    this.connections.delete(sessionId);
  }

  // 发送消息给设备
  async sendMessage(deviceId, message, target, extraData) {
    // 找到设备的活跃连接
    for (const [sessionId, conn] of this.connections.entries()) {
      if (conn.deviceId === deviceId && conn.ws.readyState === 1) {
        const msg = {
          session_id: sessionId,
          type: 'custom',
          payload: {
            message: message,
            target: target,
            ...extraData
          }
        };
        conn.ws.send(JSON.stringify(msg));
        return true;
      }
    }
    return false;
  }

  // 发送音频数据给设备
  async sendAudioData(deviceId, audioData, sessionId) {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.deviceId !== deviceId) {
      return false;
    }

    if (conn.ws.readyState === 1) {
      conn.ws.send(audioData, { binary: true });
      return true;
    }
    return false;
  }

  // 发送 TTS 消息给设备
  async sendTTSMessage(deviceId, text, sessionId) {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.deviceId !== deviceId) {
      return false;
    }

    if (conn.ws.readyState === 1) {
      // 发送 TTS 开始消息
      conn.ws.send(JSON.stringify({
        session_id: sessionId,
        type: 'tts',
        state: 'start'
      }));

      // 发送文本消息
      conn.ws.send(JSON.stringify({
        session_id: sessionId,
        type: 'tts',
        state: 'sentence_start',
        text: text
      }));

      // TODO: 这里应该调用 TTS 服务生成音频，然后发送
      // 目前只是示例，实际需要集成 TTS 服务

      // 发送 TTS 结束消息
      conn.ws.send(JSON.stringify({
        session_id: sessionId,
        type: 'tts',
        state: 'stop'
      }));

      return true;
    }
    return false;
  }

  // 发送 STT 结果给设备
  async sendSTTResult(deviceId, text, sessionId) {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.deviceId !== deviceId) {
      return false;
    }

    if (conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify({
        session_id: sessionId,
        type: 'stt',
        text: text
      }));
      return true;
    }
    return false;
  }

  // 发送 LLM 回复给设备
  async sendLLMResponse(deviceId, text, emotion, sessionId) {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.deviceId !== deviceId) {
      return false;
    }

    if (conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify({
        session_id: sessionId,
        type: 'llm',
        emotion: emotion || 'neutral',
        text: text
      }));
      return true;
    }
    return false;
  }
}
```

### 2. 事件监听器实现

创建文件：`core/xiaozhi-core/events/xiaozhi.js`

```javascript
export default {
  name: 'xiaozhi-event-listener',
  priority: 100,

  accept(e) {
    // 只处理 xiaozhi 相关事件
    return e.tasker === 'xiaozhi-esp32';
  },

  async deal(e) {
    // 事件预处理和标准化
    // 这里可以添加事件去重、标记等逻辑

    // 设置通用属性
    e.isXiaozhi = true;
    e.device_id = e.device_id || e.self_id.replace('xiaozhi-', '');

    // 调用插件系统处理
    await PluginsLoader.deal(e);
  }
};
```

### 3. 业务插件示例

创建文件：`core/xiaozhi-core/plugin/xiaozhi-handler.js`

```javascript
import plugin from '#infrastructure/plugins/plugin.js';

export default class extends plugin {
  constructor() {
    super({
      name: 'xiaozhi-handler',
      dsc: 'xiaozhi-esp32 设备处理插件',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^.*$',
          fnc: 'handleMessage'
        }
      ]
    });
  }

  async handleMessage(e) {
    // 只处理 xiaozhi 设备消息
    if (!e.isXiaozhi) return false;

    const { device_id, session_id, msg } = e;

    // 处理设备消息
    // 例如：调用 AI 工作流、发送回复等

    // 示例：简单回复
    if (msg && msg.trim()) {
      await e.reply(`收到消息: ${msg}`);
    }

    return true;
  }
}
```

---

## 配置说明

### 配置文件

创建文件：`core/xiaozhi-core/commonconfig/xiaozhi.yaml`

```yaml
# xiaozhi-esp32 配置
xiaozhi:
  # WebSocket 路径
  path: 'xiaozhi-esp32'
  
  # 认证配置
  auth:
    enabled: true
    # API Key 验证（可选）
    apiKeyRequired: false
  
  # 音频处理配置
  audio:
    # ASR 配置
    asr:
      provider: 'funasr'  # funasr, xunfei, etc.
      enabled: true
    
    # TTS 配置
    tts:
      provider: 'edgetts'  # edgetts, xunfei, etc.
      enabled: true
    
    # LLM 配置
    llm:
      provider: 'qwen'  # qwen, glm, etc.
      enabled: true
  
  # 超时配置
  timeout:
    hello: 10000  # Hello 消息超时（毫秒）
    message: 30000  # 消息超时（毫秒）
    connection: 300000  # 连接超时（毫秒）
```

---

## 测试验证

### 1. 启动服务

```bash
node app.js
```

### 2. 查看日志

启动后应该看到：
```
[XiaozhiEsp32] WebSocket Tasker 已加载，路径: /xiaozhi-esp32
```

### 3. 连接测试

使用 WebSocket 客户端连接到：
```
ws://localhost:8080/xiaozhi-esp32
```

请求头需要包含：
- `Device-Id`: 设备 MAC 地址
- `Client-Id`: 客户端 UUID
- `Authorization`: Bearer <token>（如果启用认证）
- `Protocol-Version`: 1

### 4. 发送 Hello 消息

```json
{
  "type": "hello",
  "version": 1,
  "features": {
    "mcp": true
  },
  "transport": "websocket",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

应该收到服务器返回的 Hello 响应。

---

## 常见问题

### Q: 如何集成 ASR/TTS/LLM 服务？

A: 可以使用 XRK-AGT 的工厂系统（Factory）来集成各种 AI 服务提供商。参考：
- [工厂系统文档](factory.md)
- [AIStream 工作流文档](aistream.md)

### Q: 如何处理音频数据？

A: 音频数据处理需要：
1. 解码 Opus 音频为 PCM
2. 调用 ASR 服务进行语音识别
3. 调用 LLM 进行对话处理
4. 调用 TTS 生成语音
5. 编码为 Opus 发送给设备

可以使用 Node.js 的 `opuslib` 或 `opusscript` 库进行编解码。

### Q: 如何实现 MCP 协议支持？

A: MCP 协议消息通过 `xiaozhi.device.mcp` 事件传递，可以在插件中处理 MCP 消息，调用设备的工具。

### Q: 如何支持多设备并发？

A: Tasker 实现已经支持多设备并发，每个设备会创建独立的 Bot 实例和连接管理。

---

## 相关文档

- [WebSocket 协议文档](https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md) - xiaozhi-esp32 官方协议文档
- [Tasker 底层规范](tasker-base-spec.md) - XRK-AGT Tasker 开发规范
- [事件系统标准化文档](事件系统标准化文档.md) - 事件处理规范
- [插件基类文档](plugin-base.md) - 插件开发指南
- [工厂系统文档](factory.md) - AI 服务集成指南

---

*最后更新：2026-02-21*
