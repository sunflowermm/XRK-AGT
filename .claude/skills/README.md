## 说明

本目录用于存放「Skills」（技能文档），把仓库里的 `docs/` 内容提炼成更适合 AI/IDE 自动加载的“操作型说明书”，以提高开发与排障效率。

## 加载策略：Trae / Claude / Cursor

- Trae/Claude：根据 Trae 的 Skills 规范，项目级 skills 默认从 `.claude/skills/<skill-name>/SKILL.md` 读取。
- Cursor：项目级 skills 从 `.cursor/skills/<skill-name>/SKILL.md` 读取。

因此本仓库采用「根目录 + 多镜像」策略：

- `skills/`：人类可读、仓库内可检索的 Skills 源文件（你要求的根目录技能库）。
- `.trae/skills/`：给 Trae 使用的内部镜像目录。
- `.claude/skills/`：给 Trae/Claude 直接加载的镜像目录（内容与 `skills/` 同步）。
- `.cursor/skills/`：给 Cursor 直接加载的镜像目录（内容与 `skills` 同步）。

## 目录结构

每个技能一个文件夹：

- `skills/<skill-name>/SKILL.md`
- `.claude/skills/<skill-name>/SKILL.md`
- `.cursor/skills/<skill-name>/SKILL.md`

`SKILL.md` 必须包含 YAML Frontmatter：

```yaml
---
name: xrk-skill-name
description: 一句话说明何时使用
---
```

其后为 Markdown 指令内容。

## 如何新增一个 Skill

1. 在 `skills/` 下创建文件夹（例如 `skills/xrk-foo/`），并新增 `SKILL.md`。
2. 写好 YAML Frontmatter（`name` 使用统一前缀，例如 `xrk-foo`，`description` 用一句话说明何时使用）。
3. 正文建议至少包含以下几个小节：
   - `## 你是什么`：给这个 Skill 定义清晰角色边界。
   - `## 权威文档与入口`：列出源码路径和文档路径，作为“唯一可信来源”。
   - `## 你要掌握的要点` 或 `## 核心职责`：用要点列出 3–8 条最核心认知。
   - `## 常见问题你要怎么回答`：把高频问答写成模板，方便 AI 直接套用。
4. 如需给 Trae/Claude/Cursor 使用，同步一份到对应镜像目录（通常通过脚本自动完成；若手动同步，请保证内容 1:1 一致）。

## 使用建议

- **遇到复杂问题时优先检索 Skill 名**（例如 `xrk-llm`、`xrk-aistream`），而不是全局搜索关键词，可以更快定位“权威入口”。
- **更新功能时优先更新对应 Skill**：当某个子系统发生重要改动（配置字段、目录结构、路由路径等），请同步更新相关 Skill，保证 AI 回答不会“过期”。
- **避免在 Skill 里写实现细节代码段的长篇大论**：Skill 更偏向“导航 + 关键决策点”，具体实现细节应指向 `docs/*` 与源码文件。


