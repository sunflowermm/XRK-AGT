# 未来架构规划

```mermaid
graph TB
    subgraph "客户端层"
        Web[Web 管理端<br/>React/Vue3 + TypeScript]
        Mobile[移动端 App<br/>React Native/Flutter]
        Desktop[桌面客户端<br/>Electron/Tauri]
        CLI[CLI 工具<br/>Node.js]
    end

    subgraph "主服务端 - Node.js"
        direction TB
        MainServer[XRK-AGT 主服务<br/>Express + 插件系统]
        HTTPAPI[HTTP API Gateway<br/>RESTful + WebSocket]
        PluginSys[插件系统<br/>事件驱动架构]
        Workflow[工作流引擎<br/>AI 工作流管理]
        Tasker[Tasker 协议层<br/>OneBot/Device/Stdin]
    end

    subgraph "Python 子服务端 - FastAPI"
        direction TB
        PyServer[FastAPI 服务<br/>独立进程/独立配置]
        RAG[RAG 引擎<br/>向量检索/知识库]
        ML[ML 模型服务<br/>NLP/图像/语音]
        Embed[向量化服务<br/>Embedding API]
        DocParser[文档解析器<br/>PDF/Word/Excel/Markdown]
    end

    subgraph "数据存储层"
        Redis[(Redis<br/>缓存/会话)]
        Mongo[(MongoDB<br/>业务数据)]
        VectorDB[(向量数据库<br/>Milvus/Chroma)]
        FileStore[文件存储<br/>本地/OSS]
    end

    subgraph "外部服务"
        LLM[LLM API<br/>GPT/Claude/豆包]
        Vision[视觉 API<br/>图像识别]
    end

    %% 客户端连接
    Web -->|HTTP/WS| HTTPAPI
    Mobile -->|HTTP/WS| HTTPAPI
    Desktop -->|HTTP/WS| HTTPAPI
    CLI -->|HTTP| HTTPAPI

    %% 主服务端内部
    HTTPAPI --> MainServer
    MainServer --> PluginSys
    MainServer --> Workflow
    MainServer --> Tasker
    PluginSys --> Workflow

    %% 主服务端与 Python 服务通信
    HTTPAPI <-->|HTTP/RPC<br/>业务对接| PyServer
    Workflow <-->|RAG 查询| RAG
    PluginSys <-->|ML 推理| ML

    %% Python 服务内部
    PyServer --> RAG
    PyServer --> ML
    PyServer --> Embed
    PyServer --> DocParser
    RAG --> Embed
    RAG --> DocParser

    %% 数据层连接
    MainServer --> Redis
    MainServer --> Mongo
    PyServer --> VectorDB
    PyServer --> Mongo
    MainServer --> FileStore
    PyServer --> FileStore

    %% 外部服务
    Workflow --> LLM
    Workflow --> Vision
    ML --> LLM

    %% 样式
    style MainServer fill:#4A90E2,color:#fff,stroke:#2E5C8A,stroke-width:3px
    style PyServer fill:#3776AB,color:#fff,stroke:#2E5C8A,stroke-width:3px
    style RAG fill:#FF6B6B,color:#fff
    style Web fill:#61DAFB,color:#000
    style Mobile fill:#61DAFB,color:#000
    style Desktop fill:#61DAFB,color:#000
    style VectorDB fill:#FFD700,color:#000
```

## 技术栈说明

### 主服务端 (Node.js)
- **框架**: Express/Fastify
- **语言**: JavaScript/TypeScript
- **核心**: 插件系统、工作流引擎、Tasker 协议层
- **端口**: 由启动配置决定（HTTP/HTTPS）
- **说明**: 端口在启动时通过 `bot.run({ port: 端口号 })` 指定，可通过配置修改

### Python 子服务端 (FastAPI)
- **框架**: FastAPI + Uvicorn
- **语言**: Python 3.10+
- **核心能力**:
  - RAG 引擎: LangChain, LlamaIndex, FAISS
  - ML 模型: Transformers, PyTorch, ONNX
  - 向量化: sentence-transformers, OpenAI Embeddings
  - 文档解析: PyPDF2, python-docx, pandas
- **端口**: 8000 (独立启动)
- **部署**: 独立进程，独立依赖环境 (requirements.txt, venv)

### 客户端技术栈
- **Web**: React 18+ / Vue 3 + TypeScript + Vite
- **移动端**: React Native / Flutter
- **桌面端**: Electron / Tauri
- **CLI**: Node.js + Commander.js

### 数据存储
- **Redis**: 缓存、会话、实时数据
- **MongoDB**: 业务数据、配置、日志
- **向量数据库**: Milvus / Chroma (向量检索)
- **文件存储**: 本地文件系统 / OSS (阿里云/腾讯云)

### 通信协议
- **主服务端 ↔ Python 服务**: HTTP REST API / gRPC
- **客户端 ↔ 主服务端**: HTTP REST + WebSocket
- **数据同步**: 异步消息队列 (可选 Redis Stream / RabbitMQ)
