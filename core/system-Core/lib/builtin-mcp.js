/**
 * 内置默认 workflow（不进 aistream.yaml；配置留空时生效）。
 * 开放域：web.web_search（parallel-free 零配置 + 凭据 auto-detect）。
 */

import { normalizeStringArray } from '#utils/string-array-utils.js';

export const BUILTIN_DEFAULT_STREAMS = Object.freeze(['tools', 'web']);
export const BUILTIN_DEFAULT_REMOTE_MCP = Object.freeze([]);

/**
 * 解析 v3 默认 workflow：配置优先，留空则用内置默认。
 * @param {object} [mcpCfg]
 * @returns {string[]|null}
 */
export function resolveDefaultMcpWorkflow(mcpCfg = {}) {
  const streams = normalizeStringArray(mcpCfg.defaultStreams);
  const remote = normalizeStringArray(mcpCfg.defaultRemoteMcp);
  const effectiveStreams = streams.length ? streams : [...BUILTIN_DEFAULT_STREAMS];
  const effectiveRemote = remote.length ? remote : [...BUILTIN_DEFAULT_REMOTE_MCP];
  const merged = normalizeStringArray([
    ...effectiveStreams,
    ...effectiveRemote.map((name) => `remote-mcp.${name}`)
  ]);
  return merged.length > 0 ? merged : null;
}
