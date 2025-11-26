## 应用 / 前后端开发总览

本篇文档面向 **应用开发者、前后端开发者**，帮助你快速理解：

- 整体启动流程（`app.js` → `start.js` → `Bot`）。
- 后端开发入口（插件、HTTP API、配置系统、渲染器）。
- 前端 Web 面板与静态资源的组织方式。

---

## 启动流程与运行时结构

```mermaid
flowchart TD
    CLI[命令行<br/>node app / node start.js] --> App[app.js 引导器]
    App -->|环境检查/依赖安装| Env[EnvironmentValidator]
    App -->|检查主依赖 + 插件依赖| Dep[DependencyManager]
    App -->|合并 importsJson| Imports[动态 imports]
    App --> Start[start.js]
    Start --> Bot[Bot 实例化 & run()]
    Bot --> Http[HTTP/HTTPS/WS 服务]
    Bot --> Cfg[ConfigLoader 加载所有配置]
    Bot --> Plugins[PluginsLoader 加载插件]
    Bot --> Api[ApiLoader 加载 HTTP API]
    Bot --> Adapter[AdapterLoader + 适配器连接]
```

- **`app.js` 引导层**：
  - 检查 Node.js 版本与基础目录（`logs/`、`data/`、`config/` 等）。
  - 检测并安装缺失依赖（主项目 + `core/*` / `renderers/*` 插件依赖）。
  - 合并 `data/importsJson/*.json` 到 `package.json.imports`，支持动态别名。  
- **`start.js`**：
  - 负责创建 `Bot` 实例并调用 `bot.run()`，进入实际业务层。  
- **`Bot` 运行层**：
  - 启动 HTTP/HTTPS/WebSocket 服务器。
  - 加载配置 / 插件 / API / 渲染器 / 适配器，并建立与各 IM 平台的连接。  

开发者绝大多数时间只需要关注：**插件、HTTP API、配置、渲染器、前端界面** 五块。

---

## 后端开发：插件 / API / 配置 / 渲染

### 插件开发（消息逻辑）

- 入口目录：`core/plugins`（以及你自己创建的插件目录）。  
- 基类：`src/infrastructure/plugins/plugin.js`（详见 `docs/plugin-base.md`）。  
- 典型用法：
  - 定义 `rule` 匹配触发条件（指令、正则、自然语言）。  
  - 在 `handler` 中编写业务逻辑，通过 `this.e.reply()` 等输出。  
  - 如需调用 AI 工作流，使用 `this.getStream().callAI(...)`。  

**插件开发路线图：**

1. 在 `core/plugins` 下创建新 JS 文件，继承 `plugin` 基类。  
2. 设置 `name/dsc/event/rule/priority` 等属性。  
3. 在 `handler` 中使用 `this.e` 获取上下文（用户、群组、消息内容）。  
4. 如需读写配置，使用 `ConfigLoader.get('server')` 等接口。  
5. （可选）借助 `BotUtil` 做日志、缓存、HTTP 请求与文件处理。  

---

### HTTP/API 开发（后台接口）

- 入口目录：`core/http`。  
- 基类：`src/infrastructure/http/http.js`（详见 `docs/http-api.md`）。  
- Loader：`src/infrastructure/http/loader.js`（详见 `docs/api-loader.md`）。  

**快速示例：新增一个管理接口**

```js
// core/http/admin-status.js
import HttpApi from '#infrastructure/http/http.js';
import ConfigLoader from '#infrastructure/commonconfig/loader.js';

export default class AdminStatusApi extends HttpApi {
  constructor(bot) {
    super({
      name: 'admin-status',
      dsc: '管理端状态与统计接口',
      routes: [
        {
          method: 'GET',
          path: '/admin/status',
          handler: 'getStatus',
          auth: ['admin'] // 可选：走统一鉴权
        }
      ]
    }, bot);
  }

  async getStatus(req, res) {
    const serverCfg = ConfigLoader.get('server');
    const cfgData = await serverCfg.read();

    res.json({
      ok: true,
      port: cfgData.server?.port,
      adapters: Object.keys(this.bot.adapter || {}),
      uptime: process.uptime()
    });
  }
}
```

- 自动挂载路径：`/api/admin/status`，并走统一中间件（鉴权、日志等）。  
- 前端可直接通过 `GET /api/admin/status` 获取运行状态。  

