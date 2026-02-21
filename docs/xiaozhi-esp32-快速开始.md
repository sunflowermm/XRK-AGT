# xiaozhi-esp32 快速对接指南

## 🚀 快速开始

### 1. 创建目录结构

在 `core` 目录下创建新的 core 模块：

```bash
mkdir -p core/xiaozhi-core/tasker
mkdir -p core/xiaozhi-core/events
mkdir -p core/xiaozhi-core/plugin
mkdir -p core/xiaozhi-core/commonconfig
```

### 2. 创建 Tasker 文件

创建 `core/xiaozhi-core/tasker/xiaozhi-esp32.js`，参考 [完整对接文档](xiaozhi-esp32-integration.md#代码示例) 中的代码。

### 3. 创建事件监听器

创建 `core/xiaozhi-core/events/xiaozhi.js`：

```javascript
export default {
  name: 'xiaozhi-event-listener',
  priority: 100,
  accept(e) {
    return e.tasker === 'xiaozhi-esp32';
  },
  async deal(e) {
    e.isXiaozhi = true;
    e.device_id = e.device_id || e.self_id.replace('xiaozhi-', '');
    await PluginsLoader.deal(e);
  }
};
```

### 4. 启动服务

```bash
node app.js
```

### 5. 连接设备

设备连接到：
```
ws://your-server:8080/xiaozhi-esp32
```

## 📝 关键点

1. **WebSocket 路径**：`/xiaozhi-esp32`
2. **请求头**：需要包含 `Device-Id`、`Client-Id`、`Authorization`
3. **Hello 消息**：连接后必须交换 Hello 消息
4. **消息类型**：支持 JSON 文本消息和二进制音频数据

## 🔗 相关文档

- [完整对接文档](xiaozhi-esp32-integration.md) - 详细的实现说明和代码示例
- [xiaozhi-esp32 协议文档](https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md) - 官方协议文档
