---
name: office-env-desktop
description: 本机 desktop 工作流；打开路径/浏览器/系统信息，文档走 tools+skills
---

## 何时使用

用户要「打开网页/文件夹」「看磁盘/剪贴板」「截图」。**B 档能力，不依赖 run。**

办公 **docx/xlsx/pdf** 不在 desktop 提供 MCP，统一走 **tools.run** + **office-*** skills。

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
| 要 docx/xlsx/pptx/pdf | 需 C 档 **tools.run**；否则 MD 大纲 |

## 注意

- 路径相对 **Agent 工作区**
- 锁屏、关机、杀进程必须先确认
- 系统命令优先 **tools.run**，desktop 不替代 shell

## 禁止

- 不未经确认锁屏/关机/结束用户进程
- 不自动把剪贴板内容外发
