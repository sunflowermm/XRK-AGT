---
name: agent-skillhub
description: 用 skillhub --dir 装到工作区 skills/；自建 write；托管 #skills更新；国内优先源
---

> **读者：办事助手模型**。装技能必须进本工作区 `skills/`，不是 Cursor/`agents/skills` 种子目录。

## 本仓生效目录（`--dir` 就填这个）

| | 路径 |
|--|------|
| 相对 tools cwd | `skills`（或绝对路径见下） |
| 默认绝对路径 | `<项目根>/data/ai-workspace/default/skills` |
| 其它工作区 | `<项目根>/data/ai-workspace/{id}/skills` |

目录卡扫描：种子 `agents/skills/standard(+ /core)` **∪** 上述工作区 `skills/`（同名工作区优先）。

**不要**装到：`~/.cursor/skills/`、仓库 `agents/skills/`、随便 `./skills/`（若 cwd 不是工作区根则助手看不见）。

---

## 推荐：SkillHub + `--dir`（可指定目录）

真源：[SkillHub 安装说明](https://skillhub.cn/install/skillhub.md)。  
要点：安装时**必须** `--dir` 指向当前 Agent 的 skills 目录，否则默认 `./skills/` 可能不被识别。

### 1. CLI 是否已有

```bash
command -v skillhub && skillhub --version
```

未装且用户要装商店技能时（需联网 / `run` 可能要开）：

```bash
# 仅 CLI
curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only
```

首次装 CLI 或用户明确要求「优先源」时，才问一次是否把 SkillHub 设为优先；**纯搜索/安装不要反复问**。

### 2. 搜索 / 安装进本工作区

```bash
skillhub search <关键词>

# {id} 默认 default；路径按实际工作区改
skillhub install <技能名或 slug> --dir "<项目根>/data/ai-workspace/default/skills"
```

相对写法（先 `cd` 到项目根或已知工作区父目录时）：

```bash
skillhub install <slug> --dir "data/ai-workspace/default/skills"
```

装前向用户确认：来源、名称、将写入的 `--dir`；`read` 装上的 `SKILL.md` 再启用。  
不可用/无匹配时可回退说明（文档称可回退 clawhub 等），仍须 `--dir` 指到**本工作区 skills**。

`tools.file.runEnabled` 默认关：无 run 时改用手写（下节）或请主人开 run 后再装。

---

## 备选：纯 MCP 自建（无 CLI）

1. `tools.write` → `skills/<自有名>/SKILL.md`  
2. frontmatter：`name` + `description`  
3. 下一轮进 `<available_skills>`；细则 `tools.read` location  

勿占用托管相对路径（如 `core/agent-tools`）。写法见 **agent-build-skill**。

`npx skills add` 默认进 Cursor 等目录，**不**等于本工作区；除非装完再拷进上表 `skills/`，否则不要当作本仓装法。

---

## 托管更新（主人）

`#skills更新`：种子里有的托管包**按种子覆盖**；工作区里种子没有的目录（用户自建）**不动**。

锁：工作区 `.xrk/managed-skills-lock.json`。

---

## 红线

1. 第三方安装：**永远**带 `--dir` → `data/ai-workspace/{id}/skills`。  
2. 不往 `.cursor/skills`、种子仓 `agents/skills/standard` 乱装用户包。  
3. 装完确认 `skills/<名>/SKILL.md` 存在再让用户依赖该技能。
