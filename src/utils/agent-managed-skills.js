/**
 * 项目托管技能（agents/skills/standard 有对应包）：
 * - seed：缺啥补啥
 * - #skills更新：安全同步（工作区相对上次种子未改动才覆盖；改过的跳过）
 * - #skills更新 强制：托管包全部覆盖；用户自建（种子无包）永不碰
 * - 允许用户/AI 改托管副本；改过即视为定制，安全更新会跳过
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isPathInside, realpathSyncOrResolve } from '#utils/path-guards.js';
import {
  PROJECT_SKILLS_STANDARD_REL,
  WORKSPACE_SKILLS_DIR,
  getProjectRoot,
  resolveAgentWorkspaceAbs,
} from '#utils/agent-workspace-paths.js';

const LOCK_REL = path.join('.xrk', 'managed-skills-lock.json');

/** @param {string} dir @param {string[]} outRels @param {string} base */
function walkSkillPackages(dir, outRels, base) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    outRels.push(path.relative(base, dir).replace(/\\/g, '/'));
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (!e.isDirectory()) continue;
    walkSkillPackages(path.join(dir, e.name), outRels, base);
  }
}

/** 种子内技能包相对路径，如 core/agent-tools */
export function listProjectManagedSkillRels(projectRoot = getProjectRoot()) {
  const standard = path.join(projectRoot, PROJECT_SKILLS_STANDARD_REL);
  const out = [];
  if (!fs.existsSync(standard)) return out;
  walkSkillPackages(standard, out, standard);
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} workspaceRoot
 * @param {string} filePath
 */
export function isProjectManagedSkillPath(workspaceRoot, filePath) {
  if (!workspaceRoot || filePath == null || String(filePath).trim() === '') return false;
  try {
    const abs = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workspaceRoot, filePath);
    const skillsNorm = path.normalize(path.join(workspaceRoot, WORKSPACE_SKILLS_DIR));
    let absNorm = abs;
    try {
      const skillsRoot = realpathSyncOrResolve(skillsNorm);
      const fileReal = realpathSyncOrResolve(abs);
      if (!isPathInside(skillsRoot, fileReal) && fileReal !== skillsRoot) return false;
      return isRelUnderManagedPackage(path.relative(skillsRoot, fileReal).replace(/\\/g, '/'));
    } catch {
      absNorm = path.normalize(abs);
      if (!absNorm.startsWith(skillsNorm + path.sep) && absNorm !== skillsNorm) return false;
      return isRelUnderManagedPackage(path.relative(skillsNorm, absNorm).replace(/\\/g, '/'));
    }
  } catch {
    return false;
  }
}

function isRelUnderManagedPackage(rel) {
  if (!rel || rel.startsWith('..')) return false;
  for (const pkg of listProjectManagedSkillRels()) {
    if (rel === pkg || rel.startsWith(`${pkg}/`)) return true;
  }
  return false;
}

function listFilesRecursive(dir) {
  const out = [];
  const walk = (cur) => {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.isFile()) out.push(fp);
    }
  };
  walk(dir);
  return out;
}

/** 目录内容指纹（路径相对 dir，排序后哈希） */
export function hashSkillPackageDir(dirAbs) {
  if (!fs.existsSync(dirAbs)) return '';
  const files = listFilesRecursive(dirAbs)
    .map((fp) => path.relative(dirAbs, fp).replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));
  const h = createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(dirAbs, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function lockPath(workspaceAbs) {
  return path.join(workspaceAbs, LOCK_REL);
}

function readLock(workspaceAbs) {
  const fp = lockPath(workspaceAbs);
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const packages = raw?.packages && typeof raw.packages === 'object' ? raw.packages : {};
    return { packages };
  } catch {
    return { packages: {} };
  }
}

function writeLock(workspaceAbs, lock) {
  const fp = lockPath(workspaceAbs);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(
    fp,
    `${JSON.stringify({ version: 1, packages: lock.packages, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
}

function copyDirOverwrite(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

/**
 * @param {string} [workspaceAbs]
 * @param {{ force?: boolean }} [opts] force=true 时覆盖已定制的托管包；自建仍不动
 */
export function syncManagedSkills(workspaceAbs, opts = {}) {
  const force = opts.force === true;
  const ws =
    workspaceAbs && String(workspaceAbs).trim()
      ? path.normalize(workspaceAbs)
      : resolveAgentWorkspaceAbs();
  const projectRoot = getProjectRoot();
  const standard = path.join(projectRoot, PROJECT_SKILLS_STANDARD_REL);
  if (!fs.existsSync(standard)) {
    return { ok: false, error: `种子不存在：${PROJECT_SKILLS_STANDARD_REL}` };
  }

  const destRoot = path.join(ws, WORKSPACE_SKILLS_DIR);
  fs.mkdirSync(destRoot, { recursive: true });
  const lock = readLock(ws);
  const pkgs = listProjectManagedSkillRels(projectRoot);

  const updated = [];
  const skippedModified = [];
  const unchanged = [];
  const installed = [];

  for (const rel of pkgs) {
    const src = path.join(standard, rel);
    const dest = path.join(destRoot, rel);
    const seedHash = hashSkillPackageDir(src);
    const prev = lock.packages[rel];
    const prevSeed = typeof prev?.seedHash === 'string' ? prev.seedHash : '';

    try {
      if (!fs.existsSync(dest)) {
        copyDirOverwrite(src, dest);
        lock.packages[rel] = { seedHash, syncedAt: new Date().toISOString() };
        installed.push(rel);
        continue;
      }

      const wsHash = hashSkillPackageDir(dest);

      if (force) {
        if (wsHash === seedHash) {
          lock.packages[rel] = { seedHash, syncedAt: new Date().toISOString() };
          unchanged.push(rel);
        } else {
          copyDirOverwrite(src, dest);
          lock.packages[rel] = { seedHash, syncedAt: new Date().toISOString() };
          updated.push(rel);
        }
        continue;
      }

      // 安全模式：仅当工作区仍等于「上次同步的种子」时才覆盖
      const pristine = prevSeed && wsHash === prevSeed;
      if (pristine) {
        if (seedHash === prevSeed) {
          unchanged.push(rel);
        } else {
          copyDirOverwrite(src, dest);
          lock.packages[rel] = { seedHash, syncedAt: new Date().toISOString() };
          updated.push(rel);
        }
        continue;
      }

      // 无 lock：若已与当前种子一致 → 只记账；否则视为用户定制，跳过
      if (!prevSeed) {
        if (wsHash === seedHash) {
          lock.packages[rel] = { seedHash, syncedAt: new Date().toISOString() };
          unchanged.push(rel);
        } else {
          skippedModified.push(rel);
        }
        continue;
      }

      // 有 lock 但工作区已改
      skippedModified.push(rel);
    } catch (err) {
      return {
        ok: false,
        error: `同步失败 ${rel}: ${err?.message || err}`,
        updated,
        installed,
        skippedModified,
        unchanged
      };
    }
  }

  writeLock(ws, lock);
  return {
    ok: true,
    force,
    updated,
    installed,
    skippedModified,
    unchanged,
    hint: force
      ? '已强制覆盖托管包；种子中不存在的工作区技能（用户自建）未改动。'
      : '安全更新：未改动的托管包已对齐种子；你改过的托管包已跳过（需要时用 #skills更新 强制）。用户自建未改动。'
  };
}

/** @deprecated 用 syncManagedSkills(..., { force: true }) */
export function forceSyncManagedSkills(workspaceAbs) {
  return syncManagedSkills(workspaceAbs, { force: true });
}
