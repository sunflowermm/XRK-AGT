# 办事助手说明

办事助手是 XRK 运行时里的**对话 Agent**：在群聊、控制台或 stdin 里帮你查资料、写文稿、整理表格、管理工作区文件。  
仓库里的 `agents/` 是**种子模板**；真正运行时用的是 `data/ai-workspace/{id}/` 里那份（首次自动复制，之后以你改过的为准）。

> **分工**：本助手面向**日常办事**；在 Cursor 里改 XRK 框架源码，请用仓库根目录的 `AGENTS.md` 与 `.cursor/skills/xrk-*`。

---

## 这个助手能帮你做什么

| 场景 | 举例 |
|------|------|
| **写与改** | 邮件、纪要、简报、对外稿、FAQ、润色与校对 |
| **表格与演示** | 整理数据、做表、图表说明、PPT 大纲与内容 |
| **查与汇总** | 联网检索、资料对比、调研摘要（带来源） |
| **规划** | 任务拆解、方案与验收点（可先只谈计划、不动文件） |
| **工作区整理** | 在你的专属文件夹里找草稿、改文档、列目录 |
| **环境相关** | 本机 Python、文档转换、浏览器/桌面工具是否可用 |

助手会先匹配**技能**（办公、检索、环境等），再调用 MCP 工具（读文件、搜网、发消息通道等）。不确定时会先问清楚再动手。

---

## 怎么用

### 在哪里说话

- **群聊 / QQ 机器人**：@ 助手或按群规则触发；适合短问短答、纪要、提醒类事务。
- **控制台 / stdin**：适合长任务、连续改稿、批量整理工作区文件。
- **HTTP / 设备通道**：与具体 Core 配置有关，见各产品说明。

### 工作区是什么

可以把工作区理解成**这只助手的专属文件夹**：

- 人格与习惯：`SOUL.md`、`USER.md`
- 运行规则：`AGENTS.md`（助手怎么帮你办事）
- 本机备注：`TOOLS.md`、`ENV.md`（邮箱习惯、常用路径、依赖是否装好）
- 记忆：`memory/`（当天流水 + 长期偏好）
- 技能副本：`skills/`（从仓库种子同步；你改过的不会被覆盖）
- 你的文稿与数据：可放在工作区下的 `docs/` 等子目录

首次启用时会从 `agents/workspace/` 复制缺省文件；之后改 `data/ai-workspace/{id}/` 里的内容即可，**不必**去改仓库里的种子（除非你想更新默认模板给所有人）。

### 想改助手行为时

| 想改什么 | 改哪里 |
|----------|--------|
| 语气、红线、群聊习惯 | 工作区 `AGENTS.md` |
| 你的称呼、偏好 | `USER.md`、`memory/MEMORY.md` |
| 本机路径、邮箱、依赖 | `TOOLS.md`、`ENV.md` |
| 加规则 | `agents/rules/`（或工作区等价位置，见实现索引） |
| 换「主助手 / 专项助手」说明 | `subagents.yaml` |

---

## 技能大概有哪些类

技能是注入给助手的**办事手册**；对话里会看到 `<available_skills>` 目录，助手按需读取对应 `SKILL.md`。

| 类别 | 做什么 | 代表技能 |
|------|--------|----------|
| **基础** | 路由、工具选用、回答格式、记忆、浏览器 | agent-core、agent-tools、answer-format、agent-search、agent-memory、agent-browser |
| **沟通** | 邮件、对外联络、内部通知、会议与纪要 | office-email、office-outreach、office-internal、office-meeting、office-meeting-prep、office-transcribe |
| **文稿** | 文档、润色、调研、计划、简报 | office-doc、office-docx、office-copy、office-proofread、office-research、office-plan、office-briefing |
| **对外发布** | 通稿、更新说明、FAQ、内容改写 | office-press、office-changelog、office-faq、office-repurpose |
| **表格** | 表格逻辑、Excel、CSV、图表说明 | office-sheet、office-xlsx、office-csv、office-chart |
| **演示与 PDF** | PPT、PDF 处理 | office-pptx、office-pdf |
| **环境与工作区** | 依赖检测、工作区文件、Shell/Web/桌面 | office-env-setup、office-env-workspace、office-env-shell、office-env-web、office-env-desktop |
| **长文与专业写作** | 长文档、技术写作 | office-long-doc、office-tech-writing |

