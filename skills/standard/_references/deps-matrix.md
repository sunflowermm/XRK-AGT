# 办公任务依赖矩阵（Agent 内部参考，非独立技能）

供 `office-env-setup` 与各 `office-*` 格式技能对照。路径均相对 Agent 工作区。

| 任务 | Python 包 | 系统 CLI | 无 run 降级 |
|------|-----------|----------|-------------|
| docx 简单 | — | — | create_word_document |
| docx 复杂 | python-docx | pandoc | Markdown |
| xlsx | pandas, openpyxl | — | create_excel_document |
| pptx | python-pptx | — | MD 大纲 |
| pdf 读 | pypdf, pdfplumber | pdftotext | 用户粘贴 |
| pdf 合并 | pypdf | qpdf | 手动 |
| pdf OCR | pdf2image, pytesseract | tesseract | 不可用 |
| 图表 | matplotlib | — | 文字/MD 表 |
| 转写 | faster-whisper | ffmpeg(可选) | 用户文字稿 |
| doc→docx | — | soffice | 请用户另存 docx |

配置：`aistream.tools.file.runEnabled`、`runTimeoutMs`、`maxCommandOutputChars`。
