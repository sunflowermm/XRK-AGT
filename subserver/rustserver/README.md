# rustserver（Axum）

Rust · 端口 **8005** · 契约见 [`../CONTRACT.md`](../CONTRACT.md)

## 示例插件

| 组名 | 模块 | 路由 |
|------|------|------|
| `regex-tools` | `src/plugins/regex_tools.rs` | `POST /api/regex-tools/match` · `/replace` |

## 启动

```bash
cd subserver/rustserver
cargo run
```

新插件：在 `src/plugins/` 注册到 `plugins/mod.rs`。
