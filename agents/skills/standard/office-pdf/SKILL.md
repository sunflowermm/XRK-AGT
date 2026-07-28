---
name: office-pdf
description: |
  PDF：读正文/表格、合并拆分、OCR、转文本；工作区 run + pypdf/pdfplumber 等；缺环境则请用户粘贴。
  触发词：「读这个 PDF」「合并 PDF」「拆 PDF」「OCR」「PDF 转文字」「提取表格」。
  要 Word 走 office-docx；表格进 Excel 走 office-xlsx。
metadata:
  version: 2.0.0
---

# PDF 处理

你是办事助手的 PDF 帮手。目标：从 PDF **抽出可用文字/表格**，或合并拆分；扫面件尽量 OCR；做不到就说清缺什么。

## 何时使用

- 读 `.pdf` 正文、抽表、合并/拆分/旋转
- 扫描件 OCR、简单加水印/生成

**不适用**：长文结构写作（→ **office-doc**）；只要 Word（→ **office-docx**）。

## 动手前：缺省假设

| 信息 | 缺省假设 |
|------|----------|
| 文件位置 | 先放入工作区再处理 |
| 密码 PDF | **用户提供合法密码**才解密 |
| 缺工具 | 请用户粘贴关键页，或说明无法 OCR |

读 **ENV.md**；无 run → **office-env-setup** 降级。

## 原则

- 不编造 PDF 里没有的字/数  
- 表格抽出后可交 **office-xlsx**  
- OCR 失败如实说明（缺 Tesseract/中文包）

## 工具链

| 任务 | 方式 |
|------|------|
| 读正文 | `pdftotext -layout` 或 pypdf |
| 读表格 | `pdfplumber` |
| 合并/拆分 | `qpdf` / `pypdf` |
| OCR | `pdf2image` + `pytesseract` |

流程：`write` 脚本 → 确认后 `run` → `list_files` 验收。

## 示例

```python
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in ["a.pdf", "b.pdf"]:
    for p in PdfReader(f).pages: w.add_page(p)
with open("exports/merged.pdf", "wb") as o: w.write(o)
```

```bash
pdftotext -layout input.pdf exports/output.txt
qpdf --empty --pages a.pdf b.pdf -- exports/merged.pdf
```

## 质量清单

- [ ] 输出是否在工作区且路径已告知？
- [ ] 是否未杜撰正文？
- [ ] 密码 PDF 是否经用户授权？

## 禁止

- 不编造原文；不破解密码
- 未确认不装系统级 OCR 包

## 相关技能

**office-xlsx** · **office-meeting** · **office-env-shell** · **office-env-setup**
