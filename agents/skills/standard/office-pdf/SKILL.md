---
name: office-pdf
description: PDF 全文/表格提取、合并拆分、旋转、OCR、水印、简单生成；工作区 run + pypdf/pdfplumber/qpdf/pdftotext
---

## 何时使用

`.pdf`：读内容、并/拆、转 txt、扫面 OCR、加水印、元数据、简单生成。

## 工具链（按环境选）

| 任务 | 方式 |
|------|------|
| 读正文 | `pdftotext -layout in.pdf out.txt`（poppler） |
| 读表格 | Python `pdfplumber` |
| 合并/拆分/旋转 | `qpdf` 或 `pypdf` |
| 扫描 OCR | `pdf2image` + `pytesseract` |
| 简单生成 | `reportlab` |

文件均在 **Agent 工作区**；用 `write` 写脚本、`run` 执行、`list_files` 验收。

## Python 片段

```python
# 合并
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in ["a.pdf", "b.pdf"]:
    for p in PdfReader(f).pages: w.add_page(p)
with open("merged.pdf", "wb") as o: w.write(o)

# 表格 → 列表
import pdfplumber
with pdfplumber.open("in.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables() or []:
            print(table)
```

## 命令行

```bash
pdftotext -layout input.pdf output.txt
qpdf --empty --pages a.pdf b.pdf -- merged.pdf
qpdf input.pdf --pages . 1-3 -- p1-3.pdf
```

## OCR 扫描件

```python
from pdf2image import convert_from_path
import pytesseract
text = []
for i, img in enumerate(convert_from_path("scan.pdf")):
    text.append(f"--- Page {i+1} ---\n" + pytesseract.image_to_string(img, lang="chi_sim+eng"))
open("ocr.txt", "w", encoding="utf-8").write("\n".join(text))
```

需系统 Tesseract 中文包；缺失时先告知用户再装依赖。

## 后续

- 表格要 Excel → `office-xlsx`
- 纪要 → `office-meeting`

## 禁止

- 不编造 PDF 原文
- 不解密受密码保护 PDF，除非用户提供合法密码

## 缺环境

无 run / 无 pypdf / 无 OCR → **office-env-setup**（用户粘贴、pdftotext、或说明无法处理扫描件）
