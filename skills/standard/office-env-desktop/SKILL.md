---
name: office-env-desktop
description: 本机 desktop 工作流；无 run 时生成 docx/xlsx 的首选路径
---

## 何时使用

用户要「打开网页/文件夹」「生成 Word/Excel」「看磁盘/剪贴板」。**B 档能力，不依赖 run。**

## 文档（工作区落盘）

| 工具 | 说明 |
|------|------|
| `create_word_document` | 多行文本 → `.docx` |
| `create_excel_document` | JSON/二维数组 → `.xlsx` |

复杂版式、合并单元格公式 → 仍需 run + python-docx/pandas；见 **office-env-setup** 降级表。

## 文件与系统

| 工具 | 说明 |
|------|------|
| `open_explorer` / `open_path` | 打开目录或文件 |
| `open_browser` | 系统浏览器 |
| `open_application` | 启动应用 |
| `system_info` / `disk_space` | 环境侧写（无 run 时辅助探测） |
| `read_clipboard` / `write_clipboard` | 剪贴板（需确认） |
| `screenshot` | 截图（需确认） |

## desktop 失败时

| 情况 | 降级 |
|------|------|
| 工具未注册/报错 | Markdown 交付 + 路径说明 |
| 仅要内容不要文件 | 聊天正文 + office-sheet |
| 要 pptx/pdf | 需 C 档 run；否则 MD 大纲 |

## 注意

- 路径相对 **Agent 工作区**
- 锁屏、关机、杀进程必须先确认
- 系统命令优先 **tools.run**，desktop 不替代 shell

## 禁止

- 不未经确认锁屏/关机/结束用户进程
- 不自动把剪贴板内容外发
