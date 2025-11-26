## XRK-AGT 模块文档索引（docs/）

本目录收录了 XRK-AGT 的核心架构文档，围绕 **运行核心、插件系统、适配器、HTTP/API、AI 工作流、配置与渲染** 等模块进行说明。  
建议配合项目主文档 `PROJECT_OVERVIEW.md` 一起阅读。

---

## 快速导航

- **运行核心**
  - `bot.md`：`Bot` 主类文档，说明服务生命周期、中间件、认证与反向代理等。

- **插件与事件系统**
  - `plugin-base.md`：插件基类 `plugin` 的设计、规则匹配与上下文管理。
  - `plugins-loader.md`：`PluginsLoader` 的插件加载、事件调度、冷却与节流机制。

- **适配器与消息接入**
  - `adapter-loader.md`：`AdapterLoader` 如何扫描并加载 `core/adapter` 中的适配器。
  - `adapter-onebotv11.md`：OneBotv11 适配器的事件转译、消息封装与对象封装。

- **AI 工作流**
  - `aistream.md`：`AIStream` 基类，涵盖 Embedding、多提供商支持、Function Calling 与上下文增强。

- **HTTP/API 层**
  - `http-api.md`：`HttpApi` 基类，统一路由、WebSocket 与中间件注册方式。
  - `api-loader.md`：`ApiLoader` 的 API 自动加载、排序与热重载机制。

- **配置与渲染**
  - `config-base.md`：配置基类 `ConfigBase`，包括 YAML/JSON 读写、校验、按路径读写等。
  - `renderer.md`：渲染器基类 `Renderer`，模板渲染与文件监听机制。
  - `botutil.md`：工具类 `BotUtil`，封装日志、缓存、文件/网络操作与异步控制等基础能力。

- **应用与前后端开发**
  - `app-dev.md`：从 `app.js` 引导到 `Bot`，并说明插件、HTTP API、配置系统、渲染器与 Web 前端的协作方式，是应用/前端/后端开发的综合入口。

---

## 按角色推荐阅读顺序

- **插件开发者**
  1. `bot.md` —— 了解整体运行环境与事件来源。
  2. `plugin-base.md` —— 学习插件基类与规则/上下文用法。
  3. `plugins-loader.md` —— 了解事件如何流转到插件。
  4. `aistream.md` —— 需要使用 AI 工作流时再阅读。

- **适配器 / 协议开发者**
  1. `adapter-loader.md` —— 了解适配器是如何被框架加载的。
  2. `adapter-onebotv11.md` —— 参考成熟实现，学习事件转译与对象封装方式。
  3. `bot.md` —— 理解适配器与 `Bot` 的交互点（`Bot.adapter` / `Bot.wsf` / `Bot.em`）。

- **后端/API 开发者**
  1. `bot.md` —— 了解 HTTP 服务器、认证、中间件栈。
  2. `http-api.md` —— 学习如何定义一个新的 API 模块。
  3. `api-loader.md` —— 理解 API 模块如何被自动加载与热重载。

- **运维 / 配置管理者**
  1. `config-base.md` —— 理解配置读写与校验机制。
  2. `bot.md` + `PROJECT_OVERVIEW.md` —— 了解服务端口、反向代理、CORS 与安全策略。

- **前端 / 渲染相关开发者**
  1. `renderer.md` —— 了解 HTML 模板渲染与文件生成。
  2. 结合 `src/renderers/puppeteer` 与 `src/renderers/playwright` 实际代码阅读。

---

## 典型开发路径示例

- **编写一个简单指令插件**
  1. 阅读 `PROJECT_OVERVIEW.md` 中的目录解析。
  2. 阅读 `bot.md` 与 `plugin-base.md`。
  3. 参考 `core/plugin/example` 目录中的示例，在 `core/plugin` 下新建自己的插件目录与 JS 文件。

- **新增一个 API 接口**
  1. 阅读 `http-api.md` 与 `api-loader.md`。
  2. 在 `core/http` 目录中新建一个 `.js` 文件，导出一个符合 `HttpApi` 结构的对象或类。
  3. 重启或等待 `ApiLoader` 热重载，使用浏览器或 Postman 验证新接口。

- **接入新的 IM 平台**
  1. 阅读 `adapter-loader.md` 与 `adapter-onebotv11.md`。
  2. 在 `core/adapter` 中参照 OneBotv11 编写新适配器文件。
  3. 确保对外暴露统一的事件结构（`post_type/message_type/notice_type` 等），这样可以复用现有插件。

---

## 延伸阅读

- `PROJECT_OVERVIEW.md`：从「项目视角」理解整个系统的结构与运行逻辑。
- `INDEX.md` 及其引用的修复文档：了解历史 bug 修复与设计演进背景，有助于在改造底层时避免踩坑。


