import AnthropicLLMClient from './AnthropicLLMClient.js';
import { iterateSSE } from '#utils/llm/sse-utils.js';
import { partitionAndExecuteToolCalls } from '#utils/llm/tool-partition-utils.js';
import {
  appendToolBudgetExhaustedNudge,
  toolBudgetFinalizeOverrides,
} from '#utils/llm/tool-loop-finalize.js';
import {
  applyAnthropicTools,
  ensureAnthropicMaxTokens,
  normalizeAnthropicMessages,
  normalizeAnthropicToolHistory,
} from '#utils/llm/anthropic-chat-utils.js';
import { createToolNameMapper } from '#utils/llm/tool-name-utils.js';
import RuntimeUtil from '#utils/runtime-util.js';
import { logPromptCacheUsage } from '#utils/llm/prompt-cache-policy.js';
import { normalizeError } from '#utils/normalize-error.js';

/**
 * Anthropic Messages 兼容网关（anthropic_compat_llm.providers）
 *
 * 官方 Claude API（platform.claude.com）：
 * - `POST https://api.anthropic.com/v1/messages`
 * - 静态密钥用 `x-api-key`；Workload Identity 短时令牌才用 `Authorization: Bearer`
 * - 必带 `anthropic-version`（默认 `2023-06-01`，由基类写入）
 *
 * 本类面向第三方 Messages 兼容反代：默认 `authMode=bearer`（网关常见）；
 * 若反代要求官方头，配置 `authMode: x-api-key`。工具环 / SSE 事件形状按 Messages API。
 */
export default class AnthropicCompatibleLLMClient extends AnthropicLLMClient {
  _toolNames = createToolNameMapper();

  constructor(config = {}) {
    super({
      authMode: 'bearer',
      ...config,
    });
  }

  normalizeEndpoint(config) {
    let base = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    let path = config.path || '/messages';
    if (!path.startsWith('/')) path = `/${path}`;

    if (path.startsWith('/v1/')) {
      return `${base.replace(/\/v1$/i, '')}${path}`;
    }
    if (path === '/messages' && !/\/v1$/i.test(base)) {
      base = `${base}/v1`;
    }
    return `${base}${path}`;
  }

  buildBody(messages, overrides = {}) {
    const normalized = normalizeAnthropicToolHistory(
      normalizeAnthropicMessages(messages),
      this._toolNames
    );
    const body = super.buildBody(normalized, overrides);
    applyAnthropicTools(body, this.config, overrides, this._toolNames);
    ensureAnthropicMaxTokens(body, this.config, overrides);
    return body;
  }

  async _finalizeImageBlocks(body) {
    return this._finalizeBodyImageBlocks(body);
  }

  async _postMessages(body, overrides = {}) {
    return this._postNativeBody(body, overrides);
  }

  _toolUsesToOpenAiCalls(toolUses = []) {
    return toolUses.map((tu, i) => ({
      id: tu.id || `toolu_${i}`,
      type: 'function',
      function: {
        name: this._toolNames.denormalize(tu.name || 'tool'),
        arguments: JSON.stringify(tu.input ?? {})
      }
    }));
  }

