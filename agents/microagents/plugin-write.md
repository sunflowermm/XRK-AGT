---
name: plugin-write
description: 用户要写工作区插件/HTTP/workflow/MCP 时注入选型；直接 write；远程 MCP 用 getMcpServers；不会写再只读底层
triggers:
  - 写插件
  - 加个插件
  - 加一个插件
  - 写个插件
  - 工作区插件
  - Core 插件
  - 写 HTTP
  - 写接口
  - 写工作流
  - 写 workflow
  - MCP
  - mcpServers
  - getMcpServers
  - registerMCPTool
  - 远程 MCP
  - 挂载 MCP
  - 挂个 MCP
  - 定时任务
  - 多轮
  - workspace-Core
  - #命令
  - plugin
---

# 写工作区 Core（已注入）

- 落盘：`core/workspace-Core/{plugin|http|workflow|…}/`
- 已要求写 → **立刻 write**（选型够用时）
- 「继续/确认」→ 接着写，禁止空转重读
- **不会写** → 只读：`agent-core-dev` → `xrk-*` / `docs` / 示例 / 必要时 `src/`；仍只写工作区
- **禁止**改 `ai-workflow.yaml` / 系统配置；挂远程 MCP 用下面 JS

## 对号入座

| 类型 | 目录 | 模式 |
|------|------|------|
| 聊天命令 | `plugin/` | `message` + `rule` |
| 通知/请求 | `plugin/` | `notice…`/`request…` + 多在 **`accept()`** |
| 多轮 | `plugin/` | `setContext` / `finish` |
| 定时 | `plugin/` | `task:[{ cron, fnc }]` |
| HTTP | `http/` | `routes` + `HttpResponse` |
| 自研 MCP 工具 | `workflow/` | `registerMCPTool` |
| 用户给 `{ "mcpServers": … }` / 挂远程 | `workflow/` | **`export function getMcpServers()`** + 占位 `export default` AiWorkflow |
| 配置 schema | `commonconfig/` | `ConfigBase` |

## 远程 MCP 最小例（优先）

```js
import AiWorkflow from '#infrastructure/ai-workflow/ai-workflow.js';
export default class RemoteMcpMount extends AiWorkflow {
  constructor() {
    super({ name: 'example-mcp', description: '挂载远程 MCP', version: '1.0.0', priority: 5000, capabilities: ['tools'] });
  }
  async init() { await super.init(); }
}
export function getMcpServers() {
  return { '服务器名': { url: 'https://…' } }; // 原样映射用户 JSON；也可用 command+args
}
```

勿 `registerMCPTool`+`fetch` 空壳。新建 `workflow/` → 提醒重启。验收：`检测到 MCP 插件服务器` → `remote-mcp.<名>.*`。

message 最小例：

```js
export class MyCmd extends PluginBase {
  constructor() {
    super({
      name: '我的命令', dsc: '#我的命令', event: 'message', priority: 5000,
      rule: [{ reg: '^#我的命令$', fnc: 'run' }],
    });
  }
  async run() { await this.reply('ok'); }
}
```

字段全表与其它配方 → read **一次** `agent-core-dev`。写完给路径 + 验收。
