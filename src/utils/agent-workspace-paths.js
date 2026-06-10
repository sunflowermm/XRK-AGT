/**
 * Agent 工作区路径约定（对齐 OpenClaw 等：独立工作区目录，非项目根）。
 *
 * - 根目录 AGENTS.md：IDE 开发规则，不参与运行时
 * - agents/workspace/*：仓库内置模板，首次创建 data 工作区时复制进去
 * - data/ai-workspace/{id}/*：运行时工作区（AGENTS.md、SOUL.md、memory/…）
 */
import fs from 'node:fs';
import path from 'node:path';
import paths from '#utils/paths.js';
import { getAistreamConfigOptional } from '#utils/aistream-config.js';
import { isPathInside, realpathSyncOrResolve } from '#utils/path-guards.js';

export const AGENTS_MD = 'AGENTS.md';

/** 工作区根目录下的助手模板文件名（OpenClaw 风格扁平布局） */
export const WORKSPACE_TEMPLATE_RELS = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'ENV.md',
  'HEARTBEAT.md',
];

export const LONG_TERM_MEMORY_REL = 'memory/MEMORY.md';

/** 仓库内首次引导用的模板目录（只读，运行时不从此处注入） */
export const WORKSPACE_BUNDLE_DIR_REL = 'agents/workspace';

/** 办公技能包（复制到工作区 skills/，与 aistream customSkillRoots 对齐） */
export const PROJECT_SKILLS_STANDARD_REL = 'skills/standard';

/** 工作区内技能目录名（相对 data/ai-workspace/{id}） */
export const WORKSPACE_SKILLS_DIR = 'skills';

export const DEFAULT_WORKSPACE_ID = 'default';

function copyTreeMissingOnly(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeMissingOnly(src, dest);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

export function getProjectRoot() {
  return paths.root || process.cwd();
}

export function normalizeWorkspaceId(raw) {
  let id = String(raw || DEFAULT_WORKSPACE_ID).trim() || DEFAULT_WORKSPACE_ID;
  if (id === 'desktop') id = DEFAULT_WORKSPACE_ID;
  return id.replace(/[^\w.\u4e00-\u9fa5-]/g, '_').slice(0, 64) || DEFAULT_WORKSPACE_ID;
}

export function getConfiguredDefaultWorkspaceId() {
  const cfg = getAistreamConfigOptional();
  const raw = cfg?.workspace?.defaultId;
  if (raw != null && String(raw).trim() !== '') {
    return normalizeWorkspaceId(raw);
  }
  return DEFAULT_WORKSPACE_ID;
}

export function getAgentWorkspacesRoot() {
  return paths.dataAiWorkspace || path.join(paths.data, 'ai-workspace');
}

export function getAgentWorkspaceAbs(id = DEFAULT_WORKSPACE_ID) {
  return path.join(getAgentWorkspacesRoot(), normalizeWorkspaceId(id));
}

export function isAgentDataWorkspaceAbs(absPath) {
  if (!absPath) return false;
  try {
    const wsRoot = realpathSyncOrResolve(getAgentWorkspacesRoot());
    return isPathInside(wsRoot, realpathSyncOrResolve(absPath));
  } catch {
    return false;
  }
}

/** 从仓库 agents/workspace 复制缺失的模板到 data 工作区（不覆盖已有文件；不向项目根写入） */
export function seedWorkspaceFromBundle(workspaceAbs) {
  if (!isAgentDataWorkspaceAbs(workspaceAbs)) return;
  fs.mkdirSync(workspaceAbs, { recursive: true });
  fs.mkdirSync(path.join(workspaceAbs, 'memory'), { recursive: true });

  const bundleDir = path.join(getProjectRoot(), WORKSPACE_BUNDLE_DIR_REL);
  const seedNames = [AGENTS_MD, ...WORKSPACE_TEMPLATE_RELS];

  for (const name of seedNames) {
    const dest = path.join(workspaceAbs, name);
    if (fs.existsSync(dest)) continue;
    const src = path.join(bundleDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  const bundleMemory = path.join(bundleDir, LONG_TERM_MEMORY_REL);
  const wsMemory = path.join(workspaceAbs, LONG_TERM_MEMORY_REL);
  if (!fs.existsSync(wsMemory) && fs.existsSync(bundleMemory)) {
    fs.copyFileSync(bundleMemory, wsMemory);
  }

  const standardSkills = path.join(getProjectRoot(), PROJECT_SKILLS_STANDARD_REL);
  copyTreeMissingOnly(standardSkills, path.join(workspaceAbs, WORKSPACE_SKILLS_DIR));

  if (!fs.existsSync(path.join(workspaceAbs, AGENTS_MD))) {
    const label = path.basename(workspaceAbs) === DEFAULT_WORKSPACE_ID ? '默认工作区' : path.basename(workspaceAbs);
    fs.writeFileSync(
      path.join(workspaceAbs, AGENTS_MD),
      `# ${label}\n\n在此编写 Agent 规则（AGENTS.md）。\n`,
      'utf8'
    );
  }
}

/**
 * 解析 prompt 注入 / 控制台读写用的工作区绝对路径。
 * cfg.root 留空 → data/ai-workspace/{defaultId}；显式路径则相对项目根解析。
 */
export function resolveAgentWorkspaceAbs(cfgRoot = '') {
  if (cfgRoot != null && String(cfgRoot).trim() !== '') {
    const raw = String(cfgRoot).trim();
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(getProjectRoot(), raw);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }
  const abs = getAgentWorkspaceAbs(getConfiguredDefaultWorkspaceId());
  seedWorkspaceFromBundle(abs);
  return abs;
}

export function getAgentsReadCandidates() {
  return [AGENTS_MD];
}

export function getAgentsWriteRel() {
  return AGENTS_MD;
}
