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

const OPENCLAW_WORKSPACE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
];

const SUBAGENT_MANIFEST_CANDIDATES = [
  'agents/subagents.yaml',
  'agents/subagents.yml',
  'agents/subagents.json',
];

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

export async function buildAgentWorkspaceSection(agentWorkspaceCfg = {}, streamName = '') {
  const cfg = {
    enabled: true,
    root: '',
    streams: null,
    includeRules: true,
    includeAgentMd: true,
    includeSubagents: true,
    maxTotalChars: 0,
    maxRulesChars: 12_000,
    maxAgentMdChars: 12_000,
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
    for (const name of ['AGENT.md', 'AGENTS.md']) {
      const fp = path.join(rootResolved, name);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, cfg.maxAgentMdChars * 4);
      if (!got.ok) continue;
      pushProse(name, truncate(got.content, cfg.maxAgentMdChars, name));
      break;
    }

    // OpenClaw workspace templates: IDENTITY/USER/SOUL/TOOLS/HEARTBEAT/BOOTSTRAP/MEMORY
    // MEMORY.md 会在“主会话”里加载（这里用 v3 作为主会话信号）。
    const isMainSession = streamName === 'v3' || !streamName;

    for (const name of OPENCLAW_WORKSPACE_FILES) {
      const fp = path.join(rootResolved, name);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, MAX_OPENCLAW_FILE_CHARS * 4);
      if (!got.ok) continue;
      pushProse(name, truncate(got.content, MAX_OPENCLAW_FILE_CHARS, name));
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
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, openclawTemplateMaxChars * 4);
      if (!got.ok) continue;
      pushProse(rel, truncate(got.content, openclawTemplateMaxChars, rel));
    }

    if (isMainSession) {
      // 支持 MEMORY.md 与 memory.md 两种命名（历史兼容 + Windows 大小写敏感性）
      for (const name of ['MEMORY.md', 'memory.md']) {
        const fp = path.join(rootResolved, name);
        const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, openclawTemplateMaxChars * 4);
        if (!got.ok) continue;
        pushProse(name, truncate(got.content, openclawTemplateMaxChars, name));
        break;
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
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, 2 * 1024 * 1024);
      if (!got.ok) continue;
      pushProse(safeRel, got.content);
    }
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
        const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, cfg.maxRulesChars * 4);
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
    const skillsPrompt = buildSkillsPromptFromWorkspace(rootResolved, cfg);
    if (skillsPrompt) parts.push(`## Skills\n\n${skillsPrompt}`);
  }

  if (cfg.includeSubagents) {
    for (const rel of SUBAGENT_MANIFEST_CANDIDATES) {
      const fp = path.join(rootResolved, rel);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, 512 * 1024);
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
