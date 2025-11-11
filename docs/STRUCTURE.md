XRK-AGT 项目结构说明

根目录
- app.js                引导程序（环境校验、依赖处理、启动 start.js）
- start.js              交互菜单与多端口服务器管理
- lib/                  核心运行时（HTTP、WS、工作流、配置与工具）
  - bot.js              HTTP/WS 服务器，全局中间件、静态目录、认证、反向代理
  - http/               API 加载与基类（所有 API 统一注册与包装）
    - loader.js         扫描 plugins/api 并注册
    - http.js           HttpApi 基类（routes/middleware/ws 统一注册）
  - aistream/           工作流加载器与基类（LLM/Embedding/流式）
    - loader.js         工作流加载（跨平台路径修正）
    - aistream.js       工作流基类（callAI/callAIStream 等）
  - config/             系统/日志/Redis 等基础配置
  - common/             工具库与公共能力

- plugins/              插件与对外 API
  - api/                业务 API（统一对象导出，由 HttpApi 包装）
    - device.js        设备管理 API（ASR/TTS/指令/WS）
    - ai.js            LLM 流式 SSE 接口（/api/ai/stream）
  - stream/             工作流（供 StreamLoader 调用）
    - device.js        设备工作流（解析 [开心] 等表情标记，返回 emotion/text）

- www/                  静态页面资源
  - index.html         首页
  - xrk/               XRK 控制中心
    - index.html
    - app.js           前端逻辑（AI 聊天、流式显示、ASR 采集、WS）
    - styles.css       UI 设计（深浅色、科技感、响应式）

- components/           设备侧能力（ASR/TTS/配置与工具）
  - asr/               ASRFactory 和具体厂商客户端
  - tts/               TTSFactory 和具体厂商客户端
  - config/            设备配置（deviceConfig.js）
  - util/              设备工具函数（deviceUtil.js）

运行时关键链路
- www/xrk → WebSocket /device → plugins/api/device.js → ASR & AI（StreamLoader.getStream('device')）
- AI 流式显示：/api/ai/stream（SSE） → 前端 EventSource 实时渲染

规范
- 所有 API 使用对象导出，结构：{ name, dsc, priority, routes, ws?, init?, destroy? }
- HttpApi 负责将 routes/middleware/ws 安全统一地挂载到 Express
- 工作流统一由 StreamLoader 加载与调度

备注
- 认证：/xrk 入口自动下发轻量 Cookie（xrk_ui=1），同源访问可免填 API Key；仍保留 X-API-Key 与本地豁免


