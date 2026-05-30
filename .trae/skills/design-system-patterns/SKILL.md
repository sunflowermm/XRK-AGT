---
name: design-system-patterns
description: 当需要建设或重构设计系统（Design Token、主题体系、组件架构）时使用。
---

## 权威入口

- ` .cursor/skills/design-system-patterns/references/design-tokens.md `
- ` .cursor/skills/design-system-patterns/references/theming-architecture.md `
- ` .cursor/skills/design-system-patterns/references/component-architecture.md `

## 适用场景

- 需要统一多页面/多端视觉与交互规范。
- 需要建立主题切换（亮色/暗色/品牌变体）。
- 需要沉淀可复用组件 API 与命名体系。

## 非适用场景

- 不用于具体业务流程的后端设计。
- 不替代项目内已有组件实现细节排查。

## 执行步骤

1. 定义 Token 分层：基础值、语义值、组件值。
2. 约定主题策略：变量覆盖、优先级、回退规则。
3. 设计组件 API：状态、尺寸、变体、可访问性属性。
4. 建立约束：命名规范、弃用策略、变更记录。
5. 输出落地清单：新增项、迁移项、兼容风险。

## 常见陷阱

- Token 命名绑定具体颜色值，无法语义复用。
- 组件变体无限扩张，缺少边界控制。
- 主题切换只改颜色，忽略阴影、边框、对比度。
