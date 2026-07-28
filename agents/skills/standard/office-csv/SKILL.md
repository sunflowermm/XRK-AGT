---
name: office-csv
description: |
  CSV/TSV 清洗、合并、编码修复、简单统计、与 Excel 互转；pandas 脚本处理表数据。
  触发词：「洗 CSV」「合并几个表」「CSV 乱码」「转 Excel」「去重」「列名统一」「TSV」。
  复杂多 sheet/公式走 office-xlsx；聊天轻量表走 office-sheet。
metadata:
  version: 2.0.0
---

# CSV / TSV 数据处理

你是办事助手的表格清洗员。目标：**编码正确、列名统一、不覆盖原文件**——输出新文件名，可追溯。

## 何时使用

- `.csv` `.tsv` 乱码、列名不统一、空行多余
- 多文件合并、去重、简单分组统计
- CSV ↔ Excel 互转、按列筛选导出
- 大文件分块处理

**不适用**：复杂 Excel 公式、多 sheet 样式（→ **office-xlsx**）；只要聊天 Markdown 表（→ **office-sheet**）；数据库级 ETL。

## 动手前：问清什么 / 缺省假设

| 信息 | 缺省假设 |
|------|----------|
| 编码 | 依次试 `utf-8-sig`, `gbk`, `latin1` |
| 输出 | **新文件名**（如 `merged-clean.csv`），不覆盖源文件 |
| 分隔符 | CSV 逗号；TSV 制表符 |
| 中文 Excel | 导出用 `utf-8-sig`（带 BOM） |
| 大文件 | `chunksize=50000` 分块；`usecols` 选列 |

先 `read` 前几行或 `run` 探针确认分隔符与编码。

## 原则

### 源文件只读

输出一律新路径；改前说明「将生成 XX，不动原文件」。

### 列名规范

`strip` 首尾空格；统一大小写策略（用户指定）；缺列名则 `Unnamed` 或拒绝并问。

### 空值一致

全表统一 `NaN` → 空字符串或 `-`（与 **office-sheet** 一致）。

### 合并要对齐

`concat` 前检查列集合；缺列补空或报差异表。

### 统计要可复核

汇总数字附「行数、过滤条件」说明。

## 常见任务模板

```python
import pandas as pd

# 读（编码失败时指定）
df = pd.read_csv("exports/in.csv", encoding="utf-8-sig")

# 清洗
df.columns = df.columns.str.strip()
df = df.drop_duplicates()

# 合并
import glob
dfs = [pd.read_csv(f, encoding="utf-8-sig") for f in glob.glob("exports/parts/*.csv")]
pd.concat(dfs, ignore_index=True).to_csv("exports/merged.csv", index=False, encoding="utf-8-sig")

# 转 Excel
df.to_excel("exports/out.xlsx", index=False)
```

**大文件：**

```python
chunks = pd.read_csv("big.csv", chunksize=50000, usecols=["id", "name", "date"])
# 分块聚合后写结果
```

## 工具怎么用

| 场景 | 工具 |
|------|------|
| 看样例 | `read`（小 CSV）或脚本 head |
| 写脚本 | `write` → `scripts/clean-csv.py` |
| 执行 | `run`（**office-env-shell**） |
| 改脚本 | `search_replace` |
| 验收 | `list_files` + 行数摘要 |

`pip install pandas openpyxl` 需用户确认。

## 质量检查清单

- [ ] 是否未覆盖源文件？
- [ ] 编码是否正确（中文无乱码）？
- [ ] 合并后行数/列是否合理？
- [ ] 去重规则是否说明（全行 / 按某列）？
- [ ] 数字是否与源数据一致（未编造）？

## 禁止

- 不覆盖用户未指定的源 CSV
- 不静默丢弃大量行（须说明过滤条件）
- 不编造单元格数据

## 相关技能

| 技能 | 分工 |
|------|------|
| **office-xlsx** | 多 sheet、公式、格式 |
| **office-sheet** | 聊天表、轻量整理 |
| **office-chart** | 清洗后出图 |
| **office-env-shell** | run + pip |
| **office-env-workspace** | 文件读写 |
