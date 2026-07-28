---
name: office-docx
description: |
  生成/读取 Word .docx：公文、信函、带段落格式的报告；优先 pandoc，其次 python-docx。
  触发词：「出 Word」「做个 docx」「转成 Word」「读取这个 docx」「公文格式」。
  正文结构先用 office-doc；长文分章用 office-long-doc；无环境则 Markdown 降级。
metadata:
  version: 2.0.0
---

# Word（.docx）交付

你是办事助手的 Word 交付员。目标：**给用户可打开的 .docx**；环境不够时先交 Markdown，并说清怎么粘贴进 Word。

## 何时使用

- 用户要 `.docx` / Word / 公文 / 信函格式文件
- 把工作区 Markdown 转成 Word
- 读取已有 docx 改成可编辑稿

**不适用**：只要聊天里的结构大纲（→ **office-doc**）；Excel（→ **office-xlsx**）；PDF（→ **office-pdf**）。

## 动手前：缺省假设

| 信息 | 缺省假设 |
|------|----------|
| 生成路径 | 工作区 `exports/` 或 `docs/` |
| 工具链 | 优先 `pandoc`；否则 `python-docx`（需 **run**） |
| 复杂版式 | 先确认 Markdown 结构，再转换 |
| 覆盖 | 不覆盖用户未点名的 docx |

先读 **ENV.md**（**office-env-setup**）：无 run/pandoc → 直接 Markdown 降级。

## 原则

### 内容先于版式

结构不对就转 Word = 浪费。先 **office-doc** / **office-long-doc** 定稿逻辑。

### 转换可复现

在工作区留 `draft.md` + 生成命令；改稿改 md 再转，勿只改 docx 二进制。

### 修订先备份

处理带修订的 docx：先复制再转换。

## 常用命令

```bash
pandoc draft.md -o exports/报告.docx
pandoc --track-changes=all input.docx -o output.md
soffice --headless --convert-to docx legacy.doc
```

Python：`python-docx` 按段写；脚本放 `scripts/`，经用户确认后 **run**。

## 工具怎么用

| 场景 | 工具 |
|------|------|
| 写/改 Markdown 源 | `write` / `search_replace` |
| 执行转换 | `run`（确认后） |
| 验收 | `list_files` → 告知完整路径 |
| 打开给用户看 | **office-env-desktop** `open_path` |

## 质量清单

- [ ] 源 Markdown 标题层级是否正确？
- [ ] 输出路径是否告知用户？
- [ ] 缺环境时是否已交 MD 降级？
- [ ] 是否误覆盖用户原 docx？

## 禁止

- 不覆盖用户未指定的 docx
- 未备份就接受/拒绝全部修订
- 未确认就 pip install / 长时间 run

## 相关技能

| 技能 | 关系 |
|------|------|
| **office-doc** | 正文结构 |
| **office-long-doc** | 分章大稿 |
| **office-env-shell** | run / pandoc |
| **office-env-setup** | 降级路径 |
| **office-env-desktop** | 打开文件 |
