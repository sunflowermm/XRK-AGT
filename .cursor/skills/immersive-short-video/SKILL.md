---
name: immersive-short-video
description: >-
  Produce immersive vertical short videos (口播/科普/产品讲解) without AI-slop aesthetics.
  Covers magenta-key assets, chroma-key, JS/Remotion/Vue seekable timelines, TTS, and the
  canonical Playwright frame-seek + h264_nvenc assemble path. Use for 短视频, 口播, 科普视频,
  explainer, Remotion, 生图抠图, 动画帧, 录屏, NVENC, or the XRK video pipeline.
---

# Immersive Short Video Pipeline

后续短视频**默认走本 skill**。目标：竖屏 9:16、代入感强、**少 AI 味**（像真实 App/IM 界面，不像霓虹 HUD 演示片）。

## Non-negotiables

1. **画幅**：默认 `1080×1920`。禁止左右双栏挤一屏；单列 + 安全区。
2. **安全区**：上 ≥100px · 下 ≥180px · 左右 ≥56px。一镜一个主视觉。
3. **去 AI 味**：禁止霓虹网格、粒子扫描线、赛博 HUD、紫渐变玻璃拟态堆叠、居中巨大描边字幕叠画面。
4. **代入感**：优先模拟真实产品——QQ/飞书式聊天、系统设置卡、CLI 终端、CI 面板；多用**图标/头像 PNG**，少纯 CSS 几何装饰。
5. **字幕**：默认**不烧录**；口播靠声音；画面内只保留短标题（一句）。
6. **资源规范**：需抠图的素材一律 **纯品红底 `#FF00FF`** 生成，再跑抠图脚本。

## End-to-end flow

```text
选题/口播稿 → TTS(mp3+时间轴)
  → 分镜表(竖屏·一镜一意)
  → 生图(品红底 icons/avatars/UI 切图)
  → chroma_key → 透明 PNG
  → 可 seek 场景页(JS 时间轴 / Remotion / Vue)
  → record: __XRK_SEEK__ 逐帧截屏 @60fps + h264_nvenc → 成片 mp4
```

工作目录建议：`tmp/<slug>-video/`（含 `assets/` `scenes/` `voice.*` `record.*` `README.md`）。

## Step 1 — Script & VO

- 中文口播约 **180–220 字/分**；抖音/视频号常见 **40–60s**。
- 结构：钩子 3s → 问题 → 解释 → 正确做法 → 收束。
- TTS：本机可用 `edge-tts`（如 `zh-CN-YunyangNeural`）；写出 `voice.mp3`，可选 `voice.srt` 仅作时间轴参考（**不烧进片**）。

## Step 2 — Vertical storyboard

每镜只答一个问题。表头：`t_start` `t_end` `visual` `on_screen_line` `assets`。

| 时段 | 画面类型（优先） |
|------|------------------|
| 钩子 | 真实 IM 手机框 + 气泡入场 |
| 概念 | 大图标 + 2–4 张竖向信息卡 |
| 风险 | 警告图标 + 短列表 |
| 做法 | 全宽竖卡堆叠（CLI / CI / Scope） |
| 收束 | 主图标 + 3 枚徽章 |

## Step 3 — Generate images (magenta key)

用 `GenerateImage`（或等价生图）时 **必须** 在 prompt 末尾锁定：

```text
Solid pure magenta #FF00FF fills the entire background canvas.
Subject centered. No other background. No text. No watermark.
Magenta everywhere outside the subject for chroma key.
```

命名：`assets/<name>-magenta.png`（如 `icon-qq-magenta.png`、`avatar-bot-magenta.png`）。

图标风格：圆角方标 App icon / 圆形头像；像商店上架图，不要插画风噪点堆满。

## Step 4 — Chroma key

```bash
python .cursor/skills/immersive-short-video/scripts/chroma_key.py \
  --input tmp/<slug>-video/assets \
  --glob "*-magenta.png"
```

产出同目录去后缀透明图：`icon-qq.png`。容差默认适配 AI 压缩品红边缘。

## Step 5 — Scene tech stack（选一）

无论 A/B/C，**动效必须可由绝对时间 `t` 复现**（供 Step 6 seek 截屏）。禁止只靠实时 CSS `@keyframes` 播一遍再录。

### 分镜级运动（必做）

- `[data-fx]` + `data-d`：JS `render(t)` 算入场（easeOutBack / easeOutQuart），像分镜不是 UI pop。
- 切镜：交叉淡化 ~0.65s + 轻推拉/位移；全程 `#cam` 缓慢 drift/zoom。
- 暴露 `window.__XRK_DUR__` 与 `window.__XRK_SEEK__(t)`；`?capture=1` 静帧，预览用 rAF。
- 参考实现：`tmp/xrk-agt-intro/scenes.html`。

### A. Remotion（React）

- `AbsoluteFill` `Sequence` `spring` `interpolate`；竖屏 1080×1920。
- 有 CLI 时 `npx remotion render`；否则导出可 seek 预览页走 Step 6。

### B. Vue 3 + Motion / GSAP

- `data-a/data-b` 对齐口播；组件化卡片；同样要可 seek 到任意 `t`。

### C. 纯 HTML（快速成片可用）

- 单列竖屏 + 上节时间轴；样例 `tmp/xrk-agt-intro/`。

## Step 6 — Assemble（权威录屏 · 必须遵守）

> 完整说明：[reference-capture.md](reference-capture.md) · 模板：[scripts/record-seek-nvenc.mjs](scripts/record-seek-nvenc.mjs)

**默认路径（有 NVIDIA）**：Playwright 按帧 `__XRK_SEEK__` → JPEG@60fps → `h264_nvenc` + `voice.mp3`。

1. 画面时长 = 口播时长（±0.3s）；`DUR` 与 mp3 对齐。
2. `node record.mjs`（从模板复制到 `tmp/<slug>/`，改输出文件名）。
3. **禁止**：Playwright screencast / `page.video()` 再 2× 或 fps 上采样到 60；禁止 `animations: 'disabled'`。
4. 无独显：同 seek 流程，改 `libx264` CRF 17，可降到 30fps。
5. 成片自检：有声、`1080×1920`、约 60fps；勿交付 `silent.mp4`。

## Anti-AI checklist（交付前勾选）

- [ ] 有真实图标/头像 PNG，不是全靠几何形
- [ ] 背景是纸感/产品灰或真实 UI，不是赛博粒子场
- [ ] 文字少、靠下或作短标题，无大字叠字
- [ ] 动效像 App 过渡（slide/fade/spring），不像演示 HUD
- [ ] 一镜一意，列表不超过 4 条可见项
- [ ] 品红原图保留在 `assets/*-magenta.png` 便于重抠

## Project conventions (XRK-AGT)

- 权威录屏样例：`tmp/xrk-agt-intro/`（`scenes.html` 时间轴 + `record.mjs` seek/NVENC）。
- 早期样例：`tmp/strix-kepu-anim/`。
- 科普内容需与仓库文档一致，勿编造接口。
- 不把临时成片提交进 `core/` / `src/`。

## Extra reference

- **录屏权威路径**：[reference-capture.md](reference-capture.md)
- 竖屏构图与组件约定：[reference-vertical.md](reference-vertical.md)
- 生图 prompt 模板：[reference-prompts.md](reference-prompts.md)
- Remotion / Vue 栈：[reference-stacks.md](reference-stacks.md)
