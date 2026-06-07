import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import paths from '#utils/paths.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import { isPathInside, realpathSyncOrResolve } from '#utils/path-guards.js';
import { readTextFileUnderWorkspaceRoot } from '#utils/safe-workspace-read.js';
import { BaseTools } from '#utils/base-tools.js';

const AGENTS_CANDIDATES = ['AGENTS.md', 'agents/AGENTS.md', 'agents/workspace/AGENTS.md'];

export const DEFAULT_WORKSPACE_ID = 'default';

const BUILTIN_PROJECT = {
  id: 'project',
  label: '项目根目录',
  description: 'Bot 项目根，含代码与 data',
  kind: 'project'
};

function resolvePathInput(raw, projectRoot) {
  if (raw == null || String(raw).trim() === '') return projectRoot;
  let w = String(raw).trim();
  if (w.startsWith('~')) {
    w = path.join(os.homedir(), w.slice(1).replace(/^[\\/]/, '') || '');
    return path.normalize(w);
  }
  if (path.isAbsolute(w)) return path.normalize(w);
  return path.resolve(projectRoot, w);
}

function getProjectRoot() {
  return paths.root || process.cwd();
}

export function getAgentWorkspacesRoot() {
  return paths.dataAiWorkspace || path.join(paths.data, 'ai-workspace');
}

export function sanitizeWorkspaceId(raw) {
  const id = String(raw || DEFAULT_WORKSPACE_ID).trim() || DEFAULT_WORKSPACE_ID;
  if (id === 'project') return 'project';
  const safe = id.replace(/[^\w.\u4e00-\u9fa5-]/g, '_').slice(0, 64);
  return safe || DEFAULT_WORKSPACE_ID;
}

export function getAgentWorkspaceAbs(id = DEFAULT_WORKSPACE_ID) {
  return path.join(getAgentWorkspacesRoot(), sanitizeWorkspaceId(id));
}

export function ensureAgentWorkspaceSync(id = DEFAULT_WORKSPACE_ID) {
  const safeId = sanitizeWorkspaceId(id);
  const abs = path.join(getAgentWorkspacesRoot(), safeId);
  fs.mkdirSync(abs, { recursive: true });
  const agentsPath = path.join(abs, AGENTS_CANDIDATES[0]);
  if (!fs.existsSync(agentsPath)) {
    const label = safeId === DEFAULT_WORKSPACE_ID ? '默认工作区' : safeId;
    fs.writeFileSync(
      agentsPath,
      `# ${label}\n\n在此编写 Agent 规则（AGENTS.md）。\n`,
      'utf8'
    );
  }
  return abs;
}

export function listAgentWorkspaceIds() {
  ensureAgentWorkspaceSync(DEFAULT_WORKSPACE_ID);
  const root = getAgentWorkspacesRoot();
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const ids = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => {
        if (a === DEFAULT_WORKSPACE_ID) return -1;
        if (b === DEFAULT_WORKSPACE_ID) return 1;
        return a.localeCompare(b, 'zh-CN');
      });
    return ids.length ? ids : [DEFAULT_WORKSPACE_ID];
  } catch {
    return [DEFAULT_WORKSPACE_ID];
  }
}

export function createAgentWorkspace(id) {
  const safeId = sanitizeWorkspaceId(id);
  if (safeId === 'project') throw new Error('不能使用保留名称 project');
  const abs = ensureAgentWorkspaceSync(safeId);
  return { id: safeId, path: abs, label: safeId === DEFAULT_WORKSPACE_ID ? '默认工作区' : safeId };
}

export function resolveWorkspacePreset(presetId = DEFAULT_WORKSPACE_ID) {
  const id = normalizePresetId(presetId);
  if (id === 'project') return BUILTIN_PROJECT;
  return {
    id,
    label: id === DEFAULT_WORKSPACE_ID ? '默认工作区' : id,
    description: `data/ai-workspace/${id}`,
    kind: 'agent'
  };
}

/** 统一 preset id（兼容旧 desktop → default） */
export function normalizePresetId(presetId) {
  let id = String(presetId || DEFAULT_WORKSPACE_ID).trim() || DEFAULT_WORKSPACE_ID;
  if (id === 'desktop') id = DEFAULT_WORKSPACE_ID;
  return id;
}

