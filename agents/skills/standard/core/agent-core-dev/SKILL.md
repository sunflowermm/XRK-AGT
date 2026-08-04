---
name: agent-core-dev
description: 在工作区写完整 Core 业务层（plugin/http/workflow/events/commonconfig）：只写工作区、可读项目根、# 导入；用户说写插件、加命令、工作区 API、问架构时加载
---

> 读者：办事助手。  
> **硬边界：业务代码只写本工作区 `core/`；项目根 `.cursor` / `docs` / 仓库 `core` / `src` 只读。**  
> 编码真源在 Cursor 的 `xrk-*`（只读）。勿把 xrk 全文贴进回复。

## 硬边界（先读这段）

| 操作 | 允许 | 禁止 |
|------|------|------|
| **写** | `core/workspace-Core/**`（相对本工作区）；文稿等非代码可写工作区其它目录 | `../../../` 之外；`src/`；`.cursor/`；仓库 `core/system-Core` 与其它产品 Core |
| **读** | 工作区任意；项目根框架与示例（见下） | 读完再改回去；`run` 改工作区外文件 |
| **用户要你改框架** | 只读 + 给方案 / 说明请维护者用 Cursor | 假装已改仓库文件 |

工具会对「写出工作区」直接失败。不要尝试用绝对路径或 `run` 绕过。

---

## 地图（cwd = 本工作区）

```text
项目根/                          ← 相对工作区：../../../
  .cursor/skills/xrk-*/SKILL.md  ← 【只读】编码真源
  docs/*.md                      ← 【只读】契约
  core/system-Core/…             ← 【只读】示例
  package.json → imports         ← 【只读】# 别名
  src/                           ← 【只读】底层；你不改
  data/ai-workspace/{id}/        ← 你在这里（可写）
    core/workspace-Core/         ← 【可写】业务代码
    skills/ rules/ docs/ …       ← 【可写】办事文件
```

---

## 充分了解项目（写码 / 答架构前）

按需 `tools.read`（路径相对工作区）。**先总览再专题**，每任务约 2–4 个文件，勿一次灌完。

### 总览（第一次写 Core 或用户问「这项目怎么回事」）

1. `../../../.cursor/skills/xrk-project-overview/SKILL.md`
2. `../../../docs/runtime-surface.md`（裸名、`AgentRuntime`、Loader）
3. `../../../docs/base-classes.md`（各扩展点最小形状）
4. `../../../.cursor/skills/SKILL_INDEX.md`（还有哪些 xrk 可查）

### 写码专题

| 你在做 | 再 read |
|--------|---------|
| 任意 JS | `../../../.cursor/skills/xrk-coding-style/SKILL.md` → `xrk-node-runtime` |
| 消息插件 / `#命令` | `xrk-plugins`；对照 `../../../core/system-Core/plugin/` 只读示例 |
| HTTP | `xrk-http-api` |
| 工作流 | `xrk-ai-workflow` |
| 配置 schema | `xrk-config` |
| 扩展点迷路 | `xrk-infrastructure` · `../../../docs/框架可扩展性指南.md` |
| `#` 别名不确定 | `../../../package.json` 的 `imports` |

办公（邮件/表格）用 office-*，**不必**读 xrk-*。

---

## 放码（只写这里）

```text
core/workspace-Core/
  plugin/*.js          # 消息 / 定时 / 规则
  http/*.js            # HTTP API
  workflow/*.js        # AI 工作流（少用；办公优先 MCP）
  events/*.js          # 事件监听
  commonconfig/*.js    # 配置 schema（yaml 仍只在主服编辑）
  tasker/*.js          # 一般不碰
  www/<应用名>/        # 静态页（根名勿用 api|core|media|uploads|File|shared）
```

- 已有 `workspace-Core/plugin/`：增改 `.js` 可热加载  
- **新建另一个 Core 目录名**：需重启 / `#重启`  
- Loader 还扫仓库 `core/*`——你只写工作区这份

---

## 引入路径

工作区 Core **无**自有 `package.json`，`#` 解析到**仓库根**：

| 别名 | 落到 |
|------|------|
| `#infrastructure/*` | `src/infrastructure/*` |
| `#utils/*` | `src/utils/*` |
| `#factory/*` | `src/factory/*` |
| `#config/*` | `config/*` |
| `#data/*` | `data/*` |
| `#core/*` | 仓库 `core/*`（一般只读引用，勿当可写目标） |

### 裸名（勿 `global.` / 勿 `import AgentRuntime`）

| 符号 | 用途 |
|------|------|
| `PluginBase` | 插件基类 |
| `msgSegment` | 消息段 |
| `AgentRuntime` | 运行时；HTTP 用 `req.agentRuntime` |

```js
import { HttpResponse } from '#utils/http-utils.js';
import { normalizeError } from '#utils/normalize-error.js';
import { exec } from '#utils/exec-async.js';
import runtimeConfig from '#infrastructure/config/config.js';
```

禁止项以读到的 `xrk-node-runtime` / `xrk-coding-style` 为准（`node-fetch`、文件内 promisify、`instanceof Error` 判错等）。

---

## 最小形状

### plugin

```js
export class MyCmd extends PluginBase {
  constructor() {
    super({
      name: '我的命令',
      dsc: '#我的命令',
      event: 'message',
      priority: 5000,
      rule: [{ reg: '^#我的命令$', fnc: 'run' }],
    });
  }
  async run() {
    await this.reply(this.e?.msg || 'ok');
  }
}
```

### http

```js
import { HttpResponse } from '#utils/http-utils.js';

export default {
  routes: [{
    method: 'GET',
    path: '/api/workspace/ping',
    handler: HttpResponse.asyncHandler(async (req, res) => {
      return HttpResponse.success(res, { ok: true });
    }, 'workspace-ping'),
  }],
};
```

`HttpResponse.success`：普通对象拍平到顶层；数组/标量才进 `data`（见 `xrk-http-api`）。

其它扩展点：`base-classes.md` + 对应 xrk；对照 `system-Core` **只读**抄结构。

---

## 步骤

1. 确认落点在本工作区 `core/workspace-Core/`（否则拒绝改仓库）
2. 按「充分了解项目」补读 1–3 个真源文件
3. `grep` 工作区避免命令冲突
4. `write` / `search_replace` **只**动工作区内路径
5. 热加载或告知重启；触发句验收；不编造「已加载」

---

## 与 SKILL / Cursor

| | 工作区 Core | 办事 SKILL | Cursor xrk-* |
|--|-------------|------------|--------------|
| 写？ | ✅ 本工作区 `core/` | ✅ 本工作区 `skills/` | ❌ 只读 |
| 技能 | **agent-core-dev** | **agent-build-skill** | 路径见上表 |
