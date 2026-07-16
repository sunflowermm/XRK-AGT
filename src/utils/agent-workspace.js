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
import {
  AGENTS_MD,
  WORKSPACE_TEMPLATE_RELS,
  LONG_TERM_MEMORY_REL,
  PROJECT_SKILLS_STANDARD_REL,
  WORKSPACE_SKILLS_DIR,
  getProjectRoot,
  resolveAgentWorkspaceAbs,
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

function sliceWorkspaceCfg(aiWorkflowCfg) {
  return aiWorkflowCfg?.agentWorkspace ?? {};
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
  }
}

export async function buildAgentWorkspaceSection(agentWorkspaceCfg = {}, streamName = '') {
  const runtimeConfig = {
    enabled: true,
    root: '',
    workflows: null,
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

  if (runtimeConfig.enabled === false) return '';

  if (Array.isArray(runtimeConfig.workflows) && runtimeConfig.workflows.length > 0 && streamName) {
    if (!runtimeConfig.workflows.includes(streamName)) return '';
  }

  let workspaceRoot;
  let projectRoot;
  try {
    workspaceRoot = realpathSyncOrResolve(resolveAgentWorkspaceAbs(runtimeConfig.root));
    projectRoot = realpathSyncOrResolve(getProjectRoot());
    if (!fs.statSync(workspaceRoot).isDirectory()) return '';
  } catch {
    return '';
  }

  const maxProse = runtimeConfig.maxTotalChars > 0 ? runtimeConfig.maxTotalChars : Number.POSITIVE_INFINITY;
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

  if (runtimeConfig.includeAgentMd) {
    injectWorkspaceAssistant(workspaceRoot, runtimeConfig.maxAgentMdChars, pushProse, {
      isMainSession: streamName === 'v3' || !streamName,
      includeDiagnostics: runtimeConfig.includeDiagnostics,
      maxDiagnosticsChars: runtimeConfig.maxDiagnosticsChars
    });
  }

  const extraMarkdownFiles = Array.isArray(runtimeConfig.contextFiles) ? runtimeConfig.contextFiles : [];
  for (const rel of extraMarkdownFiles) {
    if (typeof rel !== 'string' || !rel.trim()) continue;
    const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (safeRel.includes('..')) continue;
    const fp = path.join(workspaceRoot, safeRel);
    const got = readTextFileUnderWorkspaceRootCached(workspaceRoot, fp, 2 * 1024 * 1024);
    if (!got.ok) continue;
    pushProse(safeRel, got.content);
  }

  if (runtimeConfig.includeRules) {
    const rulesDir = path.join(projectRoot, 'rules');
    try {
      const absFiles = listFilesRecursive(rulesDir, (_fp, name) => name.endsWith('.md') || name.endsWith('.mdc'));
      const relFiles = absFiles
        .map((fp) => path.relative(rulesDir, fp).replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b));

      let acc = '';
      for (const rel of relFiles) {
        const fp = path.join(rulesDir, ...rel.split('/'));
        const got = readTextFileUnderWorkspaceRootCached(projectRoot, fp, runtimeConfig.maxRulesChars * 4);
        if (!got.ok) continue;
        acc += `\n### ${rel}\n\n${got.content}\n`;
        if (acc.length >= runtimeConfig.maxRulesChars) break;
      }
      pushProse('rules', truncate(acc.trim(), runtimeConfig.maxRulesChars, 'rules'));
    } catch {
      /* no rules dir */
    }
  }

  const parts = [...proseSections];

  const configuredRoots = Array.isArray(runtimeConfig.customSkillRoots) ? runtimeConfig.customSkillRoots.filter(Boolean).map(String) : [];
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
    const skillsPrompt = buildSkillsPromptFromWorkspace(projectRoot, { ...runtimeConfig, customSkillRoots: roots });
    if (skillsPrompt) parts.push(`## Skills\n\n${skillsPrompt}`);
  }

  if (runtimeConfig.includeSubagents) {
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

export async function appendAgentWorkspaceToPrompt(basePrompt, aiWorkflowCfg = {}, streamName = '') {
  if (basePrompt == null) return basePrompt;
  const extra = await buildAgentWorkspaceSection(sliceWorkspaceCfg(aiWorkflowCfg), streamName);
  if (!extra) return String(basePrompt);
  return `${basePrompt}${extra}`;
}

export async function mergeAgentWorkspaceIntoMessages(messages, aiWorkflowCfg = {}, streamName = '') {
  if (!Array.isArray(messages)) return messages;
  const extra = await buildAgentWorkspaceSection(sliceWorkspaceCfg(aiWorkflowCfg), streamName);
  if (!extra) return messages;
  const first = messages[0];
  if (first?.role === 'system' && typeof first.content === 'string') {
    first.content = `${first.content}${extra}`;
    return messages;
  }
  messages.unshift({ role: 'system', content: extra.replace(/^\s+/, '') });
  return messages;
}