export function getConfiguredDefaultWorkspaceId() {
  const cfg = getAistreamConfigOptional();
  const raw = cfg?.workspace?.defaultId;
  if (raw != null && String(raw).trim() !== '') {
    return normalizePresetId(raw);
  }
  return DEFAULT_WORKSPACE_ID;
}

/**
 * 解析 aistream.tools.file.workspace 为绝对路径。
 * 空 → data/ai-workspace/{defaultId}；agent:xxx → 对应 preset；project → 项目根
 */
export function resolveConfiguredWorkspace(raw) {
  if (raw == null || String(raw).trim() === '') {
    return ensureAgentWorkspaceSync(getConfiguredDefaultWorkspaceId());
  }
  let w = String(raw).trim();
  if (w.startsWith('agent:')) {
    const id = normalizePresetId(w.slice(6));
    if (id === 'project') return getProjectRoot();
    return ensureAgentWorkspaceSync(id);
  }
  if (w === 'project') return getProjectRoot();
  return resolvePathInput(w, getProjectRoot());
}

export function listWorkspacePresets() {
  const agentIds = listAgentWorkspaceIds();
  const agentPresets = agentIds.map((id) => ({
    id,
    label: id === DEFAULT_WORKSPACE_ID ? '默认工作区' : id,
    description: `data/ai-workspace/${id}`,
    kind: 'agent'
  }));
  return [...agentPresets, { ...BUILTIN_PROJECT }];
}

export function resolvePresetOrThrow(presetId) {
  const id = normalizePresetId(presetId);
  if (id === 'project') return { ...BUILTIN_PROJECT };
  const abs = getAgentWorkspaceAbs(id);
  if (!fs.existsSync(abs)) {
    throw new Error(`无效工作区: ${id}`);
  }
  return resolveWorkspacePreset(id);
}

function presetFileContext(presetId) {
  resolvePresetOrThrow(presetId);
  return parseRequestWorkspace({ workspace: { id: presetId } });
}

