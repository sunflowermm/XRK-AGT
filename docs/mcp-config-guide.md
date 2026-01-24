# MCP配置指南

## 如何配置单个工作流的MCP工具

XRK-AGT支持按工作流分组MCP工具，你可以选择只使用特定工作流的工具。

### 配置方式

**方式1：使用路径参数（推荐）**

```json
{
  "mcpServers": {
    "xrk-agt-desktop": {
      "url": "http://localhost:11451/api/mcp/jsonrpc/desktop",
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
      "url": "http://localhost:11451/api/mcp/jsonrpc?stream=desktop",
      "transport": "http",
      "description": "XRK-AGT 桌面工作流 - 仅提供桌面操作工具"
    }
  }
}
```

### 可用工作流

- `desktop` - 桌面操作工具（show_desktop, open_system_tool, open_browser等）
- `tools` - 基础工具（read, grep, write, run）
- `chat` - 群聊功能（at, poke, mute, kick等）
- `memory` - 记忆系统（query_memory, save_memory等）
- `database` - 知识库（query_knowledge, save_knowledge等）

### 配置多个工作流

如果需要多个工作流，可以配置多个MCP服务器：

```json
{
  "mcpServers": {
    "xrk-agt-desktop": {
      "url": "http://localhost:11451/api/mcp/jsonrpc/desktop",
      "transport": "http",
      "description": "桌面操作工具"
    },
    "xrk-agt-tools": {
      "url": "http://localhost:11451/api/mcp/jsonrpc/tools",
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
      "url": "http://localhost:11451/api/mcp/jsonrpc",
      "transport": "http",
      "description": "XRK-AGT 智能助手服务器 - 提供所有工作流工具"
    }
  }
}
```

### 查看可用工作流

```bash
GET http://localhost:11451/api/mcp/tools/streams
```

响应：
```json
{
  "success": true,
  "data": {
    "streams": ["desktop", "tools", "chat", "memory", "database"],
    "groups": {
      "desktop": [...],
      "tools": [...],
      "chat": [...]
    },
    "count": 5
  }
}
```
