---
name: office-xlsx
description: 真实 .xlsx/.csv 读写；tools.run + pandas/openpyxl，无专用 doc MCP
---

## 何时使用

用户给出或索要 **Excel 文件**（.xlsx/.xlsm/.csv），而非仅聊天里的 Markdown 表。

## 快速创建（优先）

**tools** 工作流 `run` + pandas/openpyxl：

```python
import pandas as pd
df = pd.DataFrame([{"姓名": "张三", "部门": "研发"}])
df.to_excel("台账.xlsx", index=False)
```

多 sheet 用 `pd.ExcelWriter`。

## 读取与分析

```python
import pandas as pd
df = pd.read_excel("input.xlsx", sheet_name=0)
print(df.head(20).to_markdown())
df.to_csv("export.csv", index=False, encoding="utf-8-sig")
```

CSV 用 `utf-8-sig` 便于 Excel 打开中文。

## 编辑规范（财务/台账类）

- 公式单元格避免硬编码魔法数；假设放独立单元格
- 交付前检查无 `#REF!` `#DIV/0!` 等错误
- 改用户已有表：先读结构，**保持原格式**，不强行统一字体
- 可选配色：输入蓝、公式黑、跨表链接绿、外部引用红（仅新表且无用户模板时）

## 与 office-sheet / office-csv 分工

| 场景 | 技能 |
|------|------|
| 聊天里整理表格、轻量对比 | office-sheet |
| 要生成/修改 xlsx 文件 | office-xlsx |
| 纯 CSV 清洗、多文件合并 | office-csv |

## 工具

- `read` / `write` / `run`（tools 工作流）
- 依赖：`pandas openpyxl`（`run` + pip 按需安装）

## 禁止

- 不编造单元格里没有的数值
- 不声称已保存 xlsx 除非工具返回成功路径

## 缺环境

无 pandas → **office-sheet** / **office-csv** 文本表或 CSV；见 **office-env-setup**
