---
name: office-pptx
description: 演示文稿读/写/大纲/讲稿；python-pptx、markitdown；版式与配色规范
---

## 何时使用

PPT、幻灯片、路演、读 `.pptx`、汇报改 deck、演讲者备注。

## 读取

```bash
python -m markitdown deck.pptx > slides.md
```

```python
from pptx import Presentation
prs = Presentation("deck.pptx")
for i, slide in enumerate(prs.slides, 1):
    texts = [s.text.strip() for s in slide.shapes if hasattr(s, "text") and s.text.strip()]
    print(f"## 第{i}页\n" + "\n".join(f"- {t}" for t in texts))
```

## 推荐流程

1. **Markdown 大纲**（每页：标题 + 3–5 bullet + 演讲备注）
2. 用户确认
3. `python-pptx` 生成 `output.pptx` 到工作区
4. 返回路径与页数

## 版式

- 一页一主题；标题 ≤12 字
- 配色：一主色（60–70%）+ 辅色 + 强调色；禁止彩虹均分
- 结构：深色封面/总结 + 浅色正文（三明治）
- 数据用 chart/表，少段落堆砌
- 每页重复同一视觉元素（色条/图标圈）保持系列感

## 讲稿

另出 `speaker-notes.md`：每页 30–60 秒口播要点，与 slide 编号对应。

## 工具

`read` / `write` / `run` / `list_files`；依赖 `pip install python-pptx markitdown`

## 禁止

- 无成功 `run` 不声称已生成文件
- 不虚构 slide 内数据

## 缺环境

无 python-pptx → 只交付 Markdown 大纲 + 讲稿；见 **office-env-setup**
