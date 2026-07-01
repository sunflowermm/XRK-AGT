# 子服务语言选型

主服务固定 **Node.js**；子服务选**与主栈不同**、且能覆盖业务短板的语言。

## 已内置（推荐优先用）

| Runtime | 语言 | 端口 | 适合 |
|---------|------|------|------|
| `pyserver` | Python | 8000 | AI/爬虫/多媒体/PDF（**默认**，插件最多） |
| `goserver` | Go | 8001 | 高并发、静态二进制、加解密 |
| `phpserver` | PHP | 8002 | 单文件拖拽、共享主机、字符串/Web 脚本 |
| `jserver` | Java 21 + Spring Boot | 8003 | 企业库、JDBC、成熟中间件、Spring 生态 |
| `netserver` | .NET 8 + ASP.NET Core | 8004 | Windows 企业、Office、GUID/系统 API |

## 可选扩展（未内置，按需自建）

| 语言/框架 | 适合 | 说明 |
|-----------|------|------|
| **Rust (Axum/Actix)** | 极致性能、FFI | 编译成本高，适合单点热点 |
| **Ruby (Sinatra)** | 快速脚本 | 与 Python 重叠大，**不推荐** |
| **Kotlin + Ktor** | JVM 轻量替代 Spring | 已有 jserver 时优先级低 |

## 不建议

| 方案 | 原因 |
|------|------|
| Node 子服务 | 与主服务重复 |
| 再叠一层 Python 微框架 | 已有 pyserver |

新增 runtime：复制现有目录 → 实现 `CONTRACT.md` → 登记 `registry.yaml` → 在 `subserver-runtimes.js` 与 commonconfig `subserver.runtimes` 增加端点。

契约详见 [`CONTRACT.md`](CONTRACT.md)。
