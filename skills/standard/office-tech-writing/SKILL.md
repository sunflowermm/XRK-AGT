---
name: office-tech-writing
description: 技术说明、操作手册、API 摘要、Release 技术向文档；开发者可读结构
---

## 何时使用

操作手册、集成说明、内部技术方案、API 一页纸、故障排查 Runbook（非营销稿）。

## 结构模板

```markdown
# [标题]

## 概述
一段话：读者是谁、解决什么问题。

## 前置条件
- 环境 / 权限 / 依赖

## 步骤
1. …
2. …

## 配置参考
| 字段 | 含义 | 默认 |

## 故障排查
| 现象 | 可能原因 | 处理 |

## 附录
命令、链接、变更历史
```

## 写作规则

- 命令、路径、配置键用反引号；可复制块给完整命令
- 版本号、默认值与仓库/配置一致；不确定标 `[待核实]`
- 危险操作（删数据、改生产）用 **注意** 单独成段
- 长文档分文件：主文档 + `appendix-*.md` 放工作区

## 与 office-doc / office-docx 分工

| 需求 | 技能 |
|------|------|
| 结构与术语 | office-tech-writing |
| 汇报叙事 | office-doc |
| 要 .docx | office-docx |
| 发版用户向 | office-changelog |

## 缺环境

无 run 时交付 Markdown；有 desktop 再转 docx。见 **office-env-setup**。
