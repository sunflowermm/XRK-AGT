/**
 * 工作区上下文注入：data/ai-workspace 助手文件 + 项目级 rules/skills/subagents。
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import paths from '#utils/paths.js';
import { realpathSyncOrResolve } from '#utils/path-guards.js';
import { readTextFileUnderWorkspaceRoot } from '#utils/safe-workspace-read.js';
import { buildSkillsPromptFromWorkspace } from '#utils/agent-workspace-skills.js';
import { DEFAULT_SKILL_LIMITS } from '#utils/skills/defaults.js';
import { buildWorkspacePromptSections } from '#utils/agent-workspace-sections.js';
import {
  AGENTS_MD,
  WORKSPACE_TEMPLATE_RELS,
  LONG_TERM_MEMORY_REL,
  PROJECT_SKILLS_STANDARD_REL,
  WORKSPACE_SKILLS_DIR,
  getProjectRoot,
  resolveAgentWorkspaceAbs,
  getWorkspaceSkillsSyncReport,
} from '#utils/agent-workspace-paths.js';

const SUBAGENT_MANIFEST_RELS = ['agents/subagents.yaml', 'agents/subagents.yml', 'agents/subagents.json'];

const workspaceFileCache = new Map();

function listFilesRecursive(dir, predicate) {
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
      if (e.name === 'node_modules') continue;
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        walk(fp);
        continue;
      }
      if (e.isFile() && predicate(fp, e.name)) out.push(fp);
    }
  };
  walk(dir);
  return out;
}

/** @type {Array<(ctx: object) => Promise<{ title?: string, body?: string } | null | void>>} */
const workspaceProviders = [];

export function registerAgentWorkspaceProvider(fn) {
  if (typeof fn !== 'function') return () => {};
  workspaceProviders.push(fn);
  return () => {
    const i = workspaceProviders.indexOf(fn);
    if (i >= 0) workspaceProviders.splice(i, 1);
  };
}

function sliceWorkspaceCfg(aistreamCfg) {
  return aistreamCfg?.agentWorkspace ?? {};
}

