---
name: responsive-design
description: 当需要实现响应式布局（断点、流式排版、容器查询、移动优先）时使用。
---

## 权威入口

- ` .cursor/skills/responsive-design/references/breakpoint-strategies.md `
- ` .cursor/skills/responsive-design/references/fluid-layouts.md `
- ` .cursor/skills/responsive-design/references/container-queries.md `

## 适用场景

- 页面需适配手机、平板、桌面等多尺寸设备。
- 组件需要独立响应父容器变化。
- 需要避免硬编码尺寸造成的溢出与断行。

## 非适用场景

- 不用于替代业务逻辑或接口性能优化。
- 不用于“只做 PC 固定宽度”的单端页面。

## 执行步骤

1. 采用移动优先设计基础布局。
2. 定义关键断点与内容重排策略。
3. 关键组件启用容器查询与弹性单位。
4. 检查表单、表格、导航在窄屏可用性。
5. 验证 375/768/1024/1440 等尺寸表现。

## 常见陷阱

- 仅缩放元素，不重排信息结构。
- 用过多固定像素导致局部溢出。
- 忽略横屏与超宽屏下的阅读体验。
