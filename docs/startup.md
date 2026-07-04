# 启动与引导

> **定位**：XRK-AGT 是**融合智能体业务逻辑的通用后端**；本页描述从 `node app` 到 Bot 在线的引导链。架构边界见 [底层架构设计](底层架构设计.md)。

---

## 启动链

![终端启动](../resources/mdimg/showcase/terminal-startup.gif)

```mermaid
flowchart TD
  CLI["node app [server|pm2|…]"] --> App["app.js"]
  App --> Boot["src/utils/bootstrap.js"]
  Boot --> Env["validateEnvironment<br/>Node ≥26 · 基础目录 · warmupCoreLayout"]
  Boot --> Deps["DependencyManager<br/>pnpm 根依赖 + core 子包 + www 前端"]
  Boot --> Imp["data/importsJson → package.json.imports"]
  Boot --> Start["import start.js"]
  Start --> Menu["交互菜单 / PM2 / server 子进程"]
  Start --> Bot["src/bot.js · Bot.run"]
  Bot --> DB["initDatabases · Redis + MongoDB"]
  Bot --> Load["并行加载 tasker / events / plugin / http / stream"]
  Bot --> Srv["HTTP · HTTPS · WebSocket · 静态 www"]
  Bot --> Online["online / ready"]
```

| 阶段 | 文件 | 职责 |
|------|------|------|
| 入口 | `app.js` | `new Bootstrap().run()` |
| 引导 | `src/utils/bootstrap.js` | 环境、依赖、动态 imports |
| 菜单 / 进程 | `start.js` | 端口选择、Playwright 浏览器、PM2、Ctrl+C 语义 |
| 运行时 | `src/bot.js` | 服务、加载器、全局 `Bot` |

引导日志：`logs/bootstrap.log`（`src/utils/simple-logger.js`）。

---

## Bootstrap 步骤

实现位于 `src/utils/bootstrap.js`（`app.js` 仅一行调用）。

1. **环境验证** — Node **≥ 26**；`paths.ensureBaseDirs()`；`paths.warmupCoreLayout()` 预热 `core/*` 子目录索引。
2. **依赖管理**（`src/utils/bootstrap-deps.js`，跨平台命令解析见 `src/utils/command-spawn.js`）  
   - 根目录 `package.json` 缺失项 → **仅 pnpm install**（`PUPPETEER_SKIP_DOWNLOAD` 默认 `true`）。  
   - `core/*` 含 `package.json` 的子包各自 `pnpm install`。  
   - `www/` 前端依赖（可用 `XRK_SKIP_FRONTEND_BOOTSTRAP=1` 跳过）。  
   - **不在引导阶段安装 Playwright Chromium**；见下方「Playwright 浏览器」。
3. **动态 imports** — 合并 `data/importsJson/*.json` 的 `imports` 到根 `package.json`。

`node app server` 且 `XRK_SKIP_BOOTSTRAP=1` 时跳过依赖安装，仍加载 `start.js`。

---

## start.js 与 Bot

- **交互菜单**：选端口、启停服务、Playwright 浏览器安装、`pnpm run setup:browsers` 等价入口。
- **server 模式**：子进程跑 Bot，便于开发热重启。
- **信号**：Ctrl+C 在服务端 **1 次重启 / 3 次回菜单**（`src/utils/process-signals.js`），详见 [bot.md](bot.md#关闭流程与-ctrlc)。
- **Windows UTF-8**：`src/utils/win-utf8.js`（菜单与日志共用）。

`Bot.run()` 内大致顺序：读配置 → `initDatabases`（见 [database.md](database.md)）→ 加载 Tasker / 监听器 / 插件 / HTTP / 工作流 → 监听 HTTP/WS → 触发 `online`。

---

## 环境变量

| 变量 | 作用 |
|------|------|
| `XRK_SKIP_BOOTSTRAP=1` | `node app server` 时跳过引导中的依赖安装 |
| `XRK_SKIP_CONFIG_CHECK=1` | 跳过配置检查 |
| `XRK_SKIP_FRONTEND_BOOTSTRAP=1` | 跳过 `www/` 前端依赖检查 |
| `XRK_SKIP_FRONTEND_START=1` | 跳过前端 dev server |
| `XRK_OPTIONAL_DB=1` | Redis/Mongo 连接失败时不阻断启动（见 [database.md](database.md)） |
| `PUPPETEER_SKIP_DOWNLOAD` | 覆盖 Puppeteer Chromium 下载（默认 `true`） |

---

## Playwright 浏览器

默认渲染器为 **Playwright**（`agt.browser.renderer`）。Chromium **可选**安装：

- 启动菜单「Playwright 浏览器」
- `pnpm run setup:browsers`

Puppeteer 为可选渲染器；引导阶段不会自动下载浏览器。

---

## 进一步阅读

- [app-dev.md](app-dev.md) — Web 控制台、前后端协作、cfg 用法  
- [bot.md](bot.md) — Bot 生命周期、中间件、关闭流程  
- [database.md](database.md) — Redis / MongoDB  
- [底层架构设计](底层架构设计.md) — 分层与工具模块表  

---

*最后更新：2026-06-14*
