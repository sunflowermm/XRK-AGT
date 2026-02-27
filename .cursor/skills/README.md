## 说明

本目录用于存放「Skills」（技能文档），把仓库里的 `docs/` 内容提炼成更适合 AI/IDE 自动加载的“操作型说明书”，以提高开发与排障效率。

## Trae/Claude 如何加载

根据 Trae 的 Skills 规范，**项目级 skills** 默认从 **`.claude/skills/<skill-name>/SKILL.md`** 读取。

因此本仓库采用多目录镜像策略：

- `skills/`：人类可读、仓库内可检索的 Skills 源文件（你要求的根目录技能库）。
- `.trae/skills/`：给 Trae 使用的内部镜像目录。
- `.claude/skills/`：供 Trae/Claude 直接加载的镜像目录（内容与 `skills/` 保持同步）。

## 目录结构

每个技能一个文件夹：

- `skills/<skill-name>/SKILL.md`
- `.claude/skills/<skill-name>/SKILL.md`

`SKILL.md` 必须包含 YAML Frontmatter：

```yaml
---
name: xrk-skill-name
description: 一句话说明何时使用
---
```

其后为 Markdown 指令内容。

