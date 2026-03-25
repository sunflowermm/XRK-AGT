/**
 * Agent Skills：与 OpenClaw `src/agents/skills/workspace.ts` 同结构的发现 / 预算 / 降级算法，
 * 实际加载与 XML 正文由 `@mariozechner/pi-coding-agent`（loadSkillsFromDir / formatSkillsForPrompt）完成。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatSkillsForPrompt, loadSkillsFromDir } from '@mariozechner/pi-coding-agent';
import { isPathInside, realpathSyncOrResolve } from '#utils/path-guards.js';

function resolveContainedSkillPath({ rootRealPath, candidatePath }) {
  const candidateRealPath = realpathSyncOrResolve(candidatePath);
  if (!isPathInside(rootRealPath, candidateRealPath)) return null;
  return candidateRealPath;
}

function listChildDirectories(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(entry.name);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(fullPath).isDirectory()) dirs.push(entry.name);
        } catch {
          /* broken symlink */
        }
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

function resolveNestedSkillsRoot(dir, opts = {}) {
  const nested = path.join(dir, 'skills');
  try {
    if (!fs.existsSync(nested) || !fs.statSync(nested).isDirectory()) {
      return { baseDir: dir };
    }
  } catch {
    return { baseDir: dir };
  }

  const nestedDirs = listChildDirectories(nested);
  const scanLimit = Math.max(0, opts.maxEntriesToScan ?? 100);
  const toScan = scanLimit === 0 ? [] : nestedDirs.slice(0, Math.min(nestedDirs.length, scanLimit));

  for (const name of toScan) {
    const skillMd = path.join(nested, name, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      return { baseDir: nested, note: `Detected nested skills root at ${nested}` };
    }
  }
  return { baseDir: dir };
}

function unwrapLoadedSkills(loaded) {
  if (Array.isArray(loaded)) return loaded;
  if (loaded && typeof loaded === 'object' && 'skills' in loaded) {
    const skills = loaded.skills;
    if (Array.isArray(skills)) return skills;
  }
  return [];
}

function filterLoadedSkillsInsideRoot({ skills, rootRealPath }) {
  return skills.filter((skill) => {
    const baseDirRealPath = resolveContainedSkillPath({
      rootRealPath,
      candidatePath: skill.baseDir,
    });
    if (!baseDirRealPath) return false;
    return Boolean(
      resolveContainedSkillPath({
        rootRealPath: baseDirRealPath,
        candidatePath: skill.filePath,
      }),
    );
  });
}

/**
 * OpenClaw loadSkillEntries → loadSkills 内层逻辑（单根目录）。
 * @param {{ dir: string, source: string }} params
 * @param {{ maxCandidatesPerRoot: number, maxSkillsLoadedPerSource: number, maxSkillFileBytes: number }} limits
 */
function loadSkillsForOneRoot(params, limits) {
  const rootDir = path.resolve(params.dir);
  const rootRealPath = realpathSyncOrResolve(rootDir);
  const resolved = resolveNestedSkillsRoot(params.dir, {
    maxEntriesToScan: limits.maxCandidatesPerRoot,
  });
  const baseDir = resolved.baseDir;
  const baseDirRealPath = resolveContainedSkillPath({
    rootRealPath,
    candidatePath: baseDir,
  });
  if (!baseDirRealPath) return [];

  const rootSkillMd = path.join(baseDir, 'SKILL.md');
  if (fs.existsSync(rootSkillMd)) {
    const rootSkillRealPath = resolveContainedSkillPath({
      rootRealPath: baseDirRealPath,
      candidatePath: rootSkillMd,
    });
    if (!rootSkillRealPath) return [];
    try {
      const size = fs.statSync(rootSkillRealPath).size;
      if (size > limits.maxSkillFileBytes) return [];
    } catch {
      return [];
    }
    const loaded = loadSkillsFromDir({ dir: baseDir, source: params.source });
    return filterLoadedSkillsInsideRoot({
      skills: unwrapLoadedSkills(loaded),
      rootRealPath: baseDirRealPath,
    });
  }

  const childDirs = listChildDirectories(baseDir);
  const maxCandidates = Math.max(0, limits.maxSkillsLoadedPerSource);
  const limitedChildren = childDirs.slice().sort().slice(0, maxCandidates);

  const loadedSkills = [];
  for (const name of limitedChildren) {
    const skillDir = path.join(baseDir, name);
    const skillDirRealPath = resolveContainedSkillPath({
      rootRealPath: baseDirRealPath,
      candidatePath: skillDir,
    });
    if (!skillDirRealPath) continue;
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const skillMdRealPath = resolveContainedSkillPath({
      rootRealPath: baseDirRealPath,
      candidatePath: skillMd,
    });
    if (!skillMdRealPath) continue;
    try {
      const size = fs.statSync(skillMdRealPath).size;
      if (size > limits.maxSkillFileBytes) continue;
    } catch {
      continue;
    }

    const loaded = loadSkillsFromDir({ dir: skillDir, source: params.source });
    loadedSkills.push(
      ...filterLoadedSkillsInsideRoot({
        skills: unwrapLoadedSkills(loaded),
        rootRealPath: baseDirRealPath,
      }),
    );

    if (loadedSkills.length >= limits.maxSkillsLoadedPerSource) break;
  }

  if (loadedSkills.length > limits.maxSkillsLoadedPerSource) {
    return loadedSkills
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limits.maxSkillsLoadedPerSource);
  }
  return loadedSkills;
}

