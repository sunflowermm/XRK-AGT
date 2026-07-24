# 成片录制（权威路径）

> 本文件记录 **XRK 短视频默认录屏方法**。样例实现：`tmp/xrk-agt-intro/record.mjs` + `scenes.html`。

## 为什么不用 Playwright screencast

| 做法 | 结果 |
|------|------|
| `page.video()` / screencast + 2× 再拉到 60fps | 掉帧、卡顿、「好卡」 |
| `animations: 'disabled'` 再截屏 | CSS 动画全死，画面僵硬 |
| 仅靠 CSS `@keyframes` + 实时播放录屏 | seek 不准；重渲不可复现 |

**正确路径**：页面暴露可 seek 时间轴 → Playwright 按帧 `evaluate(__XRK_SEEK__)` → JPEG 序列 → `h264_nvenc` + 口播 AAC。

## 硬性约定

1. 分辨率 `1080×1920`，`deviceScaleFactor: 1`，`FPS = 60`。
2. 打开场景页时带 `?capture=1`（关闭口播自动播放，只渲染静帧）。
3. 页面必须提供：
   - `window.__XRK_DUR__` — 秒数（与 `voice.mp3` 对齐）
   - `window.__XRK_SEEK__(t)` — 把画面画到绝对时间 `t`（秒）
4. 每一帧：`__XRK_SEEK__(i/FPS)` → 等一帧 `requestAnimationFrame` → `page.screenshot` JPEG quality≈92。
5. 编码优先 NVIDIA：`h264_nvenc` preset `p5`，VBR，`cq` 16–17，`-b:v 12M–14M`，`-shortest` 叠 `voice.mp3`。
6. 成片自检：有声、竖屏、无误交 `silent.mp4`。

## 场景页（分镜级运动）

录制只负责「拍下当前时刻」；**动感来自 JS 时间轴**，不是 CSS 进场后冻结。

### 必须

- 所有入场用 `[data-fx]` + `data-d`（本镜相对延迟），在 `__XRK_SEEK__` → `render(t)` 里按 `local = t - sceneStart` 算 opacity/transform。
- 场景切换：交叉淡化（约 0.5–0.7s）+ 轻微上下推 + 轻微 scale，可加短 blur。
- 全程镜头：`#cam` 缓慢 zoom / drift（Ken Burns 量级），避免静止 PPT。
- 环绕、打字机、Logo 呼吸等持续运动：用绝对 `t` 驱动，capture 与预览同一套 `render`。

### 禁止

- 依赖实时 `CSS animation` / `transition` 做主入场（seek 时不可复现或需负 delay 黑魔法）。
- `page.emulateMedia({ reducedMotion })` / Playwright `animations: 'disabled'`。
- 2× 录屏再 `fps=60` 上采样。

### 预览 vs 捕获

```js
const CAPTURE = new URLSearchParams(location.search).has('capture');
// CAPTURE: 只 render(0)，等外部 __XRK_SEEK__
// 预览: rAF 循环 render(elapsed)，可同步播 voice
```

## record.mjs 骨架

完整可改模板见 [scripts/record-seek-nvenc.mjs](scripts/record-seek-nvenc.mjs)。核心循环：

```js
await page.goto(fileUrl + '?capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__XRK_SEEK__ === 'function');
const DUR = await page.evaluate(() => window.__XRK_DUR__);
const totalFrames = Math.ceil(DUR * 60);

for (let i = 0; i < totalFrames; i++) {
  const t = i / 60;
  await page.evaluate((sec) => window.__XRK_SEEK__(sec), t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.screenshot({
    path: `frames/f-${String(i).padStart(5, '0')}.jpg`,
    type: 'jpeg',
    quality: 92,
  });
}
```

Chromium 建议参数（Windows + NVIDIA 友好）：

```
--disable-dev-shm-usage
--use-angle=d3d11
--enable-gpu-rasterization
--enable-zero-copy
--ignore-gpu-blocklist
```

## ffmpeg（NVENC）

```bash
ffmpeg -y -framerate 60 -i frames/f-%05d.jpg -i voice.mp3 \
  -vf "format=yuv420p,fps=60" \
  -map 0:v:0 -map 1:a:0 \
  -c:v h264_nvenc -preset p5 -rc vbr -cq 16 -b:v 14M -maxrate 20M -bufsize 28M \
  -profile:v high -movflags +faststart \
  -c:a aac -b:a 320k -ar 48000 -shortest \
  out.mp4
```

无独显时：`-c:v libx264 -preset medium -crf 17`，可降到 30fps 减帧数。

编码后删掉 `frames/`；用 `ffprobe` 确认 `1080×1920`、`60/1`、时长≈口播。

## 性能预期

- 约 20 f/s 截屏（视机器而定）；48s@60fps ≈ 2900 帧 ≈ 2–3 分钟截完 + 十余秒 NVENC。
- JPEG 暂存远快于 PNG；质量 90–92 足够竖屏短视频。

## 踩坑备忘

1. 打开的是中间产物 `silent.mp4` → 用户以为无声；只交付最终有声文件。
2. 烧录 SRT 大字幕 → 像 PPT；默认不烧字幕。
3. Finale 环绕圆心要对准 Logo+标题，不要漂到别处。
4. 画面僵硬：缺镜头漂移 / 切镜 overlap / 入场用 back easing，而不是「弹一下就停」。
