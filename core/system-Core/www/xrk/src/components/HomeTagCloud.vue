<script setup>
import { computed, nextTick, onMounted, onUpdated, ref } from 'vue';
import { sizeClass, toneClass } from '@/home/metrics';

const props = defineProps({
  items: { type: Array, default: () => [] },
  tipPrefix: { type: String, default: 'tip' },
});

const root = ref(null);

function tipId(item, i) {
  const base = String(item.seed ?? item.label ?? 'x')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return `${props.tipPrefix}-${i}-${base || 'n'}`;
}

function updateFlip(chip) {
  if (!chip) return;
  const r = chip.getBoundingClientRect();
  chip.classList.toggle('popover-flip', r.top < 96);
}

function refreshFlips() {
  const el = root.value;
  if (!el) return;
  el.querySelectorAll('.chip').forEach((chip) => updateFlip(chip));
}

onMounted(() => nextTick(refreshFlips));
onUpdated(() => nextTick(refreshFlips));

const chips = computed(() =>
  props.items.map((item, i) => ({
    ...item,
    size: sizeClass(item.seed ?? item.label ?? i),
    tone: toneClass(item.seed ?? item.label ?? i),
    tip: tipId(item, i),
    stagger: i,
  })),
);
</script>

<template>
  <div ref="root" class="tag-cloud" role="list">
    <div
      v-for="chip in chips"
      :key="chip.tip"
      class="chip"
      :class="[`size-${chip.size}`, `tone-${chip.tone}`, { disabled: chip.disabled }]"
      :style="{ '--stagger': chip.stagger }"
      role="listitem"
      @mouseenter="(e) => updateFlip(e.currentTarget)"
      @focusin="(e) => updateFlip(e.currentTarget)"
    >
      <button type="button" class="chip-btn" :aria-describedby="chip.tip">
        <span class="chip-label">{{ chip.label }}</span>
        <span v-if="chip.badge" class="chip-badge" aria-hidden="true">{{ chip.badge }}</span>
      </button>
      <div :id="chip.tip" class="popover" role="tooltip">
        <div class="pop-title">{{ chip.popoverTitle || chip.label }}</div>
        <div v-if="chip.popoverKey" class="pop-key mono">{{ chip.popoverKey }}</div>
        <p class="pop-desc">{{ chip.desc || '暂无描述' }}</p>
        <ul v-if="chip.facts?.length" class="pop-facts">
          <li v-for="(f, fi) in chip.facts" :key="fi">
            <span>{{ f.label }}</span>
            <em>{{ f.value }}</em>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 4px 5px;
  padding: 2px 0;
}
.chip {
  position: relative;
  flex: 0 0 auto;
  animation: chip-in 0.36s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(var(--stagger, 0) * 22ms);
}
@keyframes chip-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chip {
    animation: none;
  }
}
.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 0;
  max-width: min(160px, 100%);
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  box-shadow: var(--shadow);
  transition: transform 100ms ease, box-shadow 100ms ease;
}
.size-sm .chip-btn {
  padding: 2px 6px;
  font-size: var(--font-xs);
}
.size-md .chip-btn {
  padding: 2px 7px;
  font-size: 11px;
}
.size-lg .chip-btn {
  padding: 3px 8px;
  font-size: 11.5px;
}
.tone-primary .chip-btn {
  background: color-mix(in srgb, var(--cyan) 28%, var(--card));
}
.tone-success .chip-btn {
  background: color-mix(in srgb, var(--green) 28%, var(--card));
}
.tone-warning .chip-btn {
  background: color-mix(in srgb, var(--yellow) 40%, var(--card));
}
.tone-info .chip-btn {
  background: color-mix(in srgb, var(--pink) 22%, var(--card));
}
.disabled .chip-btn {
  opacity: 0.62;
  filter: grayscale(0.12);
}
.chip-btn:hover,
.chip-btn:focus-visible {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 var(--ink);
}
.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-badge {
  flex-shrink: 0;
  font-size: var(--font-xs);
  font-weight: 800;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid var(--ink);
  background: var(--muted);
  color: var(--card);
}
.popover {
  position: absolute;
  z-index: 40;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%) translateY(4px);
  min-width: 200px;
  max-width: min(280px, calc(100vw - 32px));
  padding: 10px 12px;
  border: 2px solid var(--ink);
  border-radius: 10px;
  background: var(--card);
  box-shadow: 3px 3px 0 var(--ink);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms;
}
.chip:hover .popover,
.chip:focus-within .popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.chip.popover-flip .popover {
  bottom: auto;
  top: calc(100% + 8px);
  transform: translateX(-50%) translateY(-4px);
}
.chip.popover-flip:hover .popover,
.chip.popover-flip:focus-within .popover {
  transform: translateX(-50%) translateY(0);
}
.pop-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 2px;
}
.pop-key {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
  word-break: break-all;
}
.pop-desc {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}
.pop-facts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}
.pop-facts li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
}
.pop-facts em {
  font-style: normal;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
</style>