/** OpenClaw compactSkillPaths */
function compactSkillPaths(skills) {
  const home = os.homedir();
  if (!home) return skills;
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  return skills.map((s) => ({
    ...s,
    filePath: s.filePath.startsWith(prefix) ? `~/${s.filePath.slice(prefix.length)}` : s.filePath,
  }));
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** OpenClaw formatSkillsCompact（模块内用，不对外导出） */
function formatSkillsCompact(skills) {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return '';
  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its name.",
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

const COMPACT_WARNING_OVERHEAD = 150;

/** OpenClaw applySkillsPromptLimits */
function applySkillsPromptLimits(skills, limits) {
  const total = skills.length;
  const byCount = skills.slice(0, Math.max(0, limits.maxSkillsInPrompt));
  let skillsForPrompt = byCount;
  let truncated = total > byCount.length;
  let compact = false;

  const fitsFull = (s) => formatSkillsForPrompt(s).length <= limits.maxSkillsPromptChars;
  const compactBudget = limits.maxSkillsPromptChars - COMPACT_WARNING_OVERHEAD;
  const fitsCompact = (s) => formatSkillsCompact(s).length <= compactBudget;

  if (!fitsFull(skillsForPrompt)) {
    if (fitsCompact(skillsForPrompt)) {
      compact = true;
    } else {
      compact = true;
      let lo = 0;
      let hi = skillsForPrompt.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fitsCompact(skillsForPrompt.slice(0, mid))) lo = mid;
        else hi = mid - 1;
      }
      skillsForPrompt = skillsForPrompt.slice(0, lo);
      truncated = true;
    }
  }

  return { skillsForPrompt, truncated, compact };
}

const DEFAULT_SKILL_ROOTS = ['.cursor/skills', '.agents/skills', 'skills'];

/**
 * @param {string} workspaceRootResolved 已 realpath 的工作区根
 * @param {object} cfg agentWorkspace 中与 skills 相关字段
 * @returns {string} XML 技能目录或空串
 */
export function buildSkillsPromptFromWorkspace(workspaceRootResolved, cfg = {}) {
  const limits = {
    maxCandidatesPerRoot: cfg.maxCandidatesPerRoot ?? 300,
    maxSkillsLoadedPerSource: cfg.maxSkillsLoadedPerSource ?? cfg.maxSkillFiles ?? 200,
    maxSkillsInPrompt: cfg.maxSkillsInPrompt ?? 150,
    maxSkillsPromptChars: cfg.maxSkillsPromptChars ?? 30_000,
    maxSkillFileBytes: cfg.maxSkillFileBytes ?? 256_000,
  };

  const skillRoots =
    Array.isArray(cfg.skillRoots) && cfg.skillRoots.length > 0 ? cfg.skillRoots : DEFAULT_SKILL_ROOTS;

  const merged = new Map();
  for (const rel of skillRoots) {
    const abs = path.join(workspaceRootResolved, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const slug = String(rel).replace(/[^\w.-]+/g, '_');
    const loaded = loadSkillsForOneRoot({ dir: abs, source: `xrk-${slug}` }, limits);
    for (const skill of loaded) {
      merged.set(skill.name, skill);
    }
  }

  const resolvedSkills = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (resolvedSkills.length === 0) return '';

  const promptSkills = compactSkillPaths(resolvedSkills);
  const { skillsForPrompt, truncated, compact } = applySkillsPromptLimits(promptSkills, limits);
  const truncationNote = truncated
    ? `⚠️ Skills truncated: included ${skillsForPrompt.length} of ${resolvedSkills.length}${compact ? ' (compact format, descriptions omitted)' : ''}.`
    : compact
      ? '⚠️ Skills catalog using compact format (descriptions omitted).'
      : '';
  return [truncationNote, compact ? formatSkillsCompact(skillsForPrompt) : formatSkillsForPrompt(skillsForPrompt)]
    .filter(Boolean)
    .join('\n');
}
