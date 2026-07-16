---
name: xrk-subserver
description: 当你需要理解或修改 Python 子服务端（FastAPI 扩展框架），以及它与主服务端的 HTTP 衔接时使用。
---

## 文档与代码

- `docs/subserver-api.md`、`subserver/pyserver/`
- 主→子调用：`#utils/subserver-client.js`（`callSubserver`、`getSubserverConfig`、`fetchSubserverToPath`）
- AgentRuntime 挂载：`AgentRuntime.callSubserver`（日志包装）

## 职责边界

| 侧 | 职责 |
|----|------|
| **主服务端 (Node)** | LLM（`LLMFactory`）、AiWorkflow 工作流、MCP、MemoryManager/RAG、HTTP/WS |
| **子服务端 (Python)** | 健康检查、系统 API、`apis/<group>/*.py` 业务扩展（按需装载） |

子服务端**不提供**内置 `/api/vector/*`、`/api/langchain/*`。

## 调用示例

```javascript
import { callSubserver, fetchSubserverToPath } from '#utils/subserver-client.js';

// 或运行时：AgentRuntime.callSubserver（配置来自 ai-workflow.yaml → subserver）
await AgentRuntime.callSubserver('/health', { method: 'GET' });
await fetchSubserverToPath('/api/mygroup/file', { query: { id: '1' }, dest: '/path/local.bin' });
```

Node 26：`fetch` + `AbortSignal.timeout`（见 `subserver-client.js`、skill **`xrk-node-runtime`**）。

## 扩展子服务 API

在 `subserver/pyserver/apis/<group>/` 新增模块，导出 `default` 路由元数据（见 `docs/subserver-api.md`）。
