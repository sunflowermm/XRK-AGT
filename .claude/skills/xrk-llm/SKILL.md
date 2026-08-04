---
name: xrk-llm
description: 当你需要配置/新增/排查 LLM 提供商（OpenAI/Azure/Gemini/Anthropic/Ollama/各类兼容网关）时使用；确保 YAML/Schema/代码一致。
---

## 入口

`docs/factory.md`、`src/factory/llm/LLMFactory.js`、`core/system-Core/http/ai.js`

## 出站链

```
slash/recipe → messages → toolPair → compaction(+sidecar) → trim → LLM
```

并行：`policies` + `security.toolScan`（可选 `approval`）+ SystemContext 指纹。

## 体系级吸收

| 子系统 | 来源 | AGT 落点 |
|--------|------|----------|
| Policy / 威胁扫描 / 交互审批（默认关） | opencode/goose | `security.toolScan` · `security.approval.enabled=false` · `#批准`/`#批准id` |
| Recipe + slash | goose | `recipes/` · `slash-commands.js` · `/recipe` |
| 配方 cron（轻量） | goose scheduler | `recipe-schedule` 插件 · `recipes.scheduleEnabled` |
| Compaction 事件 | OpenHands/cline | `MonitorService` `context:compaction` |
| prefix sidecar / SystemContext | cline/opencode | 既有模块 |
| apply_edit / verify / repo_map | aider | tools MCP |
| triggers microagents | OpenHands | `trigger-microagents.js` |

## 仍未吸收

真沙箱/Docker、向量记忆、多 agent critic、完整 Condensation 事件流、tree-sitter 官方 tags、Recipe 无人值守自动跑 LLM。

## 关键配置

- `security.toolScan` · `security.approval` · `recipes.scheduleEnabled`
- `policies[]` · `context.compaction.sessionCache` · `llm.aux`
