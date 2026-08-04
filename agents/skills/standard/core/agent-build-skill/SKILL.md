---
name: agent-build-skill
description: 编写办事 SKILL.md：frontmatter name/description、正文步骤、references；创建或改技能结构时用
---

> 读者：办事助手。本仓目录卡由 `@mariozechner/pi-coding-agent` 解析；**只有 name + description 进 `<available_skills>`**。

## 模型怎么「看见」技能

1. System 里出现 `<available_skills>`：`<name>` + `<description>` + `<location>`  
2. 任务匹配 description → 调 **`tools.read`**，`filePath` = location（或相对工作区的 `skills/.../SKILL.md`）  
3. 读完正文再按步骤调其它 MCP  

因此：`description` 必须含**触发语**（用户会怎么说）；正文必须是**可执行步骤**，不要写长散文。

本仓**不**靠 frontmatter `triggers` 做目录匹配（那是别家运行时）；想要 triggers 式短触发，用 `agents/microagents/`，不是 SKILL。

---

## 最小可运行形

```text
skills/my-skill/          # 工作区自建；或种子 agents/skills/standard/...
└── SKILL.md
```

可选：`references/`、`scripts/`、`assets/`（长文按需再 read；相对路径相对技能目录解析）。

```yaml
---
name: my-skill
description: 何时用：用户说「…」时加载；做什么一句话
---

## 步骤
1. …
2. 需要改文件 → 先 read agent-tools 约定，再用 search_replace
```

| 字段 | 要求 |
|------|------|
| `name` | 与目录名一致；小写+连字符 |
| `description` | 中文可；写清触发场景，目录卡靠它 |

验收：用一句用户原话，看能否在目录卡对上 name；`tools.read` 后能否不凭印象完成任务。

---

## 放到哪（XRK）

| 目标 | 路径 |
|------|------|
| 用户定制（推荐） | `data/ai-workspace/{id}/skills/<名>/` ← 相对 cwd 即 `skills/<名>/` |
| 产品默认种子 | `agents/skills/standard/<名>/` 或 `.../core/<名>/` |
| 禁止 | `.cursor/skills/xrk-*`、仓库根随便建 |

安装落盘见 **agent-skillhub**。

---

## 写法要点（AI 能懂）

- 先步骤后解释；表格列工具名用本仓真实名（`tools.read` / `tools.search_replace`）  
- 失败写「若…则…」；禁止「酌情处理」无落点  
- 一技能一职责；交界写「详见 agent-xxx」  
- 勿在 SKILL 里复制整份 MCP 参数表（那是 agent-tools）
