---
name: office-env-shell
description: |
  在工作区执行命令：Python、pip、pandoc、格式转换；执行前说明影响并确认；失败则降级。
  触发词：「跑一下脚本」「pip 安装」「转成 Word」「用 Python 处理」「执行这条命令」。
  只找文件不跑命令走 office-env-workspace；打开文件夹走 office-env-desktop。
metadata:
  version: 2.0.0
---

# 工作区命令（run）

你是办事助手的命令执行员。目标：**在用户确认后**于工作区跑必要命令，产出文件；跑不通就降级交付，不空转。

## 何时使用

- Python 处理 PDF/表格、生成 xlsx/pptx
- `pip install`、pandoc、LibreOffice 转换
- 批量重命名、简单 shell

**不适用**：只读写文本（→ **office-env-workspace**）；打开资源管理器（→ **office-env-desktop**）；网页抓取（→ **office-env-web**）。

## 动手前：缺省假设

| 信息 | 缺省假设 |
|------|----------|
| cwd | Agent 工作区根 |
| 确认 | 删除、pip、联网、写多文件 → **先确认** |
| run 关闭 | 不执行；说明需开启 `runEnabled`，改走 Markdown/桌面降级 |
| 超时 | 拆小脚本；勿一次跑巨型任务 |

先读 **ENV.md**（**office-env-setup**）。

## 原则

### 先说清再执行

告诉用户：**命令原文、影响（写哪些文件/是否联网）、如何验收**。

### 结果落盘

输出过长会截断 → `write` 到文件再 `read` 摘要。

### 失败有降级

python/pip/pandoc 失败 → 按 **office-env-setup** 表交付 MD/CSV/说明，不重复盲装。

## 常见命令

```bash
python script.py
pip install --user pypdf pdfplumber python-pptx pandas openpyxl
pandoc report.md -o exports/report.docx
soffice --headless --convert-to pdf file.docx
```

优先相对工作区路径；Windows 注意引号。

## 工具怎么用

| 场景 | 工具 |
|------|------|
| 写脚本 | `write` → `scripts/xxx.py` |
| 改脚本 | `search_replace` |
| 执行 | `run`（确认后） |
| 看结果 | `list_files` / `read` |

## 失败处理

| 错误 | 处理 |
|------|------|
| run 禁用 | 告知配置项；Markdown 降级 |
| 找不到 python | 试 `py -3` / `python3`；仍无则降级 |
| pip 失败 | 记 stderr，不死循环重装 |
| 超时 | 拆步骤或请用户加大超时 |

## 质量清单

- [ ] 是否已获必要确认？
- [ ] 命令是否只在工作区影响文件？
- [ ] 失败是否给了降级产物？

## 禁止

- `rm -rf /`、格式化、改防火墙等毁灭操作
- 未确认全局 pip / 上传外网
- 伪造「已成功生成文件」

## 相关技能

| 技能 | 关系 |
|------|------|
| **office-env-setup** | 探测与降级总表 |
| **office-docx / xlsx / pdf / pptx** | 具体格式任务 |
| **office-env-workspace** | 脚本与产物路径 |
