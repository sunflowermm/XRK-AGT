# Core www 挂载：普通静态 vs 前端工程

> 代码权威：`src/infrastructure/http/www-app-resolve.js`、`mount-core-www.js`、`frontend/launcher.js`  
> 浏览器兼容：skill **`xrk-www-compat`** · Server 总览：[server.md](server.md)

`core/<Core>/www/<子目录>/` 下每个**一级子目录**都会参与挂载，但分两类，规则不同。

---

## 一句话

| 类型 | 怎么认 | 访问地址从哪来 | 磁盘挂什么 |
|------|--------|----------------|------------|
| **普通静态** | **没有**有效的 `sign.json` | **永远** `/${文件夹名}` | **永远**该文件夹本身 |
| **前端工程（特殊）** | **有**有效的 `sign.json` | **`sign` 声明**（见下） | 产物目录（如 `dist/`），或改走反代 |

不要把「文件夹名叫什么」和「浏览器打开什么」当成一回事——**只有前端工程允许二者不同**。

---

## 布局

```
core/
  system-Core/www/xrk/              ← 普通静态 → http://主机/xrk/
  Example-Core/www/frontend-example/
    sign.json                       ← 有 sign → 前端工程
    package.json / vite.config.* / src/
    dist/                           ← serve=static 时挂这里
  vibe-learn-Core/www/vibe-learn/   ← 同上（仅有 www 的 Core 也会被扫到）
```

另：每个 Core 还有 **`/core/<Core名>/`** → 整个 `www/` 目录（方便直链调试，与对外短路径无关）。

---

## 普通静态

**识别**：目录内无 `sign.json`，或 sign 损坏（损坏时按普通静态回退并打日志）。

| 项 | 规则 |
|----|------|
| URL | `/` + 文件夹名，例如 `www/xrk` → `/xrk` |
| 根目录 | 该文件夹本身（**不**自动改挂 `dist/`） |
| 进程 | 不启 Vite / 不反代 |
| 典型 | 控制台、落地页、纯 HTML/CSS/JS |

保留段不可占用：`api`、`core`、`media`、`uploads`、`File`、`shared`。

---

## 前端工程（特殊挂载）

**识别**：目录内存在可解析的 `sign.json`。

这是「工程目录」：可含源码、`package.json`、构建产物；对外短路径与文件夹名可以不一致。

### 对外 URL（静态与反代同一套）

优先级：

1. `proxy.mount`（推荐，如 `"/example"`）
2. 顶层 `mount`
3. `"/" + id`
4. 回退：`/` + 文件夹名

例：目录 `frontend-example` + `"proxy": { "mount": "/example" }` → 打开 **`/example/`**，不是 `/frontend-example/`。

Vite / Router 的 `base` **必须**与该 URL 一致。

### 服务方式（互斥）

| `serve` | `enabled` | 行为 |
|---------|-----------|------|
| `static` / `dist` | 任意 | **静态**：主服挂产物；**不**启进程 |
| `proxy` / `dev` | 未关 | **反代**：跳过静态；`FrontendLauncher` 拉起 `command`/`args` |
| （未写） | `false` | 静态 |
| （未写） | `true` / 缺省 | 反代（兼容旧约定；新工程请写清 `serve`） |

静态时产物根：

1. `staticRoot` 或 `outDir`（相对本目录，禁止 `..` 逃逸）
2. 依次试：`dist`、`build`、`out`、`.output/public`（须含 `index.html`）
3. 都没有 → 暂挂源码目录并 **warn**（请先 build）

### 推荐日常写法（Vite SPA）

```json
{
  "id": "example",
  "enabled": false,
  "serve": "static",
  "staticRoot": "dist",
  "command": "pnpm",
  "args": ["dev"],
  "port": 4173,
  "proxy": { "mount": "/example" },
  "env": { "BROWSER": "none" },
  "autoRestart": true
}
```

- 改代码后在该目录 `pnpm build`；**重启主服不必再 build**。
- 要 HMR：改为 `"serve": "proxy"`、`"enabled": true`，再重启主服。

规范目录：

- `core/Example-Core/www/frontend-example/`
- `core/vibe-learn-Core/www/vibe-learn/`

### 反代时的其它字段

仅 `mode=proxy` 时需要：`command` / `args` / `port`；可选 `cwd`、`env`、`autoRestart`、`mode`/`devOnly`/`modes`、`build`/`prod`（见 [server.md](server.md) 补充字段）。生产流量不要用 `pnpm dev`。

---

## 启动时谁干什么

```
bootstrap → paths.getCoreDirs()          # 全量 core/*（含仅有 www 的 Core）
         → FrontendLauncher.start()      # 只注册「前端工程 + 需反代」
         → mountCoreWwwStatic()          # 普通静态 + 前端工程静态；proxy 则跳过
```

同名对外路径：先挂占用，后者 warn 跳过。

---

## 对照表（防踩坑）

| 误解 | 实际 |
|------|------|
| 文件夹叫 `frontend-example`，所以 URL 是 `/frontend-example` | 有 sign 时看 `proxy.mount`（常为 `/example`） |
| 有 `dist/` 就会自动挂 dist | **仅前端工程（有 sign）**会探测 dist；普通静态只挂目录本体 |
| 放了 `sign.json` 就一定起 Vite | `serve=static` / `enabled=false` 时只挂产物 |
| 仅有 www、没有 plugin 的 Core 不会挂 | `getCoreDirs` 全量列举；会挂 |

---

## 相关测试

- `tests/framework/mount-core-www.test.mjs` — sign / 路径 / dist
- `tests/framework/paths-core-dirs.test.mjs` — 仅 www 的 Core 不被 warmup 漏掉
