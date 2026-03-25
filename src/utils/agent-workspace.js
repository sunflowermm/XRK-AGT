/**
 * 工作区上下文注入：AGENT、bootstrap、rules、Skills（pi-coding-agent）、subagents；扩展见 extraMarkdownFiles / registerAgentWorkspaceProvider。
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import paths from '#utils/paths.js';
import { realpathSyncOrResolve } from '#utils/path-guards.js';
import { readTextFileUnderWorkspaceRoot } from '#utils/safe-workspace-read.js';
import { buildSkillsPromptFromWorkspace } from '#utils/agent-workspace-skills.js';

const OPENCLAW_BOOTSTRAP_FILES = [
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
  'memory.md'
];

const SUBAGENT_MANIFEST_CANDIDATES = [
  '.cursor/subagents.yaml',
  '.cursor/subagents.yml',
  '.cursor/subagents.json',
  'subagents.yaml',
  'subagents.yml',
  'subagents.json'
];

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
    includeSkills: true,
    includeRules: true,
    includeAgentMd: true,
    includeSubagents: true,
    includeBootstrapFiles: false,
    maxBootstrapFileChars: 6000,
    maxTotalChars: 0,
    maxRulesChars: 12_000,
    maxAgentMdChars: 12_000,
    maxCandidatesPerRoot: 300,
    maxSkillsLoadedPerSource: 200,
    maxSkillsInPrompt: 150,
    maxSkillsPromptChars: 30_000,
    maxSkillFileBytes: 256_000,
    skillRoots: ['.cursor/skills', '.agents/skills', 'skills'],
    extraMarkdownFiles: [],
    ...agentWorkspaceCfg
  };

  if (
    agentWorkspaceCfg.maxSkillsLoadedPerSource == null &&
    agentWorkspaceCfg.maxSkillFiles != null
  ) {
    cfg.maxSkillsLoadedPerSource = agentWorkspaceCfg.maxSkillFiles;
  }

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
    for (const name of ['AGENT.md', 'AGENTS.md']) {
      const fp = path.join(rootResolved, name);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, cfg.maxAgentMdChars * 4);
      if (!got.ok) continue;
      pushProse(name, truncate(got.content, cfg.maxAgentMdChars, name));
      break;
    }
  }

  if (cfg.includeBootstrapFiles) {
    const maxB = cfg.maxBootstrapFileChars ?? 6000;
    for (const name of OPENCLAW_BOOTSTRAP_FILES) {
      const fp = path.join(rootResolved, name);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, maxB * 4);
      if (!got.ok) continue;
      pushProse(name, truncate(got.content, maxB, name));
    }
  }

  if (cfg.includeRules) {
    const rulesDir = path.join(rootResolved, '.cursor', 'rules');
    try {
      const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
      const names = entries
        .filter((e) => e.isFile() && e.name.endsWith('.mdc'))
        .map((e) => e.name)
        .sort();
      let acc = '';
      for (const fn of names) {
        const fp = path.join(rulesDir, fn);
        const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, cfg.maxRulesChars * 4);
        if (!got.ok) continue;
        acc += `\n### ${fn}\n\n${got.content}\n`;
        if (acc.length >= cfg.maxRulesChars) break;
      }
      pushProse('.cursor/rules', truncate(acc.trim(), cfg.maxRulesChars, 'rules'));
    } catch {
      /* no rules dir */
    }
  }

  if (Array.isArray(cfg.extraMarkdownFiles) && cfg.extraMarkdownFiles.length > 0) {
    for (const rel of cfg.extraMarkdownFiles) {
      if (typeof rel !== 'string' || !rel.trim()) continue;
      const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      if (safeRel.includes('..')) continue;
      const fp = path.join(rootResolved, safeRel);
      const got = readTextFileUnderWorkspaceRoot(rootResolved, fp, 2 * 1024 * 1024);
      if (!got.ok) continue;
      pushProse(safeRel, got.content);
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

  if (cfg.includeSkills) {
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
