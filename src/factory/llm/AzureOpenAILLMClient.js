import { partitionAndExecuteToolCalls } from '#utils/llm/tool-partition-utils.js';
import {
  appendToolBudgetExhaustedNudge,
  toolBudgetFinalizeOverrides
} from '#utils/llm/tool-loop-finalize.js';
import { createLlmHttpError } from '#utils/llm/llm-http-error.js';
import { buildOpenAIChatCompletionsBody, applyOpenAITools } from '#utils/llm/openai-chat-utils.js';
import { transformMessagesWithVision } from '#utils/llm/message-transform.js';
import { buildFetchOptionsWithProxy } from '#utils/llm/proxy-utils.js';
import { ensureMessagesImagesDataUrl } from '#utils/llm/image-utils.js';
import RuntimeUtil from '#utils/runtime-util.js';
import { iterateSSE } from '#utils/llm/sse-utils.js';
import { normalizeError } from '#utils/normalize-error.js';

/**
 * Azure OpenAI / Foundry Chat Completions 客户端
 * @see https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
 * @see https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/chat
 *
 * - 经典部署：`/openai/deployments/{deployment}/chat/completions?api-version=YYYY-MM-DD`
 * - Foundry v1：`path=/openai/v1/chat/completions`（`api-version` 可选；body 带 `model`）
 * - 认证：默认 header `api-key`；Microsoft Entra：`authMode: bearer` → `Authorization: Bearer`
 * - deployment（真实部署名）在 yaml；对外 model=provider 约定不变
 */
export default class AzureOpenAILLMClient {
  _timeout = 360000;

