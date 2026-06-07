/** 控制台 AI 工作区路径策略（HTTP 浏览 / 下载 / AGENTS 编辑） */

export const AGENTS_MD = 'AGENTS.md';

const SKIP_DIRS = new Set(['node_modules', '.git', '.cursor', 'dist', 'build', '.codegraph', '__pycache__']);
const BLOCKED_BASENAMES = new Set(['.env', 'audit.jsonl']);
const BLOCKED_SUFFIX = ['.pem', '.key', '.p12', '.pfx'];
const BLOCKED_INCLUDES = ['id_rsa', 'id_dsa', 'credentials.json', 'secrets.json'];

export function normRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isSensitiveRelPath(relPath) {
  const p = normRel(relPath);
  if (!p) return false;
  const base = p.split('/').pop() || '';
  if (BLOCKED_BASENAMES.has(base)) return true;
  if (base.startsWith('.env.')) return true;
  const lower = base.toLowerCase();
  if (BLOCKED_SUFFIX.some((s) => lower.endsWith(s))) return true;
  if (BLOCKED_INCLUDES.some((s) => lower.includes(s))) return true;
  return false;
}

export function assertBrowseRel(relPath) {
  const p = normRel(relPath);
  if (p.includes('..')) throw new Error('非法路径');
  if (isSensitiveRelPath(p)) throw new Error('无权访问该路径');
  return p;
}

export function assertDownloadRel(relPath) {
  const p = assertBrowseRel(relPath);
  if (!p) throw new Error('路径不能为空');
  return p;
}

export function assertAgentsRel(relPath) {
  const p = normRel(relPath);
  if (p && p !== AGENTS_MD) throw new Error('仅可编辑工作区根目录 AGENTS.md');
  return AGENTS_MD;
}

export function shouldSkipDirName(name) {
  if (!name || name.startsWith('.')) return true;
  return SKIP_DIRS.has(name);
}

export { SKIP_DIRS };
