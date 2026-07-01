/**
 * 多语言子服务 runtime 目录（端口默认值；实际地址以 aistream.yaml → subserver.runtimes 为准）
 */

/** @type {Record<string, { label: string, port: number, language: string, aliases?: string[] }>} */
export const SUBSERVER_RUNTIME_CATALOG = {
  pyserver: { label: 'Python', port: 8000, language: 'python', aliases: ['py', 'python'] },
  goserver: { label: 'Go', port: 8001, language: 'go', aliases: ['go'] },
  phpserver: { label: 'PHP', port: 8002, language: 'php', aliases: ['php'] },
  jserver: { label: 'Java', port: 8003, language: 'java', aliases: ['java', 'j', 'spring'] },
  netserver: { label: '.NET', port: 8004, language: 'csharp', aliases: ['net', 'dotnet', 'csharp', 'cs'] }
};

const ALIAS_TO_RUNTIME = Object.fromEntries(
  Object.entries(SUBSERVER_RUNTIME_CATALOG).flatMap(([id, meta]) =>
    (meta.aliases || []).map((alias) => [alias.toLowerCase(), id])
  )
);

/** @returns {string[]} */
export function listSubserverRuntimes() {
  return Object.keys(SUBSERVER_RUNTIME_CATALOG);
}

/**
 * @param {string} [token]  runtime id 或别名（可带 @ 前缀）
 * @returns {string|null}
 */
export function resolveSubserverRuntime(token) {
  if (!token) return null;
  const raw = String(token).replace(/^@/, '').trim().toLowerCase();
  if (!raw) return null;
  if (SUBSERVER_RUNTIME_CATALOG[raw]) return raw;
  return ALIAS_TO_RUNTIME[raw] || null;
}

/**
 * @param {string} line
 * @param {string} [defaultRuntime]
 */
export function parseSubserverCommandLine(line, defaultRuntime = 'pyserver') {
  const parts = String(line || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { runtime: defaultRuntime, commandLine: 'help' };
  }
  const resolved = resolveSubserverRuntime(parts[0]);
  if (resolved) {
    return {
      runtime: resolved,
      commandLine: parts.slice(1).join(' ') || 'help'
    };
  }
  return { runtime: defaultRuntime, commandLine: parts.join(' ') };
}

/** @param {unknown} payload */
export function formatSubserverCommandResult(payload) {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');
  const data = /** @type {Record<string, unknown>} */ (payload);
  if (data.ok === false) {
    const err = data.error || data.detail || '命令失败';
    const extra = data.available || data.commands;
    if (Array.isArray(extra) && extra.length) {
      return `${err}\n可用: ${extra.join(', ')}`;
    }
    return String(err);
  }
  if (Array.isArray(data.groups) && data.count != null) {
    return data.groups
      .map((g) => {
        const item = /** @type {{ group?: string, commands?: string[] }} */ (g);
        return `· ${item.group} [${(item.commands || []).join(', ')}]`;
      })
      .join('\n');
  }
  if (Array.isArray(data.groups)) {
    return `已注册: ${data.groups.join(', ')}`;
  }
  return JSON.stringify(payload, null, 2);
}

export function subserverRuntimeUsageHint() {
  const ids = listSubserverRuntimes().join(' | ');
  const aliases = 'py / go / php / java / net';
  return (
    '用法: #子服 [@runtime] <组名> <命令>\n' +
    '例: #子服 jmcomic update\n' +
    '#子服 @go hash-tools status\n' +
    '#子服 @java json-tools status\n' +
    '#子服 @net uuid-tools status\n' +
    `runtime: ${ids}（别名 ${aliases}）`
  );
}