  constructor(config = {}) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config);
    this._timeout = config.timeout ?? 360000;
  }

  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    if (!base) throw new Error('azure_openai: 未配置 baseUrl（Azure endpoint）');

    const deployment = encodeURIComponent(config.deployment ?? config.azureDeployment ?? config.model ?? config.chatModel ?? '');
    if (!deployment && !config.path) throw new Error('azure_openai: 未配置 deployment（Azure 部署名）或 path');

    const path = (config.path || `/openai/deployments/${deployment}/chat/completions`).replace(/^\/?/, '/');
    const apiVersion = (config.apiVersion || '').toString().trim();
    const url = new URL(`${base}${path}`);
    if (apiVersion) {
      url.searchParams.set('api-version', apiVersion);
    }
    return url.toString();
  }

  get timeout() {
    return this._timeout ?? 360000;
  }

  buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };

    if (this.config.apiKey) {
      const key = String(this.config.apiKey).trim();
      const mode = String(this.config.authMode ?? 'api-key').trim().toLowerCase();
      if (mode === 'bearer') {
        headers.Authorization = `Bearer ${key}`;
      } else {
        headers['api-key'] = key;
      }
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  async transformMessages(messages) {
    return await transformMessagesWithVision(messages, this.config, { mode: 'openai' });
  }

  buildBody(messages, overrides = {}) {
    const body = buildOpenAIChatCompletionsBody(messages, this.config, overrides, undefined);
    const pathHint = String(this.config.path || this.endpoint || '');
    const isFoundryV1 = /\/openai\/v1\//i.test(pathHint);

    if (isFoundryV1) {
      if (body.model === undefined || body.model === '') {
        body.model =
          overrides.model ||
          overrides.chatModel ||
          this.config.model ||
          this.config.chatModel ||
          this.config.deployment ||
          this.config.azureDeployment;
      }
    } else {
      // 经典 deployments/{name}/chat/completions：模型由路径决定，勿再传 model
      delete body.model;
    }

    applyOpenAITools(body, this.config, overrides);
    return body;
  }

  async chat(messages, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });
    const enableMcpTools = overrides?.mcpToolMode !== 'passthrough';
    const maxToolRounds = this.config.maxToolRounds || 7;
    const currentMessages = [...transformedMessages];
    const executedToolNames = [];

    for (let round = 0; round < maxToolRounds; round++) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw createLlmHttpError(
          `Azure OpenAI 请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`,
          { status: resp.status, headers: resp.headers }
        );
      }

      const result = await resp.json();
      const message = result?.choices?.[0]?.message;
      if (!message) break;

      if (message.tool_calls?.length > 0 && enableMcpTools) {
        for (const tc of message.tool_calls) {
          const name = tc.function?.name;
          if (name && !executedToolNames.includes(name)) executedToolNames.push(name);
        }
        currentMessages.push(message);
        const toolResults = await partitionAndExecuteToolCalls(message.tool_calls, overrides);
        if (toolResults === null) return executedToolNames.length ? { content: '', executedToolNames } : '';
        currentMessages.push(...toolResults);
        continue;
      }
      if (message.tool_calls?.length > 0 && !enableMcpTools) break;

      const content = message.content || '';
      return executedToolNames.length > 0 ? { content, executedToolNames } : content;
    }

    const lastContent = currentMessages[currentMessages.length - 1]?.content || '';
    try {
      const finalizeMsgs = appendToolBudgetExhaustedNudge(currentMessages);
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(
            this.buildBody(finalizeMsgs, toolBudgetFinalizeOverrides({ ...overrides }))
          ),
          signal: AbortSignal.timeout(this.timeout)
        })
      );
      if (resp.ok) {
        const result = await resp.json();
        const content = result?.choices?.[0]?.message?.content || lastContent;
        return executedToolNames.length > 0 ? { content, executedToolNames } : content;
      }
    } catch (err) {
      RuntimeUtil.makeLog(
        'warn',
        `[AzureOpenAILLMClient] 工具轮次收尾失败: ${normalizeError(err).message}`,
        'LLMFactory'
      );
    }
    return executedToolNames.length > 0 ? { content: lastContent, executedToolNames } : lastContent;
  }

  async chatStream(messages, onDelta, overrides = {}) {
    const transformedMessages = await this.transformMessages(messages);
    await ensureMessagesImagesDataUrl(transformedMessages, { timeoutMs: this.timeout });

    const maxToolRounds = this.config.maxToolRounds || 7;
    let currentMessages = [...transformedMessages];
    let round = 0;

    while (round < maxToolRounds) {
      const resp = await fetch(
        this.endpoint,
        buildFetchOptionsWithProxy(this.config, {
          method: 'POST',
          headers: this.buildHeaders(overrides.headers),
          body: JSON.stringify(this.buildBody(currentMessages, { ...overrides, stream: true })),
          signal: AbortSignal.timeout(this.timeout)
        })
      );

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        throw createLlmHttpError(
          `Azure OpenAI 流式请求失败: ${resp.status} ${resp.statusText}${text ? ` | ${text}` : ''}`,
          { status: resp.status, headers: resp.headers }
        );
      }

      const toolCallsCollector = {
        toolCalls: [],
        content: '',
        finishReason: null
      };

      const enableMcp = overrides?.mcpToolMode !== 'passthrough';
      await this._consumeSSEWithToolCalls(resp, onDelta, toolCallsCollector, overrides);

      if (toolCallsCollector.toolCalls.length > 0 && toolCallsCollector.finishReason === 'tool_calls' && enableMcp) {
        RuntimeUtil.makeLog('info', `[AzureOpenAILLMClient] 检测到工具调用，执行工具: ${toolCallsCollector.toolCalls.length}个`, 'LLMFactory');

        currentMessages.push({
          role: 'assistant',
          content: toolCallsCollector.content || null,
          tool_calls: toolCallsCollector.toolCalls
        });

        const buildPayload = (mid, res) => mid.map((tc, i) => ({
          name: tc.function?.name || `工具${i + 1}`,
          arguments: tc.function?.arguments || {},
          result: res[i]?.content ?? ''
        }));
        const toolResults = await partitionAndExecuteToolCalls(toolCallsCollector.toolCalls, overrides, {
          buildMcpPayload: buildPayload,
          onDelta
        });
        if (toolResults === null) break;
        currentMessages.push(...toolResults);
        round++;
        if (round >= maxToolRounds) {
          RuntimeUtil.makeLog('warn', `[AzureOpenAILLMClient] 达到最大工具调用轮数: ${maxToolRounds}`, 'LLMFactory');
          try {
            const finalizeMsgs = appendToolBudgetExhaustedNudge(currentMessages);
            const finalResp = await fetch(
              this.endpoint,
              buildFetchOptionsWithProxy(this.config, {
                method: 'POST',
                headers: this.buildHeaders(overrides.headers),
                body: JSON.stringify(
                  this.buildBody(finalizeMsgs, toolBudgetFinalizeOverrides({ ...overrides, stream: true }))
                ),
                signal: AbortSignal.timeout(this.timeout)
              })
            );
            if (finalResp.ok && finalResp.body) {
              const collector = { toolCalls: [], content: '', finishReason: null };
              await this._consumeSSEWithToolCalls(finalResp, onDelta, collector, overrides);
            }
          } catch (err) {
            RuntimeUtil.makeLog(
              'warn',
              `[AzureOpenAILLMClient] 流式工具轮次收尾失败: ${normalizeError(err).message}`,
              'LLMFactory'
            );
          }
          break;
        }
        continue;
      }
      if (toolCallsCollector.content || !toolCallsCollector.toolCalls.length || !enableMcp) break;

      round++;
    }
  }

  async _consumeSSEWithToolCalls(resp, onDelta, collector, options = {}) {
    const toolCallsMap = new Map();

    for await (const { data } of iterateSSE(resp)) {
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        const finishReason = json?.choices?.[0]?.finish_reason;

        if (finishReason) {
          collector.finishReason = finishReason;
        }

        if (delta?.content && typeof delta.content === 'string' && delta.content.length > 0) {
          collector.content += delta.content;
          if (typeof onDelta === 'function') onDelta(delta.content);
        }

        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          const mode = options?.mcpToolMode || 'execute';
          if ((mode === 'passthrough' || mode === 'hybrid') && typeof onDelta === 'function' && delta.tool_calls.length > 0) {
            onDelta('', { tool_calls: delta.tool_calls });
          }
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (index === undefined || index === null) continue;

            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              });
            }

            const toolCall = toolCallsMap.get(index);
            if (tc.id) toolCall.id = tc.id;
            if (tc.function?.name) toolCall.function.name = tc.function.name;
            if (tc.function?.arguments) {
              toolCall.function.arguments += tc.function.arguments;
            }
          }
        }
      } catch {
        // ignore malformed SSE chunk
      }
    }

    if (toolCallsMap.size > 0) {
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      collector.toolCalls = sortedIndices.map(index => toolCallsMap.get(index));
    }
  }
}
