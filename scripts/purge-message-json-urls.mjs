/**
 * 清理 data/messageJson 中带 HTTP 直链（含 QQ 临时图床）的媒体段，并删除因此变空的词条回复。
 * 用法：node scripts/purge-message-json-urls.mjs [--dry-run]
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHttpRef } from '../src/utils/outbound-media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MSG_DIR = path.join(__dirname, '..', 'data/messageJson');
const MEDIA = new Set(['image', 'video', 'record']);
const dryRun = process.argv.includes('--dry-run');

const stats = { files: 0, changed: 0, removedSegs: 0, removedMsgs: 0, removedKeys: 0 };

function localExists(ref) {
  if (!ref || isHttpRef(ref)) return false;
  return fsSync.existsSync(path.join(MSG_DIR, ref)) || fsSync.existsSync(ref);
}

function cleanSegments(segs) {
  if (!Array.isArray(segs)) return [];
  const out = [];
  for (const seg of segs) {
    if (!seg || typeof seg !== 'object') continue;
    if (seg.type === 'node' && Array.isArray(seg.data)) {
      const data = seg.data.map((node) => ({
        ...node,
        message: cleanSegments(node.message || node.content || []),
      }));
      out.push({ ...seg, data });
      continue;
    }
    if (MEDIA.has(seg.type)) {
      const fileRef = String(seg.file ?? '').trim();
      const urlRef = String(seg.url ?? '').trim();
      if (isHttpRef(fileRef) || isHttpRef(urlRef)) {
        stats.removedSegs += 1;
        continue;
      }
      if (!localExists(fileRef)) {
        stats.removedSegs += 1;
        continue;
      }
      const next = { ...seg, file: fileRef };
      delete next.url;
      delete next.fid;
      out.push(next);
      continue;
    }
    out.push(seg);
  }
  return out;
}

function hasVisibleContent(segs) {
  return Array.isArray(segs) && segs.some((s) => {
    if (!s || typeof s !== 'object') return false;
    if (s.type === 'text') return String(s.text ?? '').trim().length > 0;
    if (s.type === 'node') return Array.isArray(s.data) && s.data.length > 0;
    return true;
  });
}

async function purgeFile(jsonPath) {
  stats.files += 1;
  const groupId = path.basename(jsonPath, '.json');
  const raw = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  let changed = false;

  for (const [key, messages] of Object.entries(data)) {
    if (!Array.isArray(messages)) continue;
    const nextMsgs = [];
    for (const msg of messages) {
      if (!Array.isArray(msg)) {
        nextMsgs.push(msg);
        continue;
      }
      const cleaned = cleanSegments(msg);
      if (!hasVisibleContent(cleaned)) {
        stats.removedMsgs += 1;
        changed = true;
        continue;
      }
      if (JSON.stringify(cleaned) !== JSON.stringify(msg)) changed = true;
      nextMsgs.push(cleaned);
    }
    if (nextMsgs.length !== messages.length) changed = true;
    if (nextMsgs.length === 0) {
      delete data[key];
      stats.removedKeys += 1;
      changed = true;
    } else {
      data[key] = nextMsgs;
    }
  }

  if (!changed) return;
  stats.changed += 1;
  console.log(`[purge] ${groupId}.json`);
  if (dryRun) return;

  const backup = `${jsonPath}.bak-${Date.now()}`;
  await fs.copyFile(jsonPath, backup);
  await fs.writeFile(jsonPath, JSON.stringify(data, null, '\t'), 'utf8');
}

let files = [];
try {
  files = (await fs.readdir(MSG_DIR)).filter((f) => f.endsWith('.json'));
} catch {
  files = [];
}

for (const file of files) {
  await purgeFile(path.join(MSG_DIR, file));
}

console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
