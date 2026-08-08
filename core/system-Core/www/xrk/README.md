# XRK-AGT 控制台（Vue 3）

- 栈：Vue 3 + Vite + Pinia + Vue Router + Naive UI
- 挂载：`sign.json` → 静态根 `dist/`（`/xrk/`）；挂载阶段不 build
- 开发：`pnpm dev`（或 `sign.enabled=true` 反代）
- 主题：奶油底 + 糖果强调色，非天蓝 AI 模板

## dist 约定（写清楚）

| 谁 | 怎么做 |
|----|--------|
| **改控制台并合入主仓的人** | **建议**改完后 `pnpm build`，把 **`dist/` 一起提交**。仓内带预构建产物，避免部分环境装依赖/编 Vite 失败 |
| **只用 / 部署的人** | **支持自己 build**（见下）；编不了就直接用仓库里的 `dist`。启动 stale build 失败也会回落已有 dist；可设 `XRK_SKIP_WWW_BUILD=1` 跳过启动时构建 |

挂载与 stale 细节见 [docs/www-mount.md](../../../../docs/www-mount.md)「`/xrk` 控制台：`dist` 与自建」。

```bash
cd core/system-Core/www/xrk
pnpm install
pnpm build
# 仓库根亦可：pnpm run build:www
```
