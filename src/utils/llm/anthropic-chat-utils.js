import { MCPToolAdapter } from './mcp-tool-adapter.js';
import BotUtil from '../botutil.js';

function parseToolArguments(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { raw: String(raw) };
  }
}

/** OpenAI 风格 messages → Anthropic Messages（含 tool / tool_calls 历史） */
export function normalizeAnthropicMessages(messages = []) {
  const out = [];

  for (const m of messages ?? []) {
    const role = (m?.role ?? '').toLowerCase();

    if (role === 'tool') {
      const last = out[out.length - 1];
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      };
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const blocks = [];
      const text = typeof m.content === 'string' ? m.content.trim() : '';
      if (text) blocks.push({ type: 'text', text });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || 'tool',
          input: parseToolArguments(tc.function?.arguments)
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    out.push(m);
  }

  return out;
}

function mapToolChoice(value) {
  const v = (value ?? 'auto').toString().trim().toLowerCase();
  if (v === 'none') return { type: 'none' };
  if (v === 'required' || v === 'any') return { type: 'any' };
  if (v === 'auto') return { type: 'auto' };
  return { type: 'tool', name: v };
}

export function applyAnthropicTools(body, config = {}, overrides = {}) {
  const customTools = Array.isArray(overrides.tools) ? overrides.tools.filter(Boolean) : [];
  if (customTools.length) {
    body.tools = customTools;
    const choice = overrides.tool_choice ?? overrides.toolChoice ?? config.toolChoice;
    if (choice != null) body.tool_choice = mapToolChoice(choice);
    return body;
  }

  const hasMcpTools = MCPToolAdapter.hasTools();
  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
  const enableMcp = Boolean(streams?.length) && config.enableTools !== false && hasMcpTools;
  if (!enableMcp) return body;

  const workflow = overrides.workflow || config.workflow || config.streamName || null;
  const mcpTools = MCPToolAdapter.convertMCPToolsToAnthropic({ workflow, streams });

  if (mcpTools.length) {
    body.tools = mcpTools;
    const choice = overrides.tool_choice ?? overrides.toolChoice ?? config.toolChoice;
    body.tool_choice = mapToolChoice(choice);
    BotUtil.makeLog(
      'debug',
      `[anthropic-chat-utils] 注入 MCP tools=${mcpTools.length}, streams=${JSON.stringify(streams)}`,
      'LLMFactory'
    );
  }

  return body;
}

export function ensureAnthropicMaxTokens(body, config = {}, overrides = {}) {
  if (body.max_tokens != null) return body.max_tokens;
  const maxTokens = overrides.maxTokens ?? overrides.max_tokens
    ?? config.maxTokens ?? config.max_tokens ?? 4096;
  body.max_tokens = maxTokens;
  return maxTokens;
}
