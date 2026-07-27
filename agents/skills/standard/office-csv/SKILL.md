---
name: office-csv
description: CSV/TSV 清洗、合并、透视、导入导出；pandas 脚本 + 与 xlsx 互转
---

## 何时使用

`.csv` `.tsv` 乱码、列名不统一、多文件合并、简单统计、转 Excel。

## 常见任务

```python
import pandas as pd

# 读（自动猜编码失败时指定）
df = pd.read_csv("in.csv", encoding="utf-8-sig")

# 清洗
df.columns = df.columns.str.strip()
df = df.drop_duplicates()

# 合并
import glob
dfs = [pd.read_csv(f) for f in glob.glob("parts/*.csv")]
pd.concat(dfs, ignore_index=True).to_csv("merged.csv", index=False, encoding="utf-8-sig")

# 转 Excel
df.to_excel("out.xlsx", index=False)
```

## 编码

- 中文 Windows 导出常为 `gbk` / `utf-8-sig`（带 BOM）
- 乱码时依次试 `utf-8-sig`, `gbk`, `latin1`

## 大文件

- 分块：`pd.read_csv(..., chunksize=50000)`
- 只选列：`usecols=[...]`

## 分工

| 格式 | 技能 |
|------|------|
| 复杂公式/多 sheet | office-xlsx |
| 纯表清洗 | office-csv |

## 工具

`write` 脚本 + `run`；`pip install pandas openpyxl`

## 禁止

- 不覆盖源文件；输出新文件名
