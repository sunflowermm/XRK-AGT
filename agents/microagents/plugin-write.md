---
name: plugin-write
description: 用户要写工作区插件/HTTP/Core 扩展时注入通用写法；直接 write，勿翻底层
triggers:
  - 写插件
  - 加个插件
  - 加一个插件
  - 写个插件
  - 工作区插件
  - Core 插件
  - 写 HTTP
  - 写接口
  - workspace-Core
  - #命令
  - plugin
---

# 写工作区 Core（本段已注入）

- 落盘：`core/workspace-Core/{plugin|http|…}/`（仅本工作区）
- 用户已要求写 → **立刻 write**；禁止先翻 `src/` / Tasker / 整份长文档
- 「继续/确认」→ 接着写，禁止把同一批文档重读一遍

## 按类型选骨架

| 类型 | 目录 | 入口 |
|------|------|------|
| 聊天命令 | `plugin/` | `event: 'message'` + `rule[].reg/fnc` |
| 通知事件 | `plugin/` | `event: 'notice…'` + 多在 **`accept()`**（`rule` 可 `[]`） |
| HTTP | `http/` | `export default { routes }` + `HttpResponse` |
| 其它 | workflow / events / commonconfig | 字段表 → read **agent-core-dev** 对应节 |

## message 示例

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

## notice 要点（一类事件，不单指某玩法）

- 事件键形如 `notice.<detail>.<sub>`，可用 `*` 段匹配（段数一致），例如 `notice.group.increase`、`notice.*.poke`。
- **优先 `accept()`**：过滤 `sub_type` / `target_id` 等后做事，返回 `'return'` 截断或 `false` 跳过。
- 具体字段与更多配方：read 一次 `skills/core/agent-core-dev/SKILL.md`。

写完：路径 + 怎么验收。需要 `super`/`rule`/HTTP 形状/workflow·config 全表时再 read **agent-core-dev**（一次即可）。
