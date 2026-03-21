---
name: accessibility-compliance
description: 当需要进行无障碍审查或实现 WCAG 2.2（含 ARIA、键盘可达、读屏支持）时使用。
---

## 权威入口

- ` .cursor/skills/accessibility-compliance/references/wcag-guidelines.md `
- ` .cursor/skills/accessibility-compliance/references/aria-patterns.md `
- ` .cursor/skills/accessibility-compliance/references/mobile-accessibility.md `

## 适用场景

- 页面需要通过键盘可操作与焦点可见性检查。
- 组件需要补全语义与 ARIA 状态。
- 需要兼容屏幕阅读器与移动端辅助功能。

## 非适用场景

- 不用于视觉风格美化或品牌设计决策。
- 不替代业务接口、鉴权、数据层逻辑排查。

## 执行步骤

1. 先检查语义标签和交互元素角色是否正确。
2. 再检查焦点顺序、Tab 可达、Esc/Enter 行为。
3. 补全名称与状态（label、aria-*、错误提示）。
4. 验证颜色对比、文本缩放、移动端可点区域。
5. 输出问题清单：严重级别、复现方式、修复建议。

## 常见陷阱

- 只加 `aria-label`，忽略真实可操作行为。
- 仅鼠标可用，键盘无法完整完成任务流。
- 用颜色单独传达状态，导致信息不可感知。
