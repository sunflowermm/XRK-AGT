/**
 * AI 助手运行时 — 功能对齐 XRK-Yunzai，底层走 AGT stream.process / StreamLoader.mergeStreams
 */
import ChatStream from '../stream/chat.js';

export const CHAT_MERGED_NAME = 'chat-merged';
export const AI_FULL_PROMPT_DUMP_REGEX = /#?XRK完整AI上下文/;

const cooldownState = new Map();

export async function loadAiAssistantConfig() {
  const { default: AIConfig } = await import('../commonconfig/ai_config.js');
  return new AIConfig().read();
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

export function resolveChatStream(plugin, config) {
  const mergeList = config?.mergeStreams;
  if (Array.isArray(mergeList) && mergeList.length > 0) {
    const merged = plugin.getStream(CHAT_MERGED_NAME);
    if (merged) return merged;
    const loader = Bot.StreamLoader;
    if (loader?.mergeStreams) {
      return loader.mergeStreams({
        name: CHAT_MERGED_NAME,
        main: 'chat',
        secondary: mergeList,
        prefixSecondary: true,
      }) ?? plugin.getStream('chat');
    }
  }
  return plugin.getStream('chat');
}

export function scheduleChatStreamMerge(config) {
  const secondaries = config?.mergeStreams;
  if (!Array.isArray(secondaries) || !secondaries.length) return;
  const doMerge = () => {
    try {
      const loader = Bot.StreamLoader;
      if (!loader?.mergeStreams) {
        setTimeout(doMerge, 1000);
        return;
      }
      if (loader.getStream?.(CHAT_MERGED_NAME)) return;
      loader.mergeStreams({
        name: CHAT_MERGED_NAME,
        main: 'chat',
        secondary: secondaries,
        prefixSecondary: true,
      });
      logger.mark(`[XRK-AI] 合并工作流 chat + [${secondaries.join(', ')}]`);
    } catch (err) {
      logger.error(`[XRK-AI] 合并工作流失败: ${err.message}`);
    }
  };
  setTimeout(doMerge, 0);
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

/** 走 AGT AIStream.process：mergeStreams + enableMemory/Database/Tools */
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

  const ms = config?.mergeStreams ?? [];
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
      enableMemory: ms.includes('memory'),
      enableDatabase: ms.includes('database'),
      enableTools: ms.includes('tools'),
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
