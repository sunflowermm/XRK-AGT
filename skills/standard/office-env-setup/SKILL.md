---
name: office-env-setup
description: 环境探测、缺依赖降级、能力档位 A–E；run/pip/desktop/web 不可用时的办事路径
---

## 何时使用

- 任务需要 Python/pandoc/OCR 但不确定本机有没有
- `run` 失败、`pip install` 失败、desktop 工具报错
- 用户问「缺环境怎么办」「能不能跑脚本」
- **任何 format 技能执行前**：若从未探测，先快速过一遍档位

## 第一步：读 ENV.md

工作区根目录 `ENV.md`（无则按模板创建并标注「未探测」）。**不要重复问用户已知项**。

## 能力档位

| 档 | 条件 | 能做什么 |
|----|------|----------|
| A | 文件工具 | Markdown 文稿、聊天表格、工作区存草稿 |
| B | + desktop | 生成 docx/xlsx、打开文件夹/浏览器 |
| C | + run 开启 | Python 脚本、pip、命令行转换 |
| D | + Python 可用 | pandas/pypdf/pptx 等 |
| E | + web/browser | 调研、抓公开网页 |

## 快速探测（需 C 档；执行前征得确认）

```bash
python --version
pip --version
where pandoc
where soffice
pdftotext -v
```

无 `run` 时：用 `system_info`（desktop）侧面了解 OS，并向用户说明无法自动探测 CLI。

## 任务 → 主路径 → 降级

| 任务 | 首选 | 缺环境时 |
|------|------|----------|
| Word 交付 | `create_word_document` | Markdown + 说明「请 Word 粘贴」 |
| Excel 交付 | `create_excel_document` | `office-sheet` 聊天表 + CSV 文本 |
| PDF 读 | run + pypdf/pdfplumber | 用户粘贴；或 `pdftotext` |
| PDF 合并 | run + qpdf/pypdf | 请用户本地合并 |
| PPT | run + python-pptx | Markdown 大纲（office-pptx） |
| 图表 | run + matplotlib | ASCII 表或文字描述趋势 |
| 录音转写 | run + faster-whisper | 请用户提供文字稿 |
| 网页调研 | web_fetch | 用户提供截图/粘贴 |
| CSV 大表 | run + pandas | 分块 `read` + 手工汇总 |

**原则**：永远先交付**可验收的降级产物**，再附「若开启 run / 安装 XX 可自动化」。

## pip 安装规范

1. 说明包名、用途、是否联网
2. 用户确认后：`pip install <pkg>` 或 `pip install --user <pkg>`
3. 失败：记录错误 → 走降级路径，不反复 install

## run 被关闭

告知路径：`aistream.yaml` → `tools.file.runEnabled: true`，需管理员改配置并重启。

## 探测后写回 ENV.md

更新「能力档位」勾选、工具表、探测记录日期。**改 ENV 前一句话告知用户**。

## 关联技能

| 场景 | 技能 |
|------|------|
| 跑命令细节 | office-env-shell |
| 文件操作 | office-env-workspace |
| 网页 | office-env-web |
| 本机打开 | office-env-desktop |

## 禁止

- 未确认就 pip install / 改系统 PATH
- 因缺环境直接放弃任务（必须给降级交付）