---

### 配置系统（CommonConfig / ConfigBase）

- 基类：`ConfigBase`（`docs/config-base.md` 已详细说明）。  
- Loader：`src/infrastructure/commonconfig/loader.js`。
- 默认配置文件：`config/default_config/*.yaml`（例如 `server.yaml`）。  

**配置加载与覆盖逻辑：**

```mermaid
flowchart LR
    Default[config/default_config/*.yaml] --> Merge[运行时加载&合并]
    User[config/*.yaml (用户修改)] --> Merge
    Merge --> RuntimeCfg[运行时配置对象 cfg]
    RuntimeCfg --> API[API/插件/前端使用]
```

- `ConfigLoader` 会实例化各个配置类（如 `ServerConfig`），每个类负责一个配置文件。  
- 配置类内部使用 `ConfigBase` 提供的 `read/set/append/merge/reset` 等能力。  
- 前端通过 API 调用（例如 `/api/config/*`，具体见相关 HTTP 模块）间接修改配置。  

> 建议：**所有跟持久化配置有关的逻辑都放到 ConfigBase 子类里**，不要在插件中直接 `fs.writeFile`。  

---

### 渲染器与图片/HTML 生成

- 基类：`Renderer`（详见 `docs/renderer.md`）。  
- Loader：`src/infrastructure/renderer/loader.js`。  
- 默认渲染器目录：`renderers/*`，模板资源目录：`resources/*`。  

**常见用法：在插件中生成一张排行榜图片并发送：**

```js
import rendererLoader from '#infrastructure/renderer/loader.js';

export async function sendRanking(e, topPlayers) {
  const renderer = rendererLoader.getRenderer(); // 默认 puppeteer

  const img = await renderer.render({
    name: 'ranking',
    tplFile: './resources/html/ranking.html',
    saveId: `group-${e.group_id}`,
    list: topPlayers,
    title: '本周活跃度排行榜'
  });

  await e.reply(img);
}
```

---

## 前端开发：Web 面板与静态资源

### 静态资源目录结构

典型结构（可能略有不同，请以实际仓库为准）：

```text
www/
  xrk/
    index.html
    app.js
    css/
    js/
    img/
resources/
  html/   # 渲染器 HTML 模板
  css/    # 模板/前端共用样式
  img/    # 模板/前端共用图片
```

- `www/` 下的文件由 `Bot` 的静态资源服务直接对外暴露（通常挂载到根路径或 `/xrk`）。  
- `resources/` 主要用于渲染器模板，但也可以与 Web 前端共用一套样式/图片，保证视觉统一。  

### 前端如何调用后端 API

```js
// 前端示例：在 www/xrk/app.js 中
async function fetchStatus() {
  const res = await fetch('/api/admin/status', {
    credentials: 'include' // 若需要 Cookie 鉴权
  });
  const data = await res.json();
  console.log('当前状态:', data);
}
```

> 建议：在前端统一封装一个 `api.js`，集中管理所有 `/api/*` 调用，便于后续维护。  

---

## 推荐开发路径按角色

| 角色 | 推荐文档顺序 |
|------|--------------|
| **插件开发者** | `README.md` → `docs/README.md` → `docs/plugin-base.md` → `docs/plugins-loader.md` → `docs/botutil.md` |
| **后端/API 开发者** | `README.md` → 本文 `docs/app-dev.md` → `docs/http-api.md` → `docs/api-loader.md` → `docs/config-base.md` |
| **前端/Web 开发者** | `README.md` → 本文 `docs/app-dev.md` → 查看 `www/xrk` 源码 → 了解可用的 `/api/*` 接口文档 |
| **运维/配置管理** | `README.md` → `docs/config-base.md` → 对应具体配置子类（如 server/adapter 配置） → 项目中的 HTTP 配置管理 API |

---

## 进一步阅读

- `docs/bot.md`：了解 `Bot` 的整体生命周期和各个子系统如何挂接。  
- `docs/botutil.md`：了解常用工具函数（日志、缓存、文件、HTTP、批处理等）。  
- 适配器相关文档：`docs/adapter-loader.md`、`docs/adapter-onebotv11.md`（与外部 IM 平台对接时必读）。  


