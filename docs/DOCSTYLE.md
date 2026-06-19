# 文档编写规范

> 维护者与新文档作者请遵循本规范，保证开发者「看得舒服、找得到源码、不重复」。

---

## 文档分层

| 层级 | 文件 | 写什么 |
|------|------|--------|
| L0 入口 | `README.md` | 安装、首读路径、外链 |
| L1 枢纽 | `docs/README.md` | 全量索引、按角色阅读 |
| L1 边界 | `底层架构设计.md` | 分层、工具表、AI/配置索引（**唯一架构图**） |
| L1 运行时 | **`runtime-surface.md`** | 全局/Bot/Loader 挂载（**唯一挂载面**） |
| L1 写法 | **`coding-style.md`** | Core/src 写法与性能（**唯一写法规范**） |
| L1 契约 | `base-classes.md` | 基类最小 export 示例 |
| L2 专题 | `plugin-base.md`、`http-api.md` 等 | 单点 API、流程图、配置字段 |

**禁止**：在 L0/L1 概览中复制大段 mermaid 或 Node 26 禁止项；改为链接权威文档。

---

## 单篇模板

每篇 `docs/*.md` 建议结构：

```markdown
# 标题

> **源码**：`path/to/file.js`（函数/类名）  
> **读者**：插件开发者 / 运维 / …  
> **关联**：[runtime-surface.md](runtime-surface.md) · [其他](other.md)

（可选）一段话说明职责边界。

## 目录

- …

---

## （正文分节，每节解决一个问题）

## 相关文档

- …

---

*最后更新：YYYY-MM-DD*
```

### 元信息块（文首 `>`）必填项

- **源码**：主文件路径；多文件用「 · 」分隔  
- **读者**：谁会在什么场景打开这篇  
- **关联**：链到 `runtime-surface` / `base-classes` / 上级专题，避免孤岛

### 正文约定

- **行为以代码为准**；写清「文件 + 符号名」  
- 配置：YAML 路径 + 字段名 + 一行示例  
- API：method + path + 是否 `systemAuth`  
- 示例代码可运行、与 Node 26 规范一致  
- 同一事实只维护一处；他处用「见 [xxx.md](xxx.md)」

### 图表

- 架构分层：仅 `底层架构设计.md`（Mermaid 为权威；可配 `resources/mdimg/docs/` 示意图作导读）
- 挂载/全局：仅 `runtime-surface.md`
- 专题内流程（如插件事件链）：保留 1 张即可，勿与上层重复

### 配图与媒体（`resources/mdimg/`）

| 目录 | 用途 | 引用路径（从 `docs/*.md`） |
|------|------|---------------------------|
| `showcase/` | **真实**录屏、控制台截图 | `../resources/mdimg/showcase/...` |
| `docs/` | AI 概念图、架构导读图 | `../resources/mdimg/docs/...` |
| `mdimg/*.png` | README 联合研制校徽等 | `../resources/mdimg/...` |

**约定**：

1. **实拍优先**：能截屏/录屏的用 `showcase/`（见根 [README.md](../README.md#-项目展示)）
2. **概念补充**：架构、扩展点、MCP、工厂等可用 `docs/` 下 AI 生图作导读（不替代 Mermaid 权威图）
3. **单篇最多 1～2 张**导读图 + 必要时 1 组实拍表；避免与上层文档重复贴同一张图
4. 图片 `alt` 写清场景；大图用 `<details>` 折叠

**已有导读图索引**（维护者增删时同步本表）：

| 文件 | 建议挂载文档 |
|------|----------------|
| `docs-hub-banner.png` | `docs/README.md` |
| `architecture-layers.png` | `底层架构设计.md` |
| `seven-extensions.png` | `框架可扩展性指南.md` |
| `mcp-ecosystem.png` | `mcp-guide.md` |
| `docker-compose-stack.png` | `docker.md` |
| `llm-factory.png` | `factory.md` |
| `plugin-event-pipeline.png` | `plugin-base.md` |
| `aistream-mcp-flow.png` | `aistream.md` |

---

## 变更同步

改底层挂载或基类时，至少更新：

1. `docs/runtime-surface.md`（若影响 global / Bot / req）  
2. `docs/base-classes.md`（若影响 export 形状）  
3. [文档审查清单.md](文档审查清单.md) 对应行  

改 Loader 行为时更新 `infrastructure-shared.md` + 对应 `*-loader.md`。

---

*最后更新：2026-06-19*