  _parseMessageToolUses(message = {}) {
    const toolUses = [];
    let text = '';
    for (const block of message.content ?? []) {
      if (block?.type === 'text') text += block.text ?? '';
      if (block?.type === 'tool_use') {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input ?? {}
        });
      }
    }
    return { text, toolUses };
  }

  async _consumeAnthropicStream(resp, onDelta) {
    const result = { text: '', toolUses: [], stopReason: null };
    const toolDrafts = new Map();

    for await (const { data } of iterateSSE(resp, { stopOnDone: false })) {
      if (!data) continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      const type = json?.type;
      if (type === 'content_block_delta') {
        const delta = json.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          result.text += delta.text;
          if (typeof onDelta === 'function') onDelta(delta.text);
        }
        if (delta.type === 'input_json_delta' && delta.partial_json != null) {
          const idx = json.index ?? 0;
          const draft = toolDrafts.get(idx) || { id: '', name: '', inputJson: '' };
          draft.inputJson += delta.partial_json;
          toolDrafts.set(idx, draft);
        }
      } else if (type === 'content_block_start') {
        const block = json.content_block || {};
        if (block.type === 'tool_use') {
          toolDrafts.set(json.index ?? toolDrafts.size, {
            id: block.id,
            name: block.name,
            inputJson: ''
          });
        }
      } else if (type === 'message_delta') {
        result.stopReason = json.delta?.stop_reason ?? result.stopReason;
      }
    }

    for (const draft of toolDrafts.values()) {
      let input = {};
      if (draft.inputJson) {
        try {
          input = JSON.parse(draft.inputJson);
        } catch {
          input = { raw: draft.inputJson };
        }
      }
      result.toolUses.push({ id: draft.id, name: draft.name, input });
    }

    return result;
  }

  async _runToolLoop(initialMessages, overrides, { stream = false, onDelta } = {}) {
    const maxRounds = overrides.maxToolRounds ?? this.config.maxToolRounds ?? 7;
    const useCustomExecutor = typeof overrides.toolExecutor === 'function';
    const enableMcp = !useCustomExecutor
      && overrides.mcpToolMode !== 'passthrough'
      && Array.isArray(overrides.workflows)
      && overrides.workflows.length > 0;
    let currentMessages = normalizeAnthropicToolHistory(
      normalizeAnthropicMessages(await this.transformMessages(initialMessages)),
      this._toolNames
    );
    let lastText = '';

    for (let round = 0; round < maxRounds; round++) {
      if (typeof overrides.onBeforeRound === 'function') {
        await overrides.onBeforeRound(currentMessages, round);
      }

      const body = this.buildBody(currentMessages, overrides);
      body.stream = stream;

      const resp = await this._postMessages(body, overrides);

      let roundText = '';
      let toolUses = [];

      if (stream) {
        const streamed = await this._consumeAnthropicStream(resp, onDelta);
        roundText = streamed.text;
        toolUses = streamed.toolUses;
      } else {
        const json = await resp.json();
        logPromptCacheUsage(json?.usage, 'AnthropicCompatible');
        const parsed = this._parseMessageToolUses(json);
        roundText = parsed.text;
        toolUses = parsed.toolUses;
        if (roundText && typeof onDelta === 'function') onDelta(roundText);
      }

      if (roundText) lastText = roundText;

      if (!toolUses.length) {
        return lastText;
      }

      const assistantBlocks = [];
      if (roundText?.trim()) assistantBlocks.push({ type: 'text', text: roundText });
      for (const tu of toolUses) {
        assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input ?? {} });
      }
      currentMessages.push({ role: 'assistant', content: assistantBlocks });

      let toolResultBlocks = null;

      if (useCustomExecutor) {
        const results = await overrides.toolExecutor(toolUses);
        toolResultBlocks = (Array.isArray(results) ? results : []).map((r) => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id ?? r.toolUseId ?? r.id,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '')
        }));
      } else if (enableMcp) {
        RuntimeUtil.makeLog(
          'info',
          `[AnthropicCompatibleLLMClient] 执行 MCP 工具 ${toolUses.length} 个: [${toolUses.map((t) => t.name).join(', ')}]`,
          'LLMFactory'
        );

        const openAiCalls = this._toolUsesToOpenAiCalls(toolUses);
        const toolResults = await partitionAndExecuteToolCalls(openAiCalls, overrides, {
          buildMcpPayload: (mid, res) => mid.map((tc, idx) => ({
            name: tc.function?.name || `工具${idx + 1}`,
            arguments: tc.function?.arguments || {},
            result: res[idx]?.content ?? ''
          })),
          onDelta
        });
        if (toolResults === null) return lastText;

        if (typeof overrides.onAfterToolRound === 'function') {
          const early = await overrides.onAfterToolRound({
            toolNames: toolUses.map((t) => t.name),
            toolResults,
            round
          });
          if (early?.stop) {
            return early.content != null ? early.content : lastText;
          }
        }

        toolResultBlocks = toolResults.map((tr) => ({
          type: 'tool_result',
          tool_use_id: tr.tool_call_id,
          content: tr.content
        }));
      } else {
        return lastText;
      }

      currentMessages.push({ role: 'user', content: toolResultBlocks });
    }

    RuntimeUtil.makeLog('warn', `[AnthropicCompatibleLLMClient] 达到最大工具轮数: ${maxRounds}`, 'LLMFactory');
    if (typeof overrides.onTruncated === 'function') overrides.onTruncated();
    try {
      const finalizeMsgs = appendToolBudgetExhaustedNudge(currentMessages);
      const body = this.buildBody(finalizeMsgs, toolBudgetFinalizeOverrides({ ...overrides }));
      body.stream = false;
      body.tool_choice = { type: 'none' };
      const resp = await this._postMessages(body, overrides);
      const json = await resp.json();
      const parsed = this._parseMessageToolUses(json);
      if (parsed.text) {
        if (stream && typeof onDelta === 'function') onDelta(parsed.text);
        return parsed.text;
      }
    } catch (err) {
      RuntimeUtil.makeLog(
        'warn',
        `[AnthropicCompatibleLLMClient] 工具轮次收尾失败: ${normalizeError(err).message}`,
        'LLMFactory'
      );
    }
    return lastText;
  }

  async chat(messages, overrides = {}) {
    return this._runToolLoop(messages, overrides, { stream: false });
  }

  async chatStream(messages, onDelta, overrides = {}) {
    await this._runToolLoop(messages, overrides, { stream: true, onDelta });
  }
}
