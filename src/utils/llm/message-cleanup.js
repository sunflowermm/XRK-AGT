/**
 * 消息序列标准化工具
 *
 * 统一处理所有 LLM 提供商的消息序列规范，确保：
 * - 消息序列符合各提供商的对话规范
 * - 移除无效和冗余消息
 * - 自动修复常见的序列问题
 */

/**
 * 标准化消息序列（通用入口）
 * @param {Array} messages - 原始消息数组
 * @param {Object} options - 选项
 * @returns {Array} 标准化后的消息数组
 */
export function cleanupMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  let cleaned = [...messages];

  // 1. 移除无效消息
  cleaned = removeInvalidMessages(cleaned);

  // 2. 标准化消息内容
  cleaned = normalizeMessageContent(cleaned);

  // 3. 合并连续的相同角色消息（可选）
  if (options.mergeConsecutive !== false) {
    cleaned = mergeConsecutiveMessages(cleaned);
  }

  // 4. 确保第一条非 system 消息是 user（可选）
  if (options.ensureUserFirst !== false) {
    cleaned = ensureFirstUserMessage(cleaned);
  }

  // 5. 验证并修复工具调用序列
  cleaned = fixToolCallSequence(cleaned);

  return cleaned;
}

/**
 * 移除无效消息
 */
function removeInvalidMessages(messages) {
  return messages.filter(msg => {
    // 必须有 role
    if (!msg || !msg.role) return false;

    // system 消息始终保留
    if (msg.role === 'system') return true;

    // assistant 消息：有 content 或 tool_calls 即可
    if (msg.role === 'assistant') {
      const hasContent = hasValidContent(msg.content);
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      return hasContent || hasToolCalls;
    }

    // tool 消息：必须有 tool_call_id 和 content
    if (msg.role === 'tool') {
      return msg.tool_call_id && msg.content !== undefined && msg.content !== null;
    }

    // user 消息：必须有 content
    return hasValidContent(msg.content);
  });
}

/**
 * 检查内容是否有效
 */
function hasValidContent(content) {
  if (!content) return false;

  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  if (Array.isArray(content)) {
    return content.length > 0;
  }

  return true;
}

/**
 * 标准化消息内容
 */
function normalizeMessageContent(messages) {
  return messages.map(msg => {
    const normalized = { ...msg };

    // 标准化 content 字段
    if (normalized.content === null || normalized.content === undefined) {
      // assistant with tool_calls 可以没有 content
      if (normalized.role === 'assistant' && normalized.tool_calls) {
        delete normalized.content;
      } else {
        normalized.content = '';
      }
    }

    // 确保 tool 消息有 name 字段
    if (normalized.role === 'tool' && !normalized.name) {
      // 尝试从 tool_call_id 推断 name（如果可能）
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

    // 只合并相同角色且都没有 tool_calls 的消息
    const canMerge =
      current.role === msg.role &&
      current.role !== 'tool' && // tool 消息永不合并
      !current.tool_calls &&
      !msg.tool_calls;

    if (canMerge) {
      // 合并 content
      current.content = mergeContent(current.content, msg.content);
    } else {
      merged.push(current);
      current = { ...msg };
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

/**
 * 合并两个 content
 */
function mergeContent(content1, content2) {
  // 字符串合并
  if (typeof content1 === 'string' && typeof content2 === 'string') {
    return content1 + '\n' + content2;
  }

  // 数组合并
  if (Array.isArray(content1) && Array.isArray(content2)) {
    return [...content1, ...content2];
  }

  // 其他情况，保留第二个
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

  // 如果没有非 system 消息，直接返回
  if (otherMessages.length === 0) {
    return systemMessages;
  }

  // 如果第一条非 system 消息不是 user，添加占位消息
  if (otherMessages[0].role !== 'user') {
    otherMessages.unshift({
      role: 'user',
      content: '继续'
    });
  }

  return [...systemMessages, ...otherMessages];
}

/**
 * 修复工具调用序列
 * 确保符合规范：assistant with tool_calls -> tool -> (继续循环)
 */
function fixToolCallSequence(messages) {
  const fixed = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const next = messages[i + 1];

    fixed.push(msg);

    // 验证 assistant with tool_calls 后面必须跟 tool
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      if (!next || next.role !== 'tool') {
        console.warn(
          `[message-cleanup] Invalid sequence: assistant with tool_calls at index ${i} not followed by tool message`
        );
      }
    }

    // 验证 tool 消息前面必须是 assistant with tool_calls
    if (msg.role === 'tool') {
      const prev = fixed[fixed.length - 2]; // 前一条（不是刚 push 的当前消息）
      if (!prev || prev.role !== 'assistant' || !prev.tool_calls) {
        console.warn(
          `[message-cleanup] Invalid sequence: tool message at index ${i} not preceded by assistant with tool_calls`
        );
      }
    }
  }

  return fixed;
}

/**
 * 验证消息序列（用于调试）
 * @param {Array} messages - 消息数组
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateMessageSequence(messages) {
  const errors = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    // 检查基本字段
    if (!msg.role) {
      errors.push(`Message ${i}: missing role`);
      continue;
    }

    // 检查 assistant with tool_calls
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      if (!next || next.role !== 'tool') {
        errors.push(`Message ${i}: assistant with tool_calls must be followed by tool message`);
      }
    }

    // 检查 tool 消息
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) {
        errors.push(`Message ${i}: tool message missing tool_call_id`);
      }
      if (!msg.name) {
        errors.push(`Message ${i}: tool message missing name`);
      }
      if (!prev || prev.role !== 'assistant' || !prev.tool_calls) {
        errors.push(`Message ${i}: tool message must follow assistant with tool_calls`);
      }
    }

    // 检查 content
    if (msg.role !== 'assistant' || !msg.tool_calls) {
      if (!hasValidContent(msg.content) && msg.role !== 'system') {
        errors.push(`Message ${i}: ${msg.role} message has no valid content`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

