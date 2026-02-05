# MCP配置指南

> **快速参考**：本文档说明如何配置Cursor等外部平台连接XRK-AGT的MCP服务，支持按工作流分组使用工具。

## 配置单个工作流的MCP工具

XRK-AGT支持按工作流分组MCP工具，你可以选择只使用特定工作流的工具。

### 配置方式

**方式1：使用路径参数（推荐）**

```json
{
  "mcpServers": {
    "xrk-agt-desktop": {
      "url": "http://localhost:8080/api/mcp/jsonrpc/desktop",
      "transport": "http",
      "description": "XRK-AGT 桌面工作流 - 仅提供桌面操作工具"
    }
  }
}
```

**方式2：使用查询参数**

```json
{
  "mcpServers": {
    "xrk-agt-desktop": {
      "url": "http://localhost:8080/api/mcp/jsonrpc?stream=desktop",
      "transport": "http",
      "description": "XRK-AGT 桌面工作流 - 仅提供桌面操作工具"
    }
  }
}
```

> **注意**：端口号（8080）由启动配置决定，请替换为实际使用的端口。

### 可用工作流

- `desktop` - 桌面操作工具（show_desktop, open_system_tool, open_browser, screenshot等）
- `tools` - 基础工具（read, grep, write, run）
- `chat` - 群聊功能（at, poke, mute, kick, setAdmin等）
- `memory` - 记忆系统（query_memory, save_memory, list_memories, delete_memory）
- `database` - 知识库（query_knowledge, save_knowledge, list_knowledge, delete_knowledge）

详细工具列表请参考 [MCP完整指南](mcp-guide.md#system-core-工作流和工具)。

### 配置多个工作流

如果需要多个工作流，可以配置多个MCP服务器：

```json
{
  "mcpServers": {
    "xrk-agt-desktop": {
      "url": "http://localhost:8080/api/mcp/jsonrpc/desktop",
      "transport": "http",
      "description": "桌面操作工具"
    },
    "xrk-agt-tools": {
      "url": "http://localhost:8080/api/mcp/jsonrpc/tools",
      "transport": "http",
      "description": "基础工具"
    }
  }
}
```

### 使用所有工作流

```json
{
  "mcpServers": {
    "xrk-agt": {
      "url": "http://localhost:8080/api/mcp/jsonrpc",
      "transport": "http",
      "description": "XRK-AGT 智能助手服务器 - 提供所有工作流工具"
    }
  }
}
```

### 查看可用工作流

**RESTful API**：
```bash
GET http://localhost:8080/api/mcp/tools/streams
```

**JSON-RPC**：
```bash
POST http://localhost:8080/api/mcp/jsonrpc
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**响应示例**：
```json
{
  "success": true,
  "data": {
    "streams": ["desktop", "tools", "chat", "memory", "database"],
    "groups": {
      "desktop": [
        { "name": "desktop.show_desktop", "description": "...", "inputSchema": {...} },
        { "name": "desktop.open_browser", "description": "...", "inputSchema": {...} }
      ],
      "tools": [
        { "name": "tools.read", "description": "...", "inputSchema": {...} }
      ],
      "chat": [...],
      "memory": [...],
      "database": [...]
    },
    "count": 5
  }
}
```
