import { MCPToolAdapter } from './mcp-tool-adapter.js';

/**
 * 中游(MCP)/下游(请求)工具分区与执行
 * - 下游工具（body.tools）：透传客户端执行
 * - 中游工具（XRK MCP）：XRK 执行
 */
export function getRequestToolNames(overrides) {
  const tools = overrides?.tools;
  if (!Array.isArray(tools) || !tools.length) return new Set();
  const getName = (t) => t?.function?.name || t?.name || t?.id;
  return new Set(tools.map(getName).filter(Boolean));
}

/**
 * 分区并执行中游工具
 * @param {Array} toolCalls - 原始 tool_calls
 * @param {Object} overrides - 含 streams、tools
 * @param {Function} [buildMcpPayload] - (toolCalls, toolResults) => mcp_tools
 * @param {Function} [onDelta] - 回调，用于下发 mcp_tools
 * @returns {Array|null} 工具结果（与原顺序一致），含下游时返回 null
 */
export async function partitionAndExecuteToolCalls(toolCalls, overrides, { buildMcpPayload, onDelta } = {}) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return [];

  const mode = (overrides?.mcpToolMode || '').toString().toLowerCase();
  // execute 模式：即使请求体带了 tools，也由中游执行（tools 仅作为“允许工具白名单/向上游声明”）
  const requestNames = mode === 'execute' ? new Set() : getRequestToolNames(overrides);
  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
  const getName = (tc) => tc.function?.name || '';

  const midstream = toolCalls.filter((tc) => !requestNames.has(getName(tc)));
  const downstream = toolCalls.filter((tc) => requestNames.has(getName(tc)));

  if (downstream.length > 0 && midstream.length === 0) return null;
  const allowedTools = Array.isArray(overrides?.allowedTools) ? overrides.allowedTools : null;
  const midstreamResults = midstream.length > 0
    ? await MCPToolAdapter.handleToolCalls(midstream, { streams, allowedTools })
    : [];

  if (typeof onDelta === 'function' && midstream.length > 0 && typeof buildMcpPayload === 'function') {
    onDelta('', { mcp_tools: buildMcpPayload(midstream, midstreamResults) });
  }

  if (downstream.length > 0) return null;
  const resultMap = new Map(midstream.map((tc, i) => [getName(tc), midstreamResults[i]]));
  return toolCalls.map((tc) => resultMap.get(getName(tc))).filter(Boolean);
}
