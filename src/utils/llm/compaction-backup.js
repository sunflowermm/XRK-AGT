import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import RuntimeUtil from '#utils/runtime-util.js';
import { getAiWorkflowConfigOptional } from '#utils/ai-workflow-config.js';
import { redactSecrets } from '#utils/llm/secret-redact.js';

/**
 * 压缩前备份（对齐 agent-zero：可回滚 / 排障；内容脱敏）。
 * 默认 ~/.xrk/compaction-backups/
 */

function getBackupCfg() {
  const raw = getAiWorkflowConfigOptional().context?.compaction?.backup ?? {};
  return {
    enabled: raw.enabled !== false,
    dir: String(raw.dir || '').trim() || path.join(os.homedir(), '.xrk', 'compaction-backups'),
    maxFiles: typeof raw.maxFiles === 'number' ? raw.maxFiles : 40
  };
}

function redactMessagesForBackup(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const copy = { ...m };
    if (typeof copy.content === 'string') copy.content = redactSecrets(copy.content);
    else if (copy.content != null) {
      try {
        copy.content = JSON.parse(redactSecrets(JSON.stringify(copy.content)));
      } catch {
        copy.content = redactSecrets(String(copy.content));
      }
    }
    if (Array.isArray(copy.tool_calls)) {
      try {
        copy.tool_calls = JSON.parse(redactSecrets(JSON.stringify(copy.tool_calls)));
      } catch {
        /* keep */
      }
    }
    return copy;
  });
}

/**
 * @param {Array<Object>} messages
 * @param {{ label?: string }} [opts]
 * @returns {Promise<string|null>} 备份文件路径
 */
export async function backupMessagesBeforeCompact(messages, opts = {}) {
  const cfg = getBackupCfg();
  if (!cfg.enabled) return null;

  try {
    await fs.mkdir(cfg.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(opts.label || 'stream').replace(/[^\w.-]+/g, '_').slice(0, 40);
    const file = path.join(cfg.dir, `${stamp}_${safe}.json`);
    const payload = {
      at: new Date().toISOString(),
      label: opts.label || null,
      count: Array.isArray(messages) ? messages.length : 0,
      messages: redactMessagesForBackup(messages)
    };
    await fs.writeFile(file, `${JSON.stringify(payload)}\n`, 'utf8');
    await pruneOldBackups(cfg.dir, cfg.maxFiles);
    RuntimeUtil.makeLog('debug', `[compaction-backup] ${file}`, 'AiWorkflow');
    return file;
  } catch (err) {
    RuntimeUtil.makeLog(
      'warn',
      `[compaction-backup] 失败: ${Error.isError(err) ? err.message : String(err)}`,
      'AiWorkflow'
    );
    return null;
  }
}

async function pruneOldBackups(dir, maxFiles) {
  if (!maxFiles || maxFiles < 5) return;
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const jsons = names.filter((n) => n.endsWith('.json')).sort();
  const excess = jsons.length - maxFiles;
  if (excess <= 0) return;
  for (const name of jsons.slice(0, excess)) {
    await fs.unlink(path.join(dir, name)).catch(() => {});
  }
}
