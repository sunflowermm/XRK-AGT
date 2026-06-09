---
name: office-docx
description: Word .docx 生成与读取；desktop create_word_document 或 pandoc/run
---

## 何时使用

用户要 Word、.docx、公文、信函、带段落格式的报告（非纯 Markdown）。

## 快速生成（优先）

使用 **desktop** 工作流 `create_word_document`：

- `fileName`：如 `报告.docx`
- `content`：多行纯文本（`\n` 分段）
- 文件落在当前 Agent 工作区

适合：通知、说明、无复杂样式的文稿。

## 读取 / 转换已有 docx

1. 文件放入工作区
2. 有 pandoc 时：

```bash
pandoc --track-changes=all input.docx -o output.md
```

3. 或用 `run` + Python `python-docx` 按段提取

## 复杂版式

- 目录、页眉页脚、多节：先 Markdown 结构给用户确认，再 `pandoc` 或 docx 模板脚本
- `.doc` 老格式：需 LibreOffice 转 docx 后再编辑

```bash
soffice --headless --convert-to docx legacy.doc
```

## 与 office-doc 分工

| 需求 | 技能 |
|------|------|
| 正文结构、汇报逻辑 | office-doc |
| 要 .docx 文件交付 | office-docx |

## 禁止

- 不覆盖用户未指定的 docx
- 修订/批注接受前先备份原文件

## 缺环境

无 pandoc / python-docx → **`create_word_document`** 或 Markdown；见 **office-env-setup**
