---
name: react-native-design
description: 当需要实现 React Native 跨端界面（样式、导航、动画）时使用。
---

## 权威入口

- ` .cursor/skills/react-native-design/references/styling-patterns.md `
- ` .cursor/skills/react-native-design/references/navigation-patterns.md `
- ` .cursor/skills/react-native-design/references/reanimated-patterns.md `

## 适用场景

- React Native 页面结构和组件样式设计。
- 多端统一导航体验与交互反馈。
- 基于 Reanimated 的性能可控动效设计。

## 非适用场景

- 不用于原生 Android/iOS 专属设计规范替代。
- 不替代状态管理、网络请求等业务层实现。

## 执行步骤

1. 先定义跨端一致与平台差异边界。
2. 统一组件样式系统（字号、间距、颜色、圆角）。
3. 明确导航层级与返回行为。
4. 为关键交互添加轻量且可降级动效。
5. 复核低端机性能与可访问性标签。

## 常见陷阱

- 追求“全端完全一致”，忽略平台习惯。
- 动画未做降级导致掉帧。
- 触控区域偏小影响可用性。
