import RuntimeUtil from '#utils/runtime-util.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import { parseStatusFromMessage } from '#utils/llm/llm-http-error.js';

function getLlmRetryConfig() {
  const llm = getAiWorkflowConfigOptional().llm || {};
  const retryConfig = llm.retry || {};
  return {
    enabled: retryConfig.enabled !== false,
    maxAttempts: retryConfig.maxAttempts || 3,
    delay: retryConfig.delay || 2000,
    maxDelay: retryConfig.maxDelay || 10000,
    backoffMultiplier: retryConfig.backoffMultiplier || 2,
    // rate_limit / empty：对齐 cline empty-turn、opencode 429 退避
    retryOn: retryConfig.retryOn || ['timeout', 'network', '5xx', 'rate_limit', 'empty']
  };
}

function calculateRetryDelay(attempt, retryConfig, errorInfo = {}) {
  if (errorInfo.retryAfterMs != null && Number.isFinite(errorInfo.retryAfterMs)) {
    return Math.min(retryConfig.maxDelay || 10000, Math.max(0, errorInfo.retryAfterMs));
  }
  const baseDelay = retryConfig.delay || 2000;
  const multiplier = retryConfig.backoffMultiplier || 2;
  const maxDelay = retryConfig.maxDelay || 10000;
  const delay = Math.min(baseDelay * multiplier ** (attempt - 1), maxDelay);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

function classifyLlmError(error) {
  if (!error) {
    return {
      isTimeout: false,
      isNetwork: false,
      is5xx: false,
      is4xx: false,
      isRateLimit: false,
      isAuth: false,
      isEmptyTurn: false,
      isContextOverflow: false,
      retryAfterMs: null,
      originalError: error
    };
  }

  const message = error?.message?.toLowerCase() || '';
  const code = error?.code?.toLowerCase() || '';
  const status = Number(error?.status || error?.statusCode) || parseStatusFromMessage(error?.message) || 0;
  const name = error?.name?.toLowerCase() || '';
  const retryAfterMs = error?.retryAfterMs != null ? Number(error.retryAfterMs) : null;

  const isContextOverflow =
    message.includes('context length') ||
    message.includes('context window') ||
    message.includes('too many tokens') ||
    message.includes('maximum context') ||
    message.includes('prompt is too long') ||
    code === 'context_overflow';

  return {
    isTimeout: name === 'aborterror' ||
      name === 'timeouterror' ||
      message.includes('timeout') ||
      message.includes('超时') ||
      message.includes('timed out') ||
      code === 'timeout' ||
      code === 'etimedout',
    isNetwork: message.includes('network') ||
      message.includes('网络') ||
      message.includes('连接') ||
      message.includes('connection') ||
      code === 'econnrefused' ||
      code === 'enotfound' ||
      code === 'econnreset',
    is5xx: /^5\d{2}$/.test(String(status)) ||
      code === '5xx' ||
      (status >= 500 && status < 600) ||
      status === 529,
    is4xx: /^4\d{2}$/.test(String(status)) ||
      code === '4xx' ||
      (status >= 400 && status < 500),
    isRateLimit: status === 429 ||
      message.includes('rate limit') ||
      message.includes('限流') ||
      message.includes('too many requests'),
    isAuth: status === 401 ||
      status === 403 ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('认证') ||
      message.includes('权限'),
    isEmptyTurn: code === 'empty_turn' || message.includes('empty llm response') || message.includes('空响应'),
    isContextOverflow,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null,
    originalError: error
  };
}

function shouldRetryLlm(errorInfo, retryConfig, attempt) {
  if (!retryConfig.enabled || attempt >= retryConfig.maxAttempts) {
    return false;
  }
  if (errorInfo.isAuth || errorInfo.isContextOverflow) {
    return false;
  }
  const { isTimeout, isNetwork, is5xx, isRateLimit, isEmptyTurn } = errorInfo;
  const { retryOn } = retryConfig;
  return (
    (isTimeout && retryOn.includes('timeout')) ||
    (isNetwork && retryOn.includes('network')) ||
    (is5xx && retryOn.includes('5xx')) ||
    (isRateLimit && retryOn.includes('rate_limit')) ||
    (isEmptyTurn && (retryOn.includes('empty') || retryOn.includes('empty_turn'))) ||
    retryOn.includes('all')
  );
}

/**
 * @param {object} options
 * @param {string} options.label - 日志前缀（如 stream 名）
 * @param {string} options.kind - 操作类型（如「AI调用」「AI流式调用」）
 * @param {Function} options.run - 单次执行 `(attempt) => Promise`
 */
export async function runWithLlmRetry({ label, kind, run }) {
  const retryConfig = getLlmRetryConfig();
  let lastError = null;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      const errorInfo = classifyLlmError(error);
      if (!shouldRetryLlm(errorInfo, retryConfig, attempt)) {
        RuntimeUtil.makeLog('error', `[${label}] ${kind}失败: ${error.message}`, 'AiWorkflow');
        throw error;
      }
      const delay = calculateRetryDelay(attempt, retryConfig, errorInfo);
      RuntimeUtil.makeLog('warn',
        `[${label}] ${kind}失败，${attempt}/${retryConfig.maxAttempts}次重试中(${Math.round(delay)}ms): ${error.message}`,
        'AiWorkflow'
      );
      await RuntimeUtil.sleep(delay);
    }
  }

  const msg = `${kind}失败，已重试${retryConfig.maxAttempts}次: ${lastError?.message || '未知错误'}`;
  RuntimeUtil.makeLog('error', `[${label}] ${msg}`, 'AiWorkflow');
  if (lastError) {
    lastError.message = msg;
    throw lastError;
  }
  throw new Error(msg);
}

export { classifyLlmError, getLlmRetryConfig };
