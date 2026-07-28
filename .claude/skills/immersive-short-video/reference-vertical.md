# Vertical composition reference

## Safe layout (1080×1920)

```
┌────────────────────────────┐
│  progress (optional, thin) │  ~40–56px from top
│  eyebrow / tag             │  ≥100px from top
│                            │
│     PRIMARY VISUAL         │  one block: phone OR card stack
│     (flex column, gap 18+) │
│                            │
│  caption (one line)        │  ≥180px from bottom
└────────────────────────────┘
  side inset ≥56–64px
```

## Preferred components

| Component | Use |
|-----------|-----|
| `PhoneChat` | Hook: status bar, app icons, avatar, bubbles |
| `IconHero` | Large PNG + title + one sentence |
| `InfoStack` | 2–4 full-width rows with icon + title + meta |
| `WarnStamp` | Runtime/policy forbid moment |
| `ChannelRow` | QQ / Feishu / Bot icons only (no dense graph) |
| `ActionCards` | Vertical cards: CLI / CI / Scope |
| `Finale` | Big icon + 3 badges |

## Motion rules

- Enter: opacity + 16–28px Y spring, stagger 120–180ms
- Scene cut: crossfade ≤350ms; no white flash spam
- Idle: at most one subtle loop (typing dots / progress), not camera shake

## Color (product, not cyber)

- Page: `#E9EEF2` / cards `#FFFFFF` / ink `#1A2330` / muted `#6B7785`
- Accent teal `#0F8F6E` · danger `#D9485F` · QQ blue `#12B7F5`
- Shadows: soft `rgba(26,35,48,0.10)` — no neon glow
