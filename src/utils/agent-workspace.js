/**
 * 工作区上下文注入：AGENT、rules、Skills（pi-coding-agent）、subagents；扩展见 contextFiles / registerAgentWorkspaceProvider。
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

const OPENCLAW_WORKSPACE_FILE_CANDIDATES = [
  ['agents/workspace/SOUL.md', 'SOUL.md'],
  ['agents/workspace/IDENTITY.md', 'IDENTITY.md'],
  ['agents/workspace/USER.md', 'USER.md'],
  ['agents/workspace/TOOLS.md', 'TOOLS.md'],
  ['agents/workspace/HEARTBEAT.md', 'HEARTBEAT.md'],
];

const SUBAGENT_MANIFEST_CANDIDATES = [
  'agents/subagents.yaml',
  'agents/subagents.yml',
  'agents/subagents.json',
];

// Cache workspace file content by stable identity (size+mtimeMs) to keep output stable
// across repeated calls and reduce IO. Keyed by canonical path to avoid duplicate reads.
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

  const root = cfg.root?.trim() ? path.resolve(paths.root, cfg.root) : paths.root;
  let rootResolved;
  try {
    rootResolved = realpathSyncOrResolve(root);
    if (!fs.statSync(rootResolved).isDirectory()) return '';
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

  const ctx = { rootResolved, cfg, streamName, paths };

  if (cfg.includeAgentMd) {
    const openclawTemplateMaxChars = cfg.maxAgentMdChars;
    let agentsMdContent = '';
    for (const name of ['AGENT.md', 'AGENTS.md']) {
      const fp = path.join(rootResolved, name);
      const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, cfg.maxAgentMdChars * 4);
      if (!got.ok) continue;
      if (!agentsMdContent && name === 'AGENTS.md') agentsMdContent = got.content;
      pushProse(name, truncate(got.content, cfg.maxAgentMdChars, name));
      break;
    }

    // OpenClaw workspace templates: IDENTITY/USER/SOUL/TOOLS/HEARTBEAT/BOOTSTRAP/MEMORY
    // MEMORY.md 会在“主会话”里加载（这里用 v3 作为主会话信号）。
    const isMainSession = streamName === 'v3' || !streamName;

    for (const candidates of OPENCLAW_WORKSPACE_FILE_CANDIDATES) {
      const got = readFirstWorkspaceFile(rootResolved, candidates, openclawTemplateMaxChars * 4);
      if (!got) continue;
      pushProse(got.rel, truncate(got.content, openclawTemplateMaxChars, got.rel));
    }

    // 每日记忆：memory/YYYY-MM-DD.md（今日 + 昨日）
    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const todayYmd = toYmd(now);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayYmd = toYmd(yesterday);

    for (const ymd of [todayYmd, yesterdayYmd]) {
      const rel = path.join('memory', `${ymd}.md`).replace(/\\/g, '/');
      const fp = path.join(rootResolved, 'memory', `${ymd}.md`);
      const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, openclawTemplateMaxChars * 4);
      if (!got.ok) continue;
      pushProse(rel, truncate(got.content, openclawTemplateMaxChars, rel));
    }

    if (isMainSession) {
      // 支持新路径与历史路径（含大小写兼容）
      const memoryGot = readFirstWorkspaceFile(
        rootResolved,
        ['memory/MEMORY.md', 'agents/workspace/MEMORY.md', 'MEMORY.md', 'memory.md'],
        openclawTemplateMaxChars * 4
      );
      if (memoryGot) {
        pushProse(memoryGot.rel, truncate(memoryGot.content, openclawTemplateMaxChars, memoryGot.rel));
      } else if (cfg.includeDiagnostics) {
        const mentionsMemory = /memory\/memory\.md|memory\.md|memory\/\d{4}-\d{2}-\d{2}\.md/i.test(agentsMdContent || '');
        if (!mentionsMemory) {
          const diag = [
            '未发现长期记忆文件（`memory/MEMORY.md`）。',
            '建议：在 `memory/MEMORY.md` 写入你希望长期保留的偏好/约束/决策；并在 `AGENTS.md` 里保持引用一致。',
          ].join('\n');
          pushProse('Workspace diagnostics', truncate(diag, cfg.maxDiagnosticsChars, 'diagnostics'));
        }
      }
    }
  }

  const extraMarkdownFiles = Array.isArray(cfg.contextFiles) ? cfg.contextFiles : [];
  if (extraMarkdownFiles.length > 0) {
    for (const rel of extraMarkdownFiles) {
      if (typeof rel !== 'string' || !rel.trim()) continue;
      const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      if (safeRel.includes('..')) continue;
      const fp = path.join(rootResolved, safeRel);
      const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, 2 * 1024 * 1024);
      if (!got.ok) continue;
      pushProse(safeRel, got.content);
    }
  }

  // Pluggable prompt sections (stable ordering by title)
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
    const rulesDir = path.join(rootResolved, 'rules');
    try {
      const absFiles = listFilesRecursive(rulesDir, (fp, name) => name.endsWith('.md') || name.endsWith('.mdc'));
      const relFiles = absFiles
        .map((fp) => path.relative(rulesDir, fp).replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b));

      let acc = '';
      for (const rel of relFiles) {
        const fp = path.join(rulesDir, ...rel.split('/'));
        const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, cfg.maxRulesChars * 4);
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

  if (Array.isArray(cfg.customSkillRoots) && cfg.customSkillRoots.length > 0) {
    const customSkillRoots = [...cfg.customSkillRoots].filter(Boolean).map(String).sort((a, b) => a.localeCompare(b));
    const skillsPrompt = buildSkillsPromptFromWorkspace(rootResolved, { ...cfg, customSkillRoots });
    if (skillsPrompt) parts.push(`## Skills\n\n${skillsPrompt}`);
  }

  if (cfg.includeSubagents) {
    for (const rel of SUBAGENT_MANIFEST_CANDIDATES) {
      const fp = path.join(rootResolved, rel);
      const got = readTextFileUnderWorkspaceRootCached(rootResolved, fp, 512 * 1024);
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
