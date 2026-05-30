---
name: mobile-ios-design
description: 当需要按 iOS HIG 与 SwiftUI 规范设计 iOS 界面时使用。
---

## 权威入口

- ` .cursor/skills/mobile-ios-design/references/hig-patterns.md `
- ` .cursor/skills/mobile-ios-design/references/swiftui-components.md `
- ` .cursor/skills/mobile-ios-design/references/ios-navigation.md `

## 适用场景

- iOS 原生界面布局与组件设计。
- SwiftUI 页面结构、状态与导航策略。
- 对齐 iOS 交互预期（手势、转场、信息层级）。

## 非适用场景

- 不用于 Android 或 Web 端设计规范。
- 不替代业务域规则与后端错误处理定义。

## 执行步骤

1. 依据 HIG 确定页面信息层级与交互优先级。
2. 设计 SwiftUI 组件状态与可访问性标签。
3. 统一导航结构（层级、模态、返回）。
4. 校验动态字体、暗黑模式与触控可达性。
5. 复核平台一致性，避免“跨平台生搬硬套”。

## 常见陷阱

- 用 Android 交互习惯直接套到 iOS。
- 模态与导航层级混乱，用户难以返回。
- 忽略系统字体缩放导致可读性问题。
