---
name: agent-search
description: 检索栈：默认百度搜索 MCP、web_fetch、与 office-research 分工
---

## 选型（按优先级）

| 场景 | 用法 |
|------|------|
| **中文关键词、时事、产品对比、政策** | `remote-mcp.baidu-search` 工具（默认已注册） |
| **用户给了完整 URL** | `web.web_fetch` |
| **需登录 / 强 JS 页面** | 启用 `browser` 工作流，或请用户导出到工作区 |
| **写成调研摘要 / 决策 memo** | 检索后加载 **office-research** |

## 百度搜索 MCP

- **内置**：`core/system-Core/stream/baidu-search.js` 导出 `getMcpServers()`，StreamLoader 插件式加载，无需改 yaml
- 包：`baidu-search-mcp`（npx，无需 API Key）
- 工具名前缀：`remote-mcp.baidu-search.*`（以控制台实际列表为准）
- 适合：概览多条结果；需要正文时可开深度抓取（较慢）
- 结果须标注来源标题与链接，勿当既定事实

## 流程

1. 明确检索问题（关键词 + 时间范围）
2. 搜索 → 筛选 3–5 条可信来源
3. 必要时对单条 URL 再 `web_fetch` 补全文
4. 归纳并标注不确定性

## 与 office-env-web

| 步骤 | 技能 |
|------|------|
| 定框架 | office-research |
| 已知链接抓页 | office-env-web |
| 开放域搜网 | agent-search（本技能） |

## 禁止

- 不绕过付费墙 / 登录（除非用户明确授权并提供材料）
- 不把单一搜索结果写成官方结论
