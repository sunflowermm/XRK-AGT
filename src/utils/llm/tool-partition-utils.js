import { MCPToolAdapter } from './mcp-tool-adapter.js';
import BotUtil from '../botutil.js';

/**
 * 获取下游工具名称集合
 * @param {Object} overrides - 包含 downstreamToolNames 的配置对象
 * @returns {Set<string>} 下游工具名称集合
 */
function getDownstreamToolNames(overrides) {
  if (Array.isArray(overrides?.downstreamToolNames) && overrides.downstreamToolNames.length > 0) {
    return new Set(overrides.downstreamToolNames.map(s => String(s).trim()).filter(Boolean));
  }
  return new Set();
}

/**
 * 分区并执行工具调用
 *
 * 工具分区策略：
 * - 下游工具（在 downstreamToolNames 中）：透传给客户端执行
 * - 中游工具（MCP 工具）：由 XRK 执行
 *
 * @param {Array} toolCalls - LLM 返回的工具调用列表
 * @param {Object} overrides - 配置对象，包含 streams 和 downstreamToolNames
 * @param {Function} [buildMcpPayload] - 构建 MCP 工具结果的函数
 * @param {Function} [onDelta] - 流式输出回调函数
 * @returns {Promise<Array|null>} 工具执行结果，如果有下游工具则返回 null（表示透传）
 */
export async function partitionAndExecuteToolCalls(toolCalls, overrides, { buildMcpPayload, onDelta } = {}) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return [];

  const downstreamNames = getDownstreamToolNames(overrides);
  const streams = Array.isArray(overrides.streams) ? overrides.streams : null;
  const getToolName = (tc) => tc.function?.name || '';

  // 分区：根据工具名称判断是中游还是下游
  const midstreamCalls = toolCalls.filter((tc) => !downstreamNames.has(getToolName(tc)));
  const downstreamCalls = toolCalls.filter((tc) => downstreamNames.has(getToolName(tc)));

  // 日志：显示工具分区结果
  if (toolCalls.length > 0) {
    BotUtil.makeLog(
      'info',
      `[工具分区] 总计 ${toolCalls.length} 个调用 | 中游 ${midstreamCalls.length} 个: [${midstreamCalls.map(getToolName).join(', ') || '无'}] | 下游 ${downstreamCalls.length} 个: [${downstreamCalls.map(getToolName).join(', ') || '无'}]`,
      'tool-partition'
    );
  }

  // 情况1：仅有下游工具，全部透传
  if (downstreamCalls.length > 0 && midstreamCalls.length === 0) {
    BotUtil.makeLog('info', '[工具分区] 仅有下游工具，透传给客户端执行', 'tool-partition');
    return null;
  }

  // 情况2：有中游工具，执行中游工具
  const midstreamResults = midstreamCalls.length > 0
    ? await MCPToolAdapter.handleToolCalls(midstreamCalls, { streams })
    : [];

  // 发送中游工具执行结果（用于流式输出）
  if (typeof onDelta === 'function' && midstreamCalls.length > 0 && typeof buildMcpPayload === 'function') {
    onDelta('', { mcp_tools: buildMcpPayload(midstreamCalls, midstreamResults) });
  }

  // 情况3：同时有中游和下游工具，中游已执行，下游透传
  if (downstreamCalls.length > 0) {
    BotUtil.makeLog('info', '[工具分区] 中游工具已执行，下游工具透传给客户端', 'tool-partition');
    return null;
  }

  // 情况4：仅有中游工具，返回执行结果
  const resultMap = new Map(midstreamCalls.map((tc, i) => [getToolName(tc), midstreamResults[i]]));
  return toolCalls.map((tc) => resultMap.get(getToolName(tc))).filter(Boolean);
}