完整名单以运行时 `<available_skills>` 为准；新增技能可从仓库 `agents/skills/standard/` 同步到工作区（不覆盖你已改过的副本）。

---

## Agents 清单（主助手与专项）

`subagents.yaml` 描述**几种办事角色**，注入给模型作路由提示；**不是**隔离的子进程，也不会自动切换底层模型。

| 名称 | 类型 | 什么时候用 | 人话说明 |
|------|------|------------|----------|
| **assistant** | 主助手 | 日常问答、办公、读写工作区 | 默认入口：先匹配技能，再动手；改文件前会谨慎 |
| **plan** | 主助手 | 要方案、拆任务、评风险，还没让改文件 | 只分析和规划，输出步骤与验收点，少改文件 |
| **research** | 专项 | 开放问题、对比、政策/产品资料要上网查 | 专注检索与摘要，标注来源与不确定处 |
| **docs** | 专项 | 写邮件、纪要、润色、docx/xlsx/pdf/pptx | 专注文稿与办公格式产出 |
| **workspace** | 专项 | 在工作区里找材料、改草稿、整理目录 | 只管你的办事文件夹，不碰框架源码 |

工作区根目录若有同名 `subagents.yaml`，**优先于**仓库 `agents/subagents.yaml`。

---

## 改工作区文件的注意

助手在工作区里改你的文稿时，应遵守：

| 情况 | 用什么 | 说明 |
|------|--------|------|
| **改已有文件里的一小段** | 局部替换 | 先找到位置，再只改那一段，避免整篇重写 |
| **新建文件** | 写入新文件 | 适合从零开始的草稿 |
| **整篇重写已有文件** | 写入并明确覆盖 | 只有用户要求或全文改版时才整篇覆盖 |
| **查找** | 读文件、搜关键词、列目录 | 改之前先确认改对了文件 |

若发现助手总是整文件覆盖，可在对话里要求「只改某段」；或在 `AGENTS.md` 里强调局部修改。

---

## 隐私与确认

- **不要**把密钥、token、身份证号等写进记忆或群聊；`.env` 类文件不要当普通文稿改。
- **删除文件、对外发送、在本机执行命令**前，助手应说明影响并征得你确认。
- 不确定的数据应标注「待核实」，不编造来源。
- 群聊里克制回复：被 @、被提问、能给出可执行价值时再说话，避免刷屏。

---

## 实现索引（维护者）

| 主题 | 路径 |
|------|------|
| 仓库种子 | `agents/` |
| 运行时工作区 | `data/ai-workspace/{id}/` |
| 注入逻辑 | `src/utils/agent-workspace.js` |
| 路径常量 | `src/utils/agent-workspace-paths.js` |
| 配置默认 | `config/default_config/ai-workflow.yaml` → `agentWorkspace` |
| Schema | `core/system-Core/commonconfig/system/system-ai-workflow.js` |
| 文件工具实现 | `core/system-Core/workflow/tools.js`、`src/utils/base-tools.js` |
| Agents 清单种子 | `agents/subagents.yaml` |
| 技能种子 | `agents/skills/standard/` |
| 规则种子 | `agents/rules/` |
| MCP 工具总表 | [mcp-guide.md](mcp-guide.md)、[mcp-config-guide.md](mcp-config-guide.md) |
| 工作流基类 | [ai-workflow.md](ai-workflow.md) |
| 种子 README | [agents/README.md](../agents/README.md) |

Prompt 注入顺序（assistant → contextFiles → rules → Skills → Agents）与 `include*` 门控见 `agent-workspace.js` 与 `ai-workflow.yaml`。
