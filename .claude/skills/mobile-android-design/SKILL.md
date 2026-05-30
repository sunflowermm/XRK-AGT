---
name: mobile-android-design
description: 当需要按 Material Design 3 与 Jetpack Compose 规范设计 Android 界面时使用。
---

## 权威入口

- ` .cursor/skills/mobile-android-design/references/material3-theming.md `
- ` .cursor/skills/mobile-android-design/references/compose-components.md `
- ` .cursor/skills/mobile-android-design/references/android-navigation.md `

## 适用场景

- Android 原生页面与组件设计。
- Compose 组件状态、布局与导航设计。
- 主题、动态色与深浅色模式一致性优化。

## 非适用场景

- 不用于 iOS 或 Web 端专属规范设计。
- 不替代业务流程建模与服务端接口设计。

## 执行步骤

1. 先按 Material 语义定义页面层级与主操作。
2. 设计 Compose 组件状态（enabled/disabled/error/loading）。
3. 统一主题 Token 与深浅色映射规则。
4. 明确导航流与返回行为。
5. 复核触控尺寸、可读性与无障碍语义。

## 常见陷阱

- 只做视觉对齐，忽略导航与返回一致性。
- 深色模式只改背景，不改文字和边界对比。
- 组件状态定义不完整，导致交互歧义。
