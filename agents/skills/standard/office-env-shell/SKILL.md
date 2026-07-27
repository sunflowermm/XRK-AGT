---
name: office-env-shell
description: 在工作区执行命令 run；Python/脚本、pip、格式转换；缺环境降级见 office-env-setup
---

## 何时使用

要跑 Python 处理 PDF/表格、pip 装依赖、调用 pandoc/soffice、批量重命名等。

## 前置检查

1. 读工作区 `ENV.md` 的 C/D 档与 run 状态
2. 若未探测且任务依赖 run：**office-env-setup** 快速探测或直接向用户确认
3. `run` 关闭 → 不执行命令，改 desktop/Markdown 降级并说明配置项

## 工具

**tools** 工作流 `run`：

- 默认 cwd = Agent 工作区
- 受 `ai-workflow.tools.file.runEnabled`、`runTimeoutMs`、`maxCommandOutputChars` 约束
- 输出过长会截断 → 结果 `write` 到文件再 `read`

## 安全清单

执行前说明：

1. **命令原文**
2. **影响**（写哪些文件、是否联网 pip）
3. 等用户确认后再跑（删除、pip install、curl 上传）

## 常见办公命令

```bash
python script.py
pip install --user pypdf pdfplumber python-pptx pandas openpyxl matplotlib
pandoc report.md -o report.docx
soffice --headless --convert-to pdf file.docx
```

Windows 注意路径引号；优先相对工作区路径。

## 失败时

| 错误 | 处理 |
|------|------|
| run 禁用 | 见 office-env-setup → 告知 runEnabled |
| python 找不到 | 试 `python3` / `py -3`；仍无则降级 |
| pip 失败 | 记录 stderr，不重复装；降级交付 |
| 命令不存在 | pandoc/soffice/qpdf → 换 Python 或 desktop 路径 |
| 超时 | 拆小脚本或增大 runTimeoutMs（需用户改配置） |

依赖对照：见 **office-env-setup** 任务降级表。

## 禁止

- 不执行 `rm -rf /`、格式化磁盘、改防火墙等
- 未确认就全局 pip install
