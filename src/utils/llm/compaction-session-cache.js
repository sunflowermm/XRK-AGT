/**
 * 压缩会话缓存 + sidecar 落盘（对齐 cline source_prefix_hash）。
 * 内存热路径；写入 ~/.xrk/compaction-sessions/（可配）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';

/** @type {Map<string, { prefixCount: number, prefixHash: string, messages: object[], updatedAt: number }>} */
const cache = new Map();

const MAX_ENTRIES = 200;

function contentFingerprint(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * @param {Array<object>} messages
 * @param {number} [count]
 */
export function sourcePrefixHash(messages, count = messages?.length || 0) {
  const hash = createHash('sha256');
  hash.update('xrk-compaction-source-v1\n');
  hash.update(`${count}\n`);
  const list = Array.isArray(messages) ? messages : [];
  const n = Math.max(0, Math.min(count, list.length));
  for (let i = 0; i < n; i++) {
    const m = list[i] || {};
    hash.update(String(m.role || ''));
    hash.update('\0');
    hash.update(contentFingerprint(m.content));
    hash.update('\0');
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      try {
        hash.update(JSON.stringify(m.tool_calls));
      } catch {
        /* ignore */
      }
    }
    hash.update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}

function getSidecarCfg() {
  const raw = getAiWorkflowConfigOptional()?.context?.compaction?.sessionCache ?? {};
  return {
    persist: raw.persist !== false,
    dir: String(raw.dir || '').trim() || path.join(os.homedir(), '.xrk', 'compaction-sessions'),
    maxFiles: typeof raw.maxFiles === 'number' ? Math.max(10, raw.maxFiles) : 80
  };
}

function safeKeyFile(sessionKey) {
  const h = createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 40);
  return `${h}.json`;
}

function touchLimit() {
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const drop = oldest.slice(0, cache.size - MAX_ENTRIES);
  for (const [k] of drop) cache.delete(k);
}

function persistState(sessionKey, state) {
  const cfg = getSidecarCfg();
  if (!cfg.persist) return;
  try {
    fs.mkdirSync(cfg.dir, { recursive: true });
    const file = path.join(cfg.dir, safeKeyFile(sessionKey));
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sessionKey,
        prefixCount: state.prefixCount,
        prefixHash: state.prefixHash,
        messages: state.messages,
        updatedAt: state.updatedAt
      }),
      'utf8'
    );
    pruneSidecarDir(cfg.dir, cfg.maxFiles);
  } catch {
    /* 落盘失败不阻断主路径 */
  }
}

function pruneSidecarDir(dir, maxFiles) {
  let entries;
  try {
    entries = fs.readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => {
        const p = path.join(dir, n);
        let mtime = 0;
        try {
          mtime = fs.statSync(p).mtimeMs;
        } catch {
          /* */
        }
        return { p, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }
  for (const e of entries.slice(maxFiles)) {
    try {
      fs.unlinkSync(e.p);
    } catch {
      /* */
    }
  }
}

function loadFromDisk(sessionKey) {
  const cfg = getSidecarCfg();
  if (!cfg.persist) return null;
  try {
    const file = path.join(cfg.dir, safeKeyFile(sessionKey));
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || !Array.isArray(raw.messages) || typeof raw.prefixCount !== 'number') return null;
    const state = {
      prefixCount: raw.prefixCount,
      prefixHash: String(raw.prefixHash || ''),
      messages: raw.messages,
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
    cache.set(sessionKey, state);
    return state;
  } catch {
    return null;
  }
}

/**
 * @param {string} sessionKey
 * @param {Array<object>} sourceMessages
 * @returns {Array<object>|null}
 */
export function projectCachedCompaction(sessionKey, sourceMessages) {
  const key = String(sessionKey || '').trim();
  if (!key) return null;
  let state = cache.get(key);
  if (!state) state = loadFromDisk(key);
  if (!state?.messages?.length) return null;
  const source = Array.isArray(sourceMessages) ? sourceMessages : [];
  if (state.prefixCount > source.length) return null;
  if (sourcePrefixHash(source, state.prefixCount) !== state.prefixHash) return null;
  return [
    ...state.messages.map((m) => (m && typeof m === 'object' ? { ...m } : m)),
    ...source.slice(state.prefixCount)
  ];
}

/**
 * @param {string} sessionKey
 * @param {{ sourceMessages: object[], compactedMessages: object[], prefixCount: number }} input
 */
export function storeCompactionSession(sessionKey, input) {
  const key = String(sessionKey || '').trim();
  if (!key) return;
  const prefixCount = Math.max(0, Number(input.prefixCount) || 0);
  const source = input.sourceMessages || [];
  const state = {
    prefixCount,
    prefixHash: sourcePrefixHash(source, prefixCount),
    messages: (input.compactedMessages || []).map((m) => (m && typeof m === 'object' ? { ...m } : m)),
    updatedAt: Date.now()
  };
  cache.set(key, state);
  touchLimit();
  persistState(key, state);
}

/** @param {string} [sessionKey] */
export function clearCompactionSession(sessionKey) {
  if (sessionKey == null || sessionKey === '') {
    cache.clear();
    return;
  }
  const key = String(sessionKey);
  cache.delete(key);
  try {
    const cfg = getSidecarCfg();
    const file = path.join(cfg.dir, safeKeyFile(key));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* */
  }
}