export async function listPresetFiles(presetId, { subdir = '', limit = 120 } = {}) {
  const ctx = presetFileContext(presetId);
  try {
    const result = listWorkspaceFiles(ctx.fileRootAbs, subdir);
    const cap = Math.min(200, Math.max(1, Number(limit) || 120));
    if (result.files.length > cap) result.files = result.files.slice(0, cap);
    return result;
  } catch (err) {
    return {
      root: ctx.fileRootAbs,
      dir: String(subdir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      files: [],
      error: err?.message || '无法读取目录'
    };
  }
}

export async function readPresetAgents(presetId) {
  const ctx = presetFileContext(presetId);
  return readWorkspaceAgents(ctx.agentRootAbs);
}

export async function writePresetAgents(presetId, content) {
  const ctx = presetFileContext(presetId);
  return writeWorkspaceAgents(ctx.agentRootAbs, content);
}

export async function resolvePresetDownload(presetId, filePath) {
  const ctx = presetFileContext(presetId);
  const { abs, name } = openWorkspaceFileDownload(ctx.fileRootAbs, filePath);
  return { abs, basename: name };
}

export function parseRequestWorkspace(body = {}) {
  const ws = body?.workspace && typeof body.workspace === 'object' ? body.workspace : {};
  const presetId = normalizePresetId(ws.id || ws.preset || getConfiguredDefaultWorkspaceId());
  const projectRoot = getProjectRoot();

  if (presetId === 'project') {
    const agentRootAbs = resolvePathInput(ws.agentRoot || ws.root || '', projectRoot);
    let fileRootAbs = agentRootAbs;
    if (ws.fileRoot) fileRootAbs = resolvePathInput(ws.fileRoot, projectRoot);
    return {
      presetId,
      preset: BUILTIN_PROJECT,
      projectRoot,
      agentRootAbs,
      fileRootAbs
    };
  }

  const fileRootAbs = ensureAgentWorkspaceSync(presetId);
  return {
    presetId,
    preset: resolveWorkspacePreset(presetId),
    projectRoot,
    agentRootAbs: fileRootAbs,
    fileRootAbs
  };
}

export function buildAistreamCfgForAgentRoot(aistreamCfg = {}, agentRootAbs) {
  if (!agentRootAbs) return aistreamCfg || {};
  const projectRoot = getProjectRoot();
  let rel = '';
  try {
    rel = path.relative(projectRoot, agentRootAbs);
    if (rel.startsWith('..')) rel = agentRootAbs;
  } catch {
    rel = agentRootAbs;
  }
  return {
    ...aistreamCfg,
    agentWorkspace: {
      ...(aistreamCfg?.agentWorkspace || {}),
      root: rel === '' ? '' : rel
    }
  };
}

export function applyRequestWorkspaceToStreams(StreamLoader, fileWorkspaceAbs) {
  if (!fileWorkspaceAbs || !StreamLoader?.getStream) return () => {};

  const snapshots = [];
  for (const name of ['tools', 'desktop']) {
    const stream = StreamLoader.getStream(name);
    if (!stream) continue;
    snapshots.push({
      stream,
      workspace: stream.workspace,
      tools: stream.tools
    });
    stream.workspace = fileWorkspaceAbs;
    if (stream.tools instanceof BaseTools) {
      stream.tools = new BaseTools(fileWorkspaceAbs);
    }
  }

  return () => {
    for (const snap of snapshots) {
      snap.stream.workspace = snap.workspace;
      snap.stream.tools = snap.tools;
    }
  };
}

function resolveDirUnderRoot(rootAbs, dirRel = '') {
  const rootReal = realpathSyncOrResolve(rootAbs);
  const target = path.resolve(rootReal, String(dirRel || '').replace(/\\/g, '/'));
  const targetReal = realpathSyncOrResolve(target);
  if (!isPathInside(rootReal, targetReal)) {
    throw new Error('目录超出工作区范围');
  }
  return targetReal;
}

export function listWorkspaceFiles(fileRootAbs, dirRel = '') {
  const dirAbs = resolveDirUnderRoot(fileRootAbs, dirRel);
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (err) {
    throw new Error(err?.message || '无法读取目录');
  }

  const relBase = String(dirRel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const files = entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => {
      const relPath = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        return { name: e.name, path: relPath, type: 'dir' };
      }
      if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(dirAbs, e.name)).size;
        } catch {}
        return { name: e.name, path: relPath, type: 'file', size };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  return { root: fileRootAbs, dir: relBase, files };
}

function resolveFileUnderRoot(fileRootAbs, relPath = '') {
  const rootReal = realpathSyncOrResolve(fileRootAbs);
  const abs = path.resolve(rootReal, String(relPath || '').replace(/\\/g, '/'));
  const fileReal = realpathSyncOrResolve(abs);
  if (!isPathInside(rootReal, fileReal)) {
    throw new Error('文件路径超出工作区范围');
  }
  return fileReal;
}

export function readWorkspaceAgents(agentRootAbs) {
  for (const rel of AGENTS_CANDIDATES) {
    const abs = path.join(agentRootAbs, rel);
    const result = readTextFileUnderWorkspaceRoot(agentRootAbs, abs);
    if (result.ok) {
      return { path: rel, content: result.content };
    }
  }
  return { path: AGENTS_CANDIDATES[0], content: '' };
}

export function writeWorkspaceAgents(agentRootAbs, content = '') {
  const rel = AGENTS_CANDIDATES[0];
  const abs = path.join(agentRootAbs, rel);
  const rootReal = realpathSyncOrResolve(agentRootAbs);
  const dir = path.dirname(abs);
  if (!isPathInside(rootReal, realpathSyncOrResolve(dir))) {
    throw new Error('无法写入工作区外路径');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
  return { path: rel };
}

export function openWorkspaceFileDownload(fileRootAbs, relPath) {
  const fileReal = resolveFileUnderRoot(fileRootAbs, relPath);
  const st = fs.statSync(fileReal);
  if (!st.isFile()) throw new Error('不是文件');
  return { abs: fileReal, name: path.basename(fileReal) };
}

export function sanitizeWorkspaceUploadName(name) {
  const base = path.basename(String(name || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'));
  return base.slice(0, 200) || 'file';
}
