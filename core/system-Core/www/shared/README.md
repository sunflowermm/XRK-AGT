# `/shared` — Core www 共享静态资源

由 `system-Core/www/shared/` 经 `mountCoreWwwStatic` 挂载为 **`/shared/`**。

| 文件 | URL | 用途 |
|------|-----|------|
| `xrk-web-compat.js` | `/shared/xrk-web-compat.js` | WebView 兼容：`randomId`、`unwrapSuccess`、`abortTimeout`、`deepClone` |

## 标准

- **权威 skill**：`.cursor/skills/xrk-www-compat/SKILL.md`
- **规则**：`.cursor/rules/xrk-dev-requirements.mdc`「Core www」节、`xrk-project.mdc`（浏览器 ≠ Node 26）
- **文档**：`docs/coding-style.md` §1.1、`docs/app-dev.md`「`/shared`」
- **单测**：`tests/framework/www-web-compat.test.mjs`（`pnpm test:fast`）

## 约定

1. 产品 Core 的 ESM 页优先 `import` 本模块，勿各站复制踩坑。
2. 经典 `<script>` 可内联同语义，须注释对齐本文件。
3. **`/shared` 仅 system-Core**；产品 Core 勿用目录名 `shared`（lsy 用 `www/lsy-shared` → `/lsy-shared`）。
4. 新兼容能力先扩本目录，再改调用方。
