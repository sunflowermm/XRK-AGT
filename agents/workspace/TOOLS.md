# TOOLS.md — 本地环境备注

把**只对你这台机器/账号成立**的信息写在这里，避免每次对话重复说明。

## 本机能力（ENV.md）

与 `ENV.md` 同步维护：Python/pandoc/run 是否可用。Agent 缺依赖时会降级（Markdown、desktop 生成 docx），并在确认后更新 ENV。

## 办公与协作

- 常用邮箱 / 署名：
- 企业微信 / 飞书 / 钉钉 习惯用语：
- 文档默认存放：（例：`data/ai-workspace/default/docs/`）

## 设备与路径

- 打印机 / 扫描仪：
- 常用共享盘 / SSH 别名：
- 本 Bot HTTP 地址：（例：`http://127.0.0.1:端口`）

## 技能索引（工作区 `skills/`）

| 类别 | 技能名 |
|------|--------|
| Agent 基础 | agent-core, agent-tools, agent-search, agent-browser, agent-memory, answer-format |
| 沟通 | office-email, office-outreach, office-internal, office-meeting, office-meeting-prep, office-transcribe |
| 文稿 | office-doc, office-docx, office-copy, office-proofread, office-research, office-plan, office-briefing |
| 对外 | office-press, office-changelog, office-repurpose, office-faq |
| 表格 | office-sheet, office-xlsx, office-csv, office-chart |
| 演示 | office-pptx |
| PDF | office-pdf |
| 环境 | office-env-setup, office-env-workspace, office-env-shell, office-env-web, office-env-desktop |
| 长文 | office-long-doc, office-tech-writing |

完整列表见对话 `<available_skills>`；新增技能从 `skills/standard` 种子同步（不覆盖你已改的副本）。

## 格式

- 一条一行，用 `##` 分块
- 有变更就更新本文件，不必在聊天里重复
