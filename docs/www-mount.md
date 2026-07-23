# Core www 挂载

> 代码：`www-app-resolve.js` · `www-static-build.js` · `mount-core-www.js` · `frontend/launcher.js`  
> 浏览器兼容：skill **`xrk-www-compat`**

`core/<Core>/www/<子目录>/` 每个一级子目录都会挂载。先分「有没有 sign」，有 sign 的前端工程再分两种运行方式。

---

## 总览

```
www/<子目录>/
├── 无 sign.json ──────────► 普通静态：URL = /文件夹名，挂目录本体
└── 有 sign.json ──────────► 前端工程（特殊）
        ├── enabled: false （或 serve: static）──► 只 build，不启进程，挂 dist
        └── enabled: true  （或 serve: proxy） ──► 启进程 + 反向代理
```

就这两种前端工程状态，没有第三种。

---

## 普通静态（无 sign）

| 项 | 规则 |
|----|------|
| 例 | `system-Core/www/xrk` → `/xrk/` |
| URL | 永远 `/${文件夹名}` |
| 磁盘 | 目录本体（不探测 dist、不 build） |
| 进程 | 无 |

保留段：`api`、`core`、`media`、`uploads`、`File`、`shared`。

另：`/core/<Core名>/` 始终指向该 Core 的整个 `www/`（调试用）。

---

## 前端工程（有 sign）— 仅两种

对外 URL 两边相同，优先级：`proxy.mount` → `mount` → `/${id}` → `/${文件夹名}`。  
Vite `base` 必须与该 URL 一致。

### ① 静态：`enabled: false`（推荐日常 / 生产 SPA）

**每次启动都 build**（默认），但不启动前端进程；编完再挂 dist。

| 步骤 | 行为 |
|------|------|
| 1 | 执行 `sign.build`（未写则默认 `pnpm build`）——**不论 dist 是否已存在** |
| 2 | 主服 `express.static` 挂产物；**Launcher 不拉起** `command` |

```json
{
  "id": "example",
  "enabled": false,
  "serve": "static",
  "staticRoot": "dist",
  "build": { "command": "pnpm", "args": ["build"] },
  "command": "pnpm",
  "args": ["dev"],
  "port": 4173,
  "proxy": { "mount": "/example" }
}
```

- `command` / `port` 在此模式下**不会用到**（留给切到反代时用）。
- 不想每次启动都编：`"buildOnStart": false`（自行保证 dist 正确；改源码易挂旧包）。
- 代价：多开几个前端工程时，启动会串行多等几次 Vite build（通常数秒级）。
- `pnpm`/`npm` 经 `#utils/command-spawn.js` 解析（Windows `.cmd`、PATH、`pnpm.cjs`、corepack、`npm exec pnpm`），避免葵子/精简 PATH 下 `spawn pnpm ENOENT`。

### ② 反代：`enabled: true`

**启动**前端进程，并由主服**反向代理**到 `proxy.mount`。

| 步骤 | 行为 |
|------|------|
| 1 | `mountCoreWwwStatic` **跳过**该目录（不挂静态） |
| 2 | `FrontendLauncher` 执行 `command`/`args`（如 `pnpm dev`），反代到 `port` |

```json
{
  "id": "example",
  "enabled": true,
  "serve": "proxy",
  "command": "pnpm",
  "args": ["dev"],
  "port": 4173,
  "proxy": { "mount": "/example" }
}
```

开发 HMR 用这个；生产流量不要用 `pnpm dev`。

### 开关怎么认

| 写法 | 走哪条 |
|------|--------|
| `enabled: false` 或 `serve: "static"` | ① 只 build 不启动 |
| `enabled: true` 且非 static（含 `serve: "proxy"` / 未写 serve） | ② 启动 + 反代 |

---

## 启动顺序

```
FrontendLauncher.start()   → 只处理 ② 反代工程
mountCoreWwwStatic()       → 普通静态 + ①（缺 dist 则先 build 再挂）
```

---

## 规范示例

| 目录 | URL |
|------|-----|
| `Example-Core/www/frontend-example/` | `/example` |
| `vibe-learn-Core/www/vibe-learn/` | `/vibe-learn` |

---

## 踩坑

| 误解 | 实际 |
|------|------|
| `enabled: false` 什么都不干 | 会挂静态；缺 dist 时还会 build |
| `enabled: false` 仍会起 Vite | 不会；只有 `enabled: true` 才启进程 |
| 文件夹名 = URL | 有 sign 时看 `proxy.mount` |
| 每次重启都重新 build | 否；有 dist 就跳过 |

---

## 测试

- `tests/framework/mount-core-www.test.mjs`
- `tests/framework/paths-core-dirs.test.mjs`
