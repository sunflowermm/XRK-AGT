<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import ChatToolBlock from '@/components/ChatToolBlock.vue';
import XrkIcon from '@/components/XrkIcon.vue';
import { renderMarkdown, renderMermaidIn } from '@/chat/markdown';
import { resolveMediaUrl, segmentsToPlainText } from '@/chat/segments';

const props = defineProps({
  message: { type: Object, required: true },
  mode: { type: String, default: 'ai' },
  streaming: { type: Boolean, default: false },
  isLastStreaming: { type: Boolean, default: false },
});

const emit = defineEmits(['preview', 'copy', 'quote', 'regen', 'delete']);
const rootEl = ref(null);

const ROLE_LABEL = {
  user: '用户',
  assistant: '助手',
  system: '系统',
};

const ROLE_GLYPH = {
  user: '用',
  assistant: '助',
  system: '系',
};

const roleLabel = computed(() => ROLE_LABEL[props.message.role] || props.message.role);
const roleGlyph = computed(() => ROLE_GLYPH[props.message.role] || '·');


const segments = computed(() => {
  const m = props.message;
  if (Array.isArray(m.segments) && m.segments.length) {
    // 兼容历史：mcpTools 挂在消息上但未进 segments
    if (m.mcpTools?.length && !m.segments.some((s) => s?.type === 'tools')) {
      return [...m.segments, { type: 'tools', tools: m.mcpTools }];
    }
    return m.segments;
  }
  if (m.type === 'record' || m.type === 'chat-record') {
    return [];
  }
  const text = m.text || m.content;
  if (text) return [{ type: 'text', text }];
  if (m.mcpTools?.length) return [{ type: 'tools', tools: m.mcpTools }];
  return [];
});

const isRecord = computed(
  () => props.message.type === 'record' || props.message.type === 'chat-record',
);

const plain = computed(() => {
  if (isRecord.value) {
    return [props.message.title, props.message.description].filter(Boolean).join(' · ');
  }
  return props.message.text || props.message.content || segmentsToPlainText(segments.value) || '';
});

function md(text) {
  return renderMarkdown(text);
}

async function paintMermaid() {
  await nextTick();
  if (rootEl.value) await renderMermaidIn(rootEl.value);
}

onMounted(paintMermaid);
watch(segments, paintMermaid, { deep: true });

function onImgLoad(e) {
  e.target?.classList?.add('loaded');
}
function onImgError(e) {
  const img = e?.target;
  if (!img) return;
  img.classList.add('loaded');
  img.alt = '图片加载失败';
}
</script>

