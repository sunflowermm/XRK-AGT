# Remotion / Vue starter notes

## Remotion (React)

```bash
cd tmp/<slug>-video
npm create video@latest   # or pnpm create video
# composition: 1080x1920, 30fps
```

Use:

- `Sequence` for timed scenes aligned to VO seconds
- `spring` / `interpolate` for enter
- `Img` + `staticFile('assets/icon-qq.png')`
- `Audio` from `voice.mp3` in composition **or** mux with ffmpeg after render

Do **not** burn captions in the composition by default.

## Vue 3 + @vueuse/motion (or motion-v)

Single `App.vue` stage `1080×1920`; child components for each scene; timeline in `composables/useTimeline.ts` driven by `performance.now()` or audio `currentTime`.

Record with Playwright `recordVideo` then ffmpeg mux VO (same as current `record.mjs`).

## Migration from HTML prototype

1. Keep `assets/` and `voice.mp3`
2. Port each `.scene` block → React/Vue component
3. Delete neon/canvas HUD leftovers
4. Re-render; run anti-AI checklist in SKILL.md
