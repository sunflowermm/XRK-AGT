---
name: xrk-subserver
description: 当你需要理解或修改 Python 子服务端（LangChain/LangGraph + 向量服务），以及它与主服务 v3/AIStream 的衔接关系时使用。
---

## 文档与代码

`docs/subserver-api.md`、`subserver/pyserver/`、`aistream.subserver`（host/port/timeout）

## 职责

- 向量：`/api/vector/embed|search|upsert`
- Agent：`/api/langchain/chat`（可回调主服务 `/api/v3/chat/completions`）
- Node 侧：工作流 + Provider 入口；复杂编排优先 Python
