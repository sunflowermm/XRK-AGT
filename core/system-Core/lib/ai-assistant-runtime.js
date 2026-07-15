/**
 * AI 助手运行时 — 底层走 AGT stream.process / AiStreamLoader.mergeStreams
 */
import AiStreamLoader from '#infrastructure/ai-workflow/loader.js';
import ChatStream from '../stream/chat.js';

export const AI_FULL_PROMPT_DUMP_REGEX = /#?XRK完整AI上下文/;

const cooldownState = new Map();

function resolveAiConfigInstance() {
  try {
    const cm = typeof CommonConfigRegistry !== 'undefined' ? CommonConfigRegistry : null;
    if (!cm?.get) return null;
    const direct = cm.get('ai_config') || cm.get('system-Core/ai_config');
    if (direct) return direct;
    if (typeof cm.getAll === 'function') {
      for (const [key, inst] of cm.getAll()) {
        if (key === 'ai_config' || String(key).endsWith('/ai_config')) return inst;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** 始终走 CommonConfigRegistry（若已就绪）或模板实例；勿缓存过期快照 */
export async function loadAiAssistantConfig() {
  const inst = resolveAiConfigInstance();
  if (inst && typeof inst.read === 'function') {
    return inst.read(true);
  }
  if (inst && typeof inst === 'object' && !inst.read) {
    return inst;
  }
  const { default: AIConfig } = await import('../commonconfig/ai_config.js');
  return new AIConfig().read(true);
}

export function stripAiFullPromptDumpMark(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  return raw
    .replace(AI_FULL_PROMPT_DUMP_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function rawMessageTextForAiTrigger(e) {
  if (e?.msg != null && String(e.msg).trim() !== '') return String(e.msg);
  if (!Array.isArray(e?.message)) return '';
  return e.message.map((seg) => (seg?.type === 'text' ? (seg.text || '') : '')).join('');
}

/**
 * 解析 chat 主流。组合副流由 runChatAgent → process({ mergeStreams }) 唯一完成。
 */
export function resolveChatStream(plugin, _config) {
  return plugin.getStream?.('chat') || AiStreamLoader.getStream?.('chat') || null;
}

export function isInAiWhitelist(e, config) {
  if (!config) return false;
  if (e.isGroup) {
    return config.groups?.some((g) => String(g) === String(e.group_id)) ?? false;
  }
  return config.users?.some((u) => String(u) === String(e.user_id)) ?? false;
}

export async function shouldTriggerAI(e, config) {
  if (!config) return false;
  if (e.atBot) return isInAiWhitelist(e, config);
  if (config.prefix && e.msg?.startsWith(config.prefix)) {
    return isInAiWhitelist(e, config);
  }
  if (!e.isGroup) return false;
  if (!isInAiWhitelist(e, config)) return false;

  const groupId = String(e.group_id);
  const now = Date.now();
  const cooldown = (config.cooldown ?? 300) * 1000;
  const chance = config.chance ?? 0.1;
  const last = cooldownState.get(groupId) || 0;
  if (now - last < cooldown) return false;
  if (Math.random() < chance) {
    cooldownState.set(groupId, now);
    return true;
  }
  return false;
}

export async function processMessageContent(e, config) {
  const fallback = e.msg || '';
  const message = e.message;
  if (!Array.isArray(message)) return stripAiFullPromptDumpMark(String(fallback));

  try {
    let content = '';
    if (e.source && typeof e.getReply === 'function') {
      try {
        const reply = await e.getReply();
        if (reply) {
          const name = reply.sender?.card || reply.sender?.nickname || '未知';
          content += `[回复${name}的"${reply.raw_message || ''}"] `;
        }
      } catch { /* ignore */ }
    }
    for (const seg of message) {
      if (seg.type === 'text') content += seg.text || '';
      else if (seg.type === 'at') {
        const qq = seg.qq ?? seg.user_id ?? seg.data?.qq;
        if (qq != null && String(qq) !== String(e.self_id)) {
          content += `@${qq} `;
        }
      } else if (seg.type === 'image') content += '[图片] ';
    }
    if (config?.prefix) {
      content = content.replace(new RegExp(`^${config.prefix}`), '');
    }
    return stripAiFullPromptDumpMark(content.trim());
  } catch (err) {
    logger.error(`[XRK-AI] processMessageContent: ${err.message}`);
    return stripAiFullPromptDumpMark(String(fallback));
  }
}

/** 走 AGT AiWorkflow.process：唯一热路径 mergeStreams */
export async function runChatAgent(_plugin, e, {
  text,
  persona = '',
  config,
  isGlobalTrigger = false,
  debugDumpFullPrompt = false,
} = {}) {
  const stream = resolveChatStream(_plugin, config);
  if (!stream) {
    logger.error('[XRK-AI] chat 工作流未加载');
    return false;
  }

  const ms = Array.isArray(config?.mergeStreams) ? config.mergeStreams : [];
  await stream.process(
    e,
    {
      content: text,
      text,
      persona,
      isGlobalTrigger,
      debugDumpFullPrompt: !!debugDumpFullPrompt,
    },
    {
      mergeStreams: ms,
    },
  );
  return true;
}

export async function handleClearConversation(e) {
  const historyKey = ChatStream.getEventHistoryKey(e) ?? String(e.group_id || e.user_id);
  const result = await ChatStream.clearConversation(historyKey, { e });
  if (result.success) {
    const items = [];
    if (result.cleared.history) items.push('聊天记录');
    await e.reply(`✅ 对话已重置！已清除：${items.join('、') || '无'}`);
  } else {
    await e.reply('❌ 清除对话失败，请稍后重试');
  }
  return true;
}

export function logAiInit(config) {
  logger.mark(`[XRK-AI] 就绪 · 群白名单 ${config.groups?.length || 0} · 用户 ${config.users?.length || 0} · merge=[${(config.mergeStreams || []).join(',')}]`);
}
