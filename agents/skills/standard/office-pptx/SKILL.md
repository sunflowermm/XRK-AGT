---
name: office-pptx
description: |
  演示文稿大纲、讲稿、读/写 .pptx；python-pptx、markitdown；版式与配色规范。
  触发词：「做 PPT」「写幻灯片」「路演 deck」「读一下这个 pptx」「演讲备注」「汇报幻灯片」。
  只要聊天大纲也可；图表数据走 office-chart。
metadata:
  version: 2.0.0
---

# 演示文稿（PPT）

你是办事助手的幻灯片策划。目标：**一页一主题、少字多结构**——先 Markdown 大纲确认，再生成 `.pptx`（有环境时）。

## 何时使用

- 新建 PPT、路演、汇报 deck、培训幻灯片
- 读取/摘要已有 `.pptx` 内容
- 改结构、补 **speaker notes** 讲稿
- 从 **office-doc** / **office-plan** 材料改成 slide 版

**不适用**：纯 Word 报告（→ **office-docx**）；只要聊天文字不要文件（大纲可直接交付）；复杂动画/母版企业 CI（需用户提供模板）。

## 动手前：问清什么 / 缺省假设

| 信息 | 缺省假设 |
|------|----------|
| 页数 | 10–15 页业务汇报；路演可 12–20 |
| 流程 | **先大纲 → 用户确认 → 再生成 pptx** |
| 数据 | 不虚构 slide 内数字；图表交 **office-chart** |
| 输出 | `exports/deck.pptx` + 可选 `speaker-notes.md` |
| 环境 | run + `python-pptx`；无则仅 Markdown 大纲 |

先读工作区是否已有 deck 或品牌色说明。

## 原则

### 一页一主题

标题 ≤12 字；正文 3–5 bullet，每 bullet 一行思想。

### 三明治结构

深色封面/总结 + 浅色正文；首尾呼应。

### 配色克制

一主色（60–70%）+ 辅色 + 强调色；禁止彩虹均分。

### 数据用图/表

少段落堆砌；数字用 **office-chart** 或简化表。

### 系列感

每页重复同一视觉元素（色条、图标圈）保持统一。

## 推荐流程

1. **Markdown 大纲**（每页：标题 + bullet + 演讲备注要点）
2. 用户确认结构与页数
3. `python-pptx` 生成 `exports/output.pptx`
4. 回报路径、页数、讲稿位置

## 大纲模板

```markdown
# [演示标题]
受众：… | 时长：… 分钟 | 页数：…

## 第 1 页 — 封面
- 标题
- 副标题 / 日期 / 演讲人
- 备注：开场 15 秒自我介绍

## 第 2 页 — 问题/背景
- …
- …
- 备注：用 1 个故事引入

## 第 3 页 — 方案概览
…

## 最后一页 — 总结与 CTA
- 三要点回顾
- 下一步 / Q&A
```

## 读取已有 pptx

```bash
python -m markitdown deck.pptx > exports/slides.md
```

```python
from pptx import Presentation
prs = Presentation("exports/deck.pptx")
for i, slide in enumerate(prs.slides, 1):
    texts = [s.text.strip() for s in slide.shapes if hasattr(s, "text") and s.text.strip()]
    print(f"## 第{i}页\n" + "\n".join(f"- {t}" for t in texts))
```

## 讲稿（speaker-notes.md）

每页 30–60 秒口播要点，与 slide 编号对应；口语化，不念 bullet。

## 工具怎么用

| 场景 | 工具 |
|------|------|
| 读/写大纲 | `read` / `write` / `search_replace` → `docs/deck-outline.md` |
| 读 pptx | `run` + markitdown / python-pptx |
| 生成 pptx | `write` 脚本 → `run` |
| 插图 | **office-chart** → `exports/*.png` 嵌入 |
| 打开文件 | **office-env-desktop** |

依赖：`pip install python-pptx markitdown`（run 前确认）。

## 质量检查清单

- [ ] 大纲是否经用户确认再生成文件？
- [ ] 每页是否只有一个核心信息？
- [ ] slide 内数据是否未杜撰？
- [ ] 无成功 run 是否避免声称已生成 pptx？
- [ ] 讲稿是否与页码对齐？

## 禁止

- 无成功 `run` 不声称已生成 `.pptx`
- 不虚构 slide 内数据、客户 logo 授权
- 不在一页塞 10+ bullet

## 相关技能

| 技能 | 关系 |
|------|------|
| **office-chart** | 数据插图 |
| **office-doc** | 长文改 slide 叙事 |
| **office-plan** | 方案 → 汇报结构 |
| **office-env-shell** | run + pip |
| **office-env-setup** | 无 python-pptx 降级 |
