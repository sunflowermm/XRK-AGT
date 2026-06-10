/**
 * 内置默认 workflow（不进 aistream.yaml；配置留空时生效）。
 * 开放域：web.web_search（parallel-free 零配置 + 凭据 auto-detect）。
 */

export const BUILTIN_DEFAULT_STREAMS = Object.freeze(['tools', 'web']);
export const BUILTIN_DEFAULT_REMOTE_MCP = Object.freeze([]);

function normalizeStringArray(values = []) {
  const src = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const raw of src) {
    const s = String(raw ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

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
