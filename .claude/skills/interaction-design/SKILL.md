---
name: interaction-design
description: 当需要设计交互细节（动效、过渡、反馈、加载状态）并提升体验时使用。
---

## 权威入口

- ` .cursor/skills/interaction-design/references/microinteraction-patterns.md `
- ` .cursor/skills/interaction-design/references/animation-libraries.md `
- ` .cursor/skills/interaction-design/references/scroll-animations.md `

## 适用场景

- 需要增强交互反馈与操作确定性。
- 需要统一动效时长、节奏与状态切换。
- 需要优化加载、提交、错误恢复体验。

## 非适用场景

- 不用于替代业务逻辑与接口容错设计。
- 不为了“炫技”加入无意义动画。

## 执行步骤

1. 标注关键状态：默认、悬停、激活、加载、成功、失败。
2. 设计最小有效反馈：优先可感知和可理解。
3. 统一时长与缓动，并考虑低性能设备。
4. 增加 `prefers-reduced-motion` 兜底方案。
5. 验证交互连续性：不中断主任务流。

## 常见陷阱

- 动画过长导致响应“变慢”。
- 只做进入动画，不处理退出与中断状态。
- 忽略减弱动画偏好与可访问性要求。
