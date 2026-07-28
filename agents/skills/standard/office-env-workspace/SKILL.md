---
name: office-env-workspace
description: |
  Agent 工作区文件读写：找文件、读草稿、改内容、搜关键字、整理目录；cwd 为 data/ai-workspace。
  触发词：「在工作区找」「读一下那个文件」「帮我改文档」「搜一下有没有 XX」「列一下目录」「保存到工作区」。
  跑命令/脚本走 office-env-shell；打开本机文件夹走 office-env-desktop。
metadata:
  version: 2.0.0
---

# 工作区文件操作

你是办事助手的工作区管理员。目标：在 **`data/ai-workspace/{id}/`** 内**准确找到、安全修改、清晰归档**——不动仓库源码，除非用户明确授权。

## 何时使用

- 找文件、读配置、写草稿、批量搜关键字
- 整理 `docs/`、`exports/`、`scripts/` 目录
- 改已有 Markdown/CSV/脚本；新建办公产出
- 维护根目录 **`ENV.md`** 环境清单

**A 档基础能力，几乎总是可用。**

**不适用**：执行 Python/pip/格式转换（→ **office-env-shell**）；打开 Windows 资源管理器（→ **office-env-desktop**）；抓网页（→ **office-env-web**）；改仓库 `core/`/`src/` 源码（默认禁止，除非用户明确要动代码并选 project 工作区）。

## 动手前：问清什么 / 缺省假设

| 信息 | 缺省假设 |
|------|----------|
| 工作区 | cwd = `data/ai-workspace/{id}/`（与 `tools.file.workspace` 一致） |
| 产出位置 | 文稿 `docs/`；导出 `exports/`；脚本 `scripts/` |
| 改 vs 新建 | **已有文件只 search_replace**；新建才 write |
| 覆盖 | 已存在文件 write 须 `overwrite=true` |
| 大文件 | 先 `grep` 定位，再分段 `read` |
| 源码 | 默认**不改**仓库根项目文件 |

用户给模糊文件名：先 `list_files` 或 `grep`，最多展示 3 个候选请用户选。

## 原则

### 先列再读，避免猜路径

`list_files` → `read`。路径错误比慢一步更浪费用户时间。

### 小改用 search_replace

精确子串替换；**不为改一行而整文件 write**（防误覆盖）。

### 办公产出集中放

统一 `docs/`、`exports/`、`scripts/`，方便用户与后续技能（docx、xlsx）衔接。

### 降级仍落工作区

无 run 时仍可交付 Markdown / 纯文本 / JSON——这是一切降级的最后落脚点（见 **office-env-setup**）。

### ENV.md 是环境真相

能力档位、已装工具、run 状态写在根 **`ENV.md`**；探测后更新，避免重复问用户。

## 目录习惯

```
工作区根/
├── ENV.md          # 环境清单（A–E 档）
├── docs/           # 文稿、大纲、邮件草稿
├── exports/        # xlsx、pdf、png 等导出
├── scripts/        # 待 run 的 py/sh
├── memory/         # MEMORY.md、日流水（见 agent-memory）
└── output/         # 浏览器截图等工具输出
```

长文档分章：`docs/<项目>/ch-NN.md`（见 **office-long-doc**）。

## 工具怎么用

| 工具 | 用途 | 注意 |
|------|------|------|
| `list_files` | 列目录（可递归） | 先看清结构 |
| `read` | 读文本（有大小上限） | 大文件分段 |
| `grep` | 正则搜内容 | 定位再 read |
| `search_replace` | **改已有文件** | 精确匹配 |
| `write` | **新建**；覆盖需 `overwrite=true` | 勿滥用覆盖 |
| `delete_file` | 删除 | **需用户确认** |

| 场景 | 流程 |
|------|------|
| 改邮件草稿 | `read` → `search_replace` |
| 新建报告 | `write` → `docs/报告名.md` |
| 找含关键词的文件 | `grep` → `read` |
| 批量整理 | 先列计划，再逐个改；删文件先确认 |

## 质量检查清单

- [ ] 路径在工作区内且文件存在（或明确新建）？
- [ ] 改已有文件是否用了 search_replace 而非整文件 write？
- [ ] 是否避免读写 `.env`、密钥路径？
- [ ] 删除是否经用户点名确认？
- [ ] 产出是否放在 docs/exports 等约定目录？

## 禁止

- 不读写工作区外敏感路径（`.env`、密钥、系统目录）
- 不删除未点名的文件
- 不为小改动整文件 `write` 覆盖
- 默认不改仓库源码

## 相关技能

| 技能 | 关系 |
|------|------|
| **office-env-shell** | 工作区内 run 脚本 |
| **office-env-desktop** | 打开 exports 给用户看 |
| **office-env-setup** | ENV.md 与能力档位 |
| **office-long-doc** | 分章大文档结构 |
| **agent-memory** | memory/ 目录维护 |