<template>
  <div
    ref="rootEl"
    class="msg"
    :data-role="message.role"
    :class="{ streaming: isLastStreaming && streaming }"
  >
    <span class="avatar" :title="roleLabel" :aria-label="roleLabel">{{ roleGlyph }}</span>
    <div class="bubble-wrap">
      <!-- 转发/记录卡片 -->
      <div v-if="isRecord" class="bubble record-card">
        <div v-if="message.title || message.description" class="record-hdr">
          <strong v-if="message.title">{{ message.title }}</strong>
          <p v-if="message.description">{{ message.description }}</p>
        </div>
        <div
          v-for="(line, i) in message.messages || []"
          :key="i"
          class="record-line"
          v-html="md(typeof line === 'string' ? line : line?.text || line?.content || '')"
        />
      </div>

      <div v-else class="bubble">
        <template v-for="(seg, si) in segments" :key="si">
          <div
            v-if="seg.type === 'text' || seg.type === 'markdown' || seg.type === 'raw'"
            class="seg-text"
            v-html="md(seg.text)"
          />
          <div v-else-if="seg.type === 'reply'" class="seg-reply">
            <span class="reply-label">引用</span>
            <span>{{ seg.text || seg.id || '' }}</span>
          </div>
          <div v-else-if="seg.type === 'at'" class="seg-at">@{{ seg.name || seg.qq || '' }}</div>
          <div v-else-if="seg.type === 'poke'" class="seg-poke">戳 · {{ seg.text || '戳一戳' }}</div>
          <div v-else-if="seg.type === 'image'" class="chat-image-container">
            <img
              class="chat-image"
              :src="resolveMediaUrl(seg.url)"
              :alt="seg.name || '图片'"
              loading="lazy"
              title="点击查看大图"
              @click="emit('preview', seg.url)"
              @load="onImgLoad"
              @error="onImgError"
            />
          </div>
          <div v-else-if="seg.type === 'video'" class="chat-media">
            <video :src="resolveMediaUrl(seg.url)" controls preload="metadata" class="chat-video" />
          </div>
          <div v-else-if="seg.type === 'record'" class="chat-media">
            <audio :src="resolveMediaUrl(seg.url)" controls preload="metadata" class="chat-audio" />
          </div>
          <div v-else-if="seg.type === 'file'" class="seg-file">
            <a :href="resolveMediaUrl(seg.url)" :download="seg.name || true" target="_blank" rel="noopener">
              📄 {{ seg.name || '文件' }}
            </a>
          </div>
          <ChatToolBlock v-else-if="seg.type === 'tools'" :tools="seg.tools || []" />
        </template>
      </div>

      <div v-if="message.role !== 'system'" class="msg-actions">
        <button type="button" class="act" @click="emit('copy', message)">
          <XrkIcon name="copy" :size="12" />
          复制
        </button>
        <button
          v-if="segments.some((s) => s.type === 'image')"
          type="button"
          class="act"
          @click="emit('preview', segments.find((s) => s.type === 'image').url)"
        >
          <XrkIcon name="image" :size="12" />
          看图
        </button>
        <button
          v-if="mode === 'event' && plain"
          type="button"
          class="act"
          @click="emit('quote', message)"
        >
          <XrkIcon name="quote" :size="12" />
          引用
        </button>
        <button
          v-if="message.role === 'assistant' && mode === 'ai'"
          type="button"
          class="act"
          :disabled="streaming"
          @click="emit('regen', message)"
        >
          <XrkIcon name="reload" :size="12" />
          重生成
        </button>
        <button type="button" class="act danger" @click="emit('delete', message)">
          <XrkIcon name="trash" :size="12" />
          {{ message.role === 'user' ? '撤回' : '删除' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  animation: msgIn 0.28s ease-out;
}
.msg[data-role='user'] {
  flex-direction: row-reverse;
}
@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.msg.streaming .bubble::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 1em;
  margin-left: 2px;
  background: var(--ink);
  animation: blink 0.9s step-end infinite;
  vertical-align: text-bottom;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.avatar {
  width: 32px;
  height: 32px;
  border: 1.5px solid var(--ink);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-xs);
  font-weight: 800;
  flex-shrink: 0;
  background: var(--card);
  box-shadow: var(--shadow);
  line-height: 1;
  margin-top: 2px;
}
.msg[data-role='user'] .avatar {
  background: var(--cyan);
}
.msg[data-role='assistant'] .avatar {
  background: var(--yellow);
}
.msg[data-role='system'] .avatar {
  background: color-mix(in srgb, var(--pink) 55%, var(--card));
  box-shadow: none;
  opacity: 0.85;
}
.bubble-wrap {
  min-width: 0;
  max-width: min(100%, 72%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
@media (max-width: 900px) {
  .bubble-wrap {
    max-width: 92%;
  }
}
.msg[data-role='user'] .bubble-wrap {
  align-items: flex-end;
}
.msg[data-role='system'] .bubble-wrap {
  max-width: 88%;
}
.bubble {
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--card);
  box-shadow: var(--shadow);
  font-size: 12.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  width: fit-content;
  max-width: 100%;
}
.msg[data-role='user'] .bubble {
  background: color-mix(in srgb, var(--cyan) 28%, var(--card));
  border-radius: 8px 2px 8px 8px;
}
.msg[data-role='assistant'] .bubble {
  background: color-mix(in srgb, var(--yellow) 32%, var(--card));
  border-radius: 2px 8px 8px 8px;
}
.msg[data-role='system'] .bubble {
  background: color-mix(in srgb, var(--pink) 18%, var(--card));
  box-shadow: none;
  font-size: 11.5px;
  color: var(--muted);
}
.record-card {
  background: color-mix(in srgb, var(--yellow) 18%, var(--card));
}
.record-hdr {
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed color-mix(in srgb, var(--ink) 30%, transparent);
}
.record-hdr p {
  margin: 2px 0 0;
  font-size: 11px;
  opacity: 0.7;
}
.record-line {
  margin: 4px 0;
  font-size: 12px;
}
.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  opacity: 0.7;
  justify-content: flex-start;
}
.msg[data-role='user'] .msg-actions {
  justify-content: flex-end;
}
.msg:hover .msg-actions {
  opacity: 1;
}
.act {
  border: 1.5px solid color-mix(in srgb, var(--ink) 40%, transparent);
  border-radius: 5px;
  background: var(--card);
  font: inherit;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 3px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink);
  line-height: 1.2;
}
.act:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.act.danger {
  color: #b00020;
}
.seg-text + .seg-text,
.seg-text + .chat-image-container {
  margin-top: 6px;
}
.seg-reply {
  border-left: 3px solid var(--pink);
  padding: 4px 8px;
  margin: 4px 0;
  background: color-mix(in srgb, var(--pink) 12%, var(--card));
  font-size: var(--font-sm);
  border-radius: 0 6px 6px 0;
}
.reply-label {
  font-weight: 800;
  font-size: var(--font-xs);
  margin-right: 6px;
  opacity: 0.6;
}
.seg-at {
  display: inline-block;
  background: color-mix(in srgb, var(--cyan) 35%, var(--card));
  border: 1px solid var(--ink);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: var(--font-xs);
  font-weight: 700;
}
.seg-poke {
  font-size: var(--font-sm);
  font-weight: 700;
}
.seg-file a {
  color: inherit;
  font-weight: 700;
  font-size: var(--font-sm);
}
.chat-image-container {
  margin-top: 4px;
}
.chat-image {
  display: block;
  max-width: min(100%, 420px);
  max-height: 360px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  border: 1.5px solid var(--ink);
  cursor: zoom-in;
  opacity: 0.35;
  transition: opacity 0.2s ease;
}
.chat-image.loaded {
  opacity: 1;
}
.chat-media {
  margin-top: 4px;
}
.chat-video,
.chat-audio {
  max-width: 100%;
  display: block;
}
.bubble :deep(p) {
  margin: 0 0 0.3em;
}
.bubble :deep(p:last-child) {
  margin-bottom: 0;
}
.bubble :deep(pre) {
  overflow: auto;
  font-size: var(--font-xs);
  margin: 4px 0;
  padding: 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.bubble :deep(code) {
  font-family: var(--mono);
  font-size: 0.92em;
}
.bubble :deep(.chat-mermaid) {
  margin: 6px 0;
  overflow: auto;
}
.bubble :deep(.chat-mermaid-error) {
  color: #b00020;
  font-size: var(--font-xs);
}
</style>
