---
name: web-component-design
description: 当需要构建 Web 组件体系（React/Vue/Svelte 组件模式与 API 设计）时使用。
---

## 权威入口

- ` .cursor/skills/web-component-design/references/component-patterns.md `
- ` .cursor/skills/web-component-design/references/css-styling-approaches.md `
- ` .cursor/skills/web-component-design/references/accessibility-patterns.md `

## 适用场景

- 需要设计可复用组件与稳定组件 API。
- 需要统一样式方案（CSS Modules/CSS-in-JS/原子类）。
- 需要提升组件无障碍与可测试性。

## 非适用场景

- 不用于替代页面级视觉创意设计。
- 不用于服务端业务逻辑或数据建模问题。

## 执行步骤

1. 确定组件职责边界与组合关系。
2. 设计 props/slots/events 等对外接口。
3. 统一样式策略与主题扩展方式。
4. 补齐可访问性属性与键盘交互。
5. 输出使用示例与反例，约束误用场景。

## 常见陷阱

- 组件承担过多业务职责，难以复用。
- API 过度灵活，导致行为不可预测。
- 样式穿透过深，后续维护成本高。
