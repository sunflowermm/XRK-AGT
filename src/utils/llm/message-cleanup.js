/**
 * 消息序列标准化工具
 */

import BotUtil from '#utils/botutil.js';

/**
 * 标准化消息序列
 */
export function cleanupMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  let cleaned = [...messages];

  cleaned = removeInvalidMessages(cleaned);
  cleaned = normalizeMessageContent(cleaned);

  if (options.mergeConsecutive !== false) {
    cleaned = mergeConsecutiveMessages(cleaned);
  }

  if (options.ensureUserFirst !== false) {
    cleaned = ensureFirstUserMessage(cleaned);
  }

  cleaned = fixToolCallSequence(cleaned);

  BotUtil.makeLog('debug', `[message-cleanup] ${messages.length} -> ${cleaned.length} 条消息`, 'MessageCleanup');

  // 输出最后几条消息的序列，用于调试
  const lastMessages = cleaned.slice(-10).map((m, i) => {
    const idx = cleaned.length - 10 + i;
    return `${idx}:${m.role}${m.tool_calls ? `(${m.tool_calls.length}tc)` : ''}`;
  }).join(' ');
  BotUtil.makeLog('debug', `[message-cleanup] 最后10条: ${lastMessages}`, 'MessageCleanup');

  return cleaned;
}

/**
 * 移除无效消息
 */
function removeInvalidMessages(messages) {
  return messages.filter(msg => {
    if (!msg?.role) return false;
    if (msg.role === 'system') return true;

    if (msg.role === 'assistant') {
      return hasValidContent(msg.content) || (msg.tool_calls?.length > 0);
    }

    if (msg.role === 'tool') {
      return msg.tool_call_id && msg.content !== undefined && msg.content !== null;
    }

    return hasValidContent(msg.content);
  });
}

function hasValidContent(content) {
  if (!content) return false;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) return content.length > 0;
  return true;
}

/**
 * 标准化消息内容
 */
function normalizeMessageContent(messages) {
  return messages.map(msg => {
    const normalized = { ...msg };

    if (normalized.content === null || normalized.content === undefined) {
      if (normalized.role === 'assistant' && normalized.tool_calls) {
        delete normalized.content;
      } else {
        normalized.content = '';
      }
    }

    if (normalized.role === 'tool' && !normalized.name) {
      normalized.name = 'unknown';
    }

    return normalized;
  });
}

/**
 * 合并连续的相同角色消息
 */
function mergeConsecutiveMessages(messages) {
  if (messages.length <= 1) return messages;

  const merged = [];
  let current = null;

  for (const msg of messages) {
    if (!current) {
      current = { ...msg };
      continue;
    }

    const canMerge = current.role === msg.role && current.role !== 'tool' && !current.tool_calls && !msg.tool_calls;

    if (canMerge) {
      current.content = mergeContent(current.content, msg.content);
    } else {
      merged.push(current);
      current = { ...msg };
    }
  }

  if (current) merged.push(current);
  return merged;
}

function mergeContent(content1, content2) {
  if (typeof content1 === 'string' && typeof content2 === 'string') {
    return content1 + '\n' + content2;
  }
  if (Array.isArray(content1) && Array.isArray(content2)) {
    return [...content1, ...content2];
  }
  return content2 || content1;
}

/**
 * 确保第一条非 system 消息是 user
 */
function ensureFirstUserMessage(messages) {
  const systemMessages = [];
  const otherMessages = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      otherMessages.push(msg);
    }
  }

  if (otherMessages.length === 0) return systemMessages;

  if (otherMessages[0].role !== 'user') {
    otherMessages.unshift({ role: 'user', content: '继续' });
  }

  return [...systemMessages, ...otherMessages];
}

/**
 * 修复工具调用序列
 * Gemini 规则：assistant(with tool_calls) 必须紧跟在 user 或 tool 后面
 */
function fixToolCallSequence(messages) {
  const fixed = [];
  let expectingToolResponse = false;
  let toolCallsCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = fixed[fixed.length - 1];

    if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
      if (prev?.role === 'assistant' && !prev.tool_calls) {
        BotUtil.makeLog('debug', `[message-cleanup] 跳过 assistant with tool_calls（前面是普通 assistant）`, 'MessageCleanup');
        continue;
      }

      fixed.push(msg);
      expectingToolResponse = true;
      toolCallsCount = msg.tool_calls.length;
      continue;
    }

    if (msg.role === 'tool') {
      if (!expectingToolResponse) {
        BotUtil.makeLog('debug', `[message-cleanup] 跳过孤立的 tool 消息`, 'MessageCleanup');
        continue;
      }

      fixed.push(msg);
      toolCallsCount--;

      if (toolCallsCount <= 0) {
        expectingToolResponse = false;
      }
      continue;
    }

    if (expectingToolResponse) {
      BotUtil.makeLog('debug', `[message-cleanup] 跳过 ${msg.role} 消息（等待 tool 响应）`, 'MessageCleanup');
      continue;
    }

    fixed.push(msg);
  }

  return fixed;
}

/**
 * 验证消息序列
 */
export function validateMessageSequence(messages) {
  const errors = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    if (!msg.role) {
      errors.push(`Message ${i}: missing role`);
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
      if (!next || next.role !== 'tool') {
        errors.push(`Message ${i}: assistant with tool_calls must be followed by tool`);
      }
    }

    if (msg.role === 'tool') {
      if (!msg.tool_call_id) errors.push(`Message ${i}: tool missing tool_call_id`);
      if (!msg.name) errors.push(`Message ${i}: tool missing name`);
      if (!prev || prev.role !== 'assistant' || !prev.tool_calls) {
        errors.push(`Message ${i}: tool must follow assistant with tool_calls`);
      }
    }

    if (msg.role !== 'assistant' || !msg.tool_calls) {
      if (!hasValidContent(msg.content) && msg.role !== 'system') {
        errors.push(`Message ${i}: ${msg.role} has no valid content`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

