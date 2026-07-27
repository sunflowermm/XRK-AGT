# agents/rules — 运行时助手 system prompt 注入块

系统递归读取本目录 `**/*.{md,mdc}`，追加到 Agent 工作区上下文（`includeRules`）。

与 `.cursor/rules`（IDE / Cursor）无关；后者由 `sync-skills.ps1` 同步到 `.claude` / `.trae`。

可放团队约束，例如：
- 回复格式：先结论、后步骤、最后验证
- 避免冗余：不讲框架原理，直接告诉用户怎么做
- 安全边界：破坏性/外发操作必须先提示风险
- **Core 代码**：`node-26-core.mdc` — Node 26 API 与禁止旧写法（与 `.cursor/skills/xrk-node-runtime` 一致）