function truncate(text, max, label) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… (truncated ${label}, len=${text.length})`;
}

function readTextFileUnderWorkspaceRootCached(rootResolved, absolutePath, maxBytes) {
  let canonical;
  let st;
  try {
    canonical = realpathSyncOrResolve(absolutePath);
    st = fs.statSync(canonical);
  } catch {
    return { ok: false, reason: 'io' };
  }

  const identity = `${st.size}:${st.mtimeMs}`;
  const cached = workspaceFileCache.get(canonical);
  if (cached && cached.identity === identity) {
    return { ok: true, content: cached.content };
  }

  const got = readTextFileUnderWorkspaceRoot(rootResolved, absolutePath, maxBytes);
  if (got.ok) {
    workspaceFileCache.set(canonical, { identity, content: got.content });
  } else {
    workspaceFileCache.delete(canonical);
  }
  return got;
}

function readFirstWorkspaceFile(rootResolved, candidates, maxBytes) {
  for (const rel of candidates) {
    const fp = path.join(rootResolved, rel);
    const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, maxBytes);
    if (!got.ok) continue;
    return { rel, content: got.content };
  }
  return null;
}

function injectWorkspaceAssistant(workspaceRoot, maxChars, pushProse, { isMainSession, includeDiagnostics, maxDiagnosticsChars }) {
  const agentsGot = readFirstWorkspaceFile(workspaceRoot, [AGENTS_MD], maxChars * 4);
  if (agentsGot) {
    pushProse(agentsGot.rel, truncate(agentsGot.content, maxChars, agentsGot.rel));
  }

  for (const rel of WORKSPACE_TEMPLATE_RELS) {
    const fp = path.join(workspaceRoot, rel);
    const got = readTextFileUnderWorkspaceRootCached(workspaceRoot, fp, maxChars * 4);
    if (!got.ok) continue;
    pushProse(rel, truncate(got.content, maxChars, rel));
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  for (const ymd of [toYmd(now), toYmd(yesterday)]) {
    const rel = `memory/${ymd}.md`;
    const fp = path.join(workspaceRoot, rel);
    const got = readTextFileUnderWorkspaceRootCached(workspaceRoot, fp, maxChars * 4);
    if (!got.ok) continue;
    pushProse(rel, truncate(got.content, maxChars, rel));
  }

  if (isMainSession) {
    const memoryGot = readFirstWorkspaceFile(workspaceRoot, [LONG_TERM_MEMORY_REL], maxChars * 4);
    if (memoryGot) {
      pushProse(memoryGot.rel, truncate(memoryGot.content, maxChars, memoryGot.rel));
    } else if (includeDiagnostics) {
      const mentionsMemory = /memory\/memory\.md|memory\/\d{4}-\d{2}-\d{2}\.md/i.test(agentsGot?.content || '');
      if (!mentionsMemory) {
        const diag = [
          '未发现长期记忆文件（`memory/MEMORY.md`）。',
          '建议：在工作区 `memory/MEMORY.md` 写入长期偏好/约束，并与 `AGENTS.md` 保持一致。',
        ].join('\n');
        pushProse('Workspace diagnostics', truncate(diag, maxDiagnosticsChars, 'diagnostics'));
      }
    }

    if (includeDiagnostics) {
      const skillReport = getWorkspaceSkillsSyncReport(workspaceRoot);
      const lines = [];
      if (!readFirstWorkspaceFile(workspaceRoot, ['ENV.md'], 512)) {
        lines.push('缺少 `ENV.md`（本机能力与依赖清单）。模板在 `agents/workspace/ENV.md`，重启或触发工作区 seed 可补全。');
      }
      if (skillReport.missingInWorkspace.length > 0) {
        lines.push(
          `工作区 skills/ 缺 ${skillReport.missingInWorkspace.length} 个标准技能（standard ${skillReport.standardCount} / workspace ${skillReport.workspaceCount}）。`,
          `缺失示例：${skillReport.missingInWorkspace.slice(0, 8).join(', ')}${skillReport.missingInWorkspace.length > 8 ? '…' : ''}`,
          '补全：重启 Bot 触发 seed（只复制缺失目录，不覆盖已改副本）；或从 `skills/standard/` 手动拷贝。'
        );
      }
      if (lines.length > 0) {
        pushProse('Workspace diagnostics', truncate(lines.join('\n'), maxDiagnosticsChars, 'diagnostics'));
      }
    }
  }
}

export async function buildAgentWorkspaceSection(agentWorkspaceCfg = {}, streamName = '') {
  const cfg = {
    enabled: true,
    root: '',
    streams: null,
    includeRules: true,
    includeAgentMd: true,
    includeSubagents: true,
    includeDiagnostics: false,
    maxTotalChars: 0,
    maxRulesChars: 12_000,
    maxAgentMdChars: 12_000,
    maxDiagnosticsChars: 2_000,
    maxCandidatesPerRoot: DEFAULT_SKILL_LIMITS.maxCandidatesPerRoot,
    maxSkillsLoadedPerSource: DEFAULT_SKILL_LIMITS.maxSkillsLoadedPerSource,
    maxSkillsInPrompt: DEFAULT_SKILL_LIMITS.maxSkillsInPrompt,
    maxSkillsPromptChars: DEFAULT_SKILL_LIMITS.maxSkillsPromptChars,
    maxSkillFileBytes: DEFAULT_SKILL_LIMITS.maxSkillFileBytes,
    customSkillRoots: [],
    contextFiles: [],
    ...agentWorkspaceCfg
  };

  if (cfg.enabled === false) return '';

  if (Array.isArray(cfg.streams) && cfg.streams.length > 0 && streamName) {
    if (!cfg.streams.includes(streamName)) return '';
  }

  let workspaceRoot;
  let projectRoot;
  try {
    workspaceRoot = realpathSyncOrResolve(resolveAgentWorkspaceAbs(cfg.root));
    projectRoot = realpathSyncOrResolve(getProjectRoot());
    if (!fs.statSync(workspaceRoot).isDirectory()) return '';
  } catch {
    return '';
  }

  const maxProse = cfg.maxTotalChars > 0 ? cfg.maxTotalChars : Number.POSITIVE_INFINITY;
  const proseSections = [];
  let proseUsed = 0;
  const proseRoom = () => Math.max(0, maxProse - proseUsed);

  const pushProse = (title, body) => {
    if (!body?.trim()) return;
    const room = proseRoom();
    if (room <= 0) return;
    const chunk = truncate(body.trim(), room, title);
    const block = `## ${title}\n\n${chunk}`;
    proseUsed += block.length + 2;
    proseSections.push(block);
  };

  const ctx = { workspaceRoot, projectRoot, cfg, streamName, paths };

  if (cfg.includeAgentMd) {
    injectWorkspaceAssistant(workspaceRoot, cfg.maxAgentMdChars, pushProse, {
      isMainSession: streamName === 'v3' || !streamName,
      includeDiagnostics: cfg.includeDiagnostics,
      maxDiagnosticsChars: cfg.maxDiagnosticsChars
    });
  }

  const extraMarkdownFiles = Array.isArray(cfg.contextFiles) ? cfg.contextFiles : [];
  for (const rel of extraMarkdownFiles) {
    if (typeof rel !== 'string' || !rel.trim()) continue;
    const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (safeRel.includes('..')) continue;
    const fp = path.join(workspaceRoot, safeRel);
    const got = readTextFileUnderWorkspaceRootCached(workspaceRoot, fp, 2 * 1024 * 1024);
    if (!got.ok) continue;
    pushProse(safeRel, got.content);
  }

  try {
    const sections = await buildWorkspacePromptSections(ctx);
    if (Array.isArray(sections) && sections.length > 0) {
      sections
        .filter((s) => s?.title && s?.body)
        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
        .forEach((s) => pushProse(String(s.title), String(s.body)));
    }
  } catch {
    /* ignore */
  }

  if (cfg.includeRules) {
    const rulesDir = path.join(projectRoot, 'rules');
    try {
      const absFiles = listFilesRecursive(rulesDir, (_fp, name) => name.endsWith('.md') || name.endsWith('.mdc'));
      const relFiles = absFiles
        .map((fp) => path.relative(rulesDir, fp).replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b));

      let acc = '';
      for (const rel of relFiles) {
        const fp = path.join(rulesDir, ...rel.split('/'));
        const got = readTextFileUnderWorkspaceRootCached(projectRoot, fp, cfg.maxRulesChars * 4);
        if (!got.ok) continue;
        acc += `\n### ${rel}\n\n${got.content}\n`;
        if (acc.length >= cfg.maxRulesChars) break;
      }
      pushProse('rules', truncate(acc.trim(), cfg.maxRulesChars, 'rules'));
    } catch {
      /* no rules dir */
    }
  }

  for (const provider of workspaceProviders) {
    try {
      const out = await provider(ctx);
      if (out?.title && out?.body) pushProse(out.title, out.body);
    } catch {
      /* ignore */
    }
  }

  const parts = [...proseSections];

  const configuredRoots = Array.isArray(cfg.customSkillRoots) ? cfg.customSkillRoots.filter(Boolean).map(String) : [];
  const skillRootAbs = new Set();
  for (const rel of configuredRoots) {
    skillRootAbs.add(path.isAbsolute(rel) ? rel : path.join(projectRoot, rel));
  }
  if (!configuredRoots.length) {
    skillRootAbs.add(path.join(projectRoot, PROJECT_SKILLS_STANDARD_REL));
  }
  const wsSkillsDir = path.join(workspaceRoot, WORKSPACE_SKILLS_DIR);
  if (fs.existsSync(wsSkillsDir)) {
    skillRootAbs.add(wsSkillsDir);
  }
  if (skillRootAbs.size > 0) {
    const roots = [...skillRootAbs].sort((a, b) => a.localeCompare(b));
    const skillsPrompt = buildSkillsPromptFromWorkspace(projectRoot, { ...cfg, customSkillRoots: roots });
    if (skillsPrompt) parts.push(`## Skills\n\n${skillsPrompt}`);
  }

  if (cfg.includeSubagents) {
    for (const rel of SUBAGENT_MANIFEST_RELS) {
      const fp = path.join(projectRoot, rel);
      const got = readTextFileUnderWorkspaceRootCached(projectRoot, fp, 512 * 1024);
      if (!got.ok) continue;
      try {
        const data = fp.endsWith('.json') ? JSON.parse(got.content) : YAML.parse(got.content);
        const list = data?.subagents || data?.agents || (Array.isArray(data) ? data : null);
        if (!Array.isArray(list) || list.length === 0) continue;
        let subTxt = '';
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const id = item.name || item.id || 'subagent';
          const line = item.description || item.prompt || item.instructions || '';
          const model = item.model ? ` (model: ${item.model})` : '';
          subTxt += `- **${id}**${model}: ${line}\n`;
        }
        parts.push(`## Subagents\n\n${subTxt}`);
        break;
      } catch {
        /* try next */
      }
    }
  }

  if (!parts.length) return '';
  return `\n\n---\n\n# Workspace context\n\n${parts.join('\n\n')}\n`;
}

export async function appendAgentWorkspaceToPrompt(basePrompt, aistreamCfg = {}, streamName = '') {
  if (basePrompt == null) return basePrompt;
  const extra = await buildAgentWorkspaceSection(sliceWorkspaceCfg(aistreamCfg), streamName);
  if (!extra) return String(basePrompt);
  return `${basePrompt}${extra}`;
}

export async function mergeAgentWorkspaceIntoMessages(messages, aistreamCfg = {}, streamName = '') {
  if (!Array.isArray(messages)) return messages;
  const extra = await buildAgentWorkspaceSection(sliceWorkspaceCfg(aistreamCfg), streamName);
  if (!extra) return messages;
  const first = messages[0];
  if (first?.role === 'system' && typeof first.content === 'string') {
    first.content = `${first.content}${extra}`;
    return messages;
  }
  messages.unshift({ role: 'system', content: extra.replace(/^\s+/, '') });
  return messages;
}
