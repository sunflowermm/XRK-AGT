---
name: assistant-core
description: 通用办事：先结论、后步骤、给验收；办公任务技能路由
---

## 流程

1. **结论**：一句话说明交付什么
2. **步骤**：可执行、可检查
3. **产物**：文件路径 / 正文 / 表格
4. **验收**：如何确认完成

## 技能路由

### 内容与沟通

| 任务 | 技能 |
|------|------|
| 邮件（对内/常规） | office-email |
| 对外冷邮件 / BD | office-outreach |
| 内部 3P / 周报 / 事故 / 通知 | office-internal |
| 会议前调研 / briefing 准备 | office-meeting-prep |
| 会议纪要 / 待办 | office-meeting |
| 录音转文字 | office-transcribe |
| 文稿结构 | office-doc |
| 轻量润色 | office-copy |
| 定稿多遍审校 | office-proofread |
| 调研摘要 | office-research |
| 计划拆解 | office-plan |
| 领导一页纸 / 决策 memo | office-briefing |
| 新闻稿 / 通稿 | office-press |
| 发版说明 / Changelog | office-changelog |
| 一稿多用 | office-repurpose |
| FAQ / 帮助条目 | office-faq |
| 聊天表格 | office-sheet |
| 图表 / 汇报插图 | office-chart |

### 文件格式

| 任务 | 技能 |
|------|------|
| PDF | office-pdf |
| PPT / .pptx | office-pptx |
| Word / .docx | office-docx |
| Excel / .xlsx | office-xlsx |
| CSV 清洗 / 合并 | office-csv |

### 环境与工具（XRK）

| 任务 | 技能 |
|------|------|
| **缺环境 / 探测 / 降级** | **office-env-setup** |
| 工作区读写搜 | office-env-workspace |
| 跑命令 / Python | office-env-shell |
| 抓网页 | office-env-web |
| 本机打开 / docx·xlsx 无 run | office-env-desktop |

### 长文与工程向

| 任务 | 技能 |
|------|------|
| 标书/白皮书分章 | office-long-doc |
| 技术手册/API 说明 | office-tech-writing |

### 回复格式

复杂交付、多文件、需验收 → **answer-format**

## 缺环境（总原则）

1. 读工作区 **`ENV.md`**
2. 加载 **office-env-setup**：主路径失败 → **必须给降级交付**
3. 不要因缺 Python/pandoc 就空回复

## 安全

删除、外发、run、pip、本机敏感操作：先说明影响，等用户确认。
