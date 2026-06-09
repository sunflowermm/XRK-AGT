---
name: office-chart
description: 图表选型、matplotlib 出图、汇报插图；避免错误图表类型
---

## 何时使用

汇报要图、趋势/对比/占比可视化、从表格生成 PNG 插入 PPT/Word。

## 选型

| 关系 | 推荐 | 避免 |
|------|------|------|
| 时间趋势 | 折线 | 饼图 |
| 分类对比 | 条形（类多→横向） | 折线 |
| 占比 | 堆叠条 /  treemap | 多个饼图 |
| 相关 | 散点 | 条形 |
| 单指标 | 大数字 KPI | 整图 |

## 工作区出图（run）

```python
import matplotlib.pyplot as plt
plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

labels, values = ["Q1","Q2","Q3"], [10, 14, 18]
fig, ax = plt.subplots(figsize=(8, 4))
ax.bar(labels, values, color="#2563eb")
ax.set_title("季度销量")
for i, v in enumerate(values):
    ax.text(i, v + 0.3, str(v), ha="center")
plt.tight_layout()
plt.savefig("chart.png", dpi=150)
```

`pip install matplotlib`；图片存工作区供 `open_path` 或嵌入 doc。

## 说明文字

每张图附：**图题 + 数据来源 + 一句解读**（放邮件/PPT 备注）。

## 禁止

- 纵轴不从 0 截断（除非双轴且注明）
- 3D 饼图

## 缺环境

无 matplotlib → 文字描述 + Markdown 表；见 **office-env-setup**
