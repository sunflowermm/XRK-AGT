import fs from 'node:fs/promises';
import path from 'node:path';
import BotUtil from '#utils/botutil.js';

const HTTP_RE = /^https?:\/\//i;
const QQ_CDN_RE = /multimedia\.nt\.qq\.com/i;

export function isHttpRef(ref) {
  return HTTP_RE.test(String(ref ?? '').trim());
}

/** 词条 JSON 合法媒体路径：group/type/file（不含 HTTP / base64） */
export function isEntryMediaRelPath(ref) {
  const s = String(ref ?? '').trim();
  return Boolean(s && !isHttpRef(s) && !s.startsWith('base64://') && s.includes('/'));
}

function isQqCdn(ref) {
  return isHttpRef(ref) && QQ_CDN_RE.test(String(ref));
}

function refStrings(refs) {
  const data = typeof refs === 'object' && refs !== null ? refs : { file: refs };
  return {
    file: String(data.file ?? '').trim(),
    url: String(data.url ?? '').trim(),
  };
}

async function readLocalBuffer(ref) {
  const p = String(ref ?? '').replace(/^file:\/\//, '').trim();
  if (!p || isHttpRef(p)) return null;
  if (!(await BotUtil.fileExists(p))) return null;
  try {
    const buf = await fs.readFile(p);
    return buf?.length ? buf : null;
  } catch {
    return null;
  }
}

async function fetchRefBuffer(ref, timeoutMs) {
  if (!ref || !isHttpRef(ref)) return null;
  const fetched = await BotUtil.Buffer(ref, { http: false, timeout: timeoutMs });
  return Buffer.isBuffer(fetched) && fetched.length ? fetched : null;
}

async function getImageViaApi(sendApi, fileRef, timeoutMs) {
  if (!sendApi || !fileRef) return null;
  try {
    const api = sendApi('get_image', { file: fileRef }).then((r) => r?.data ?? {});
    const d = timeoutMs > 0
      ? await Promise.race([
        api,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('请求超时')), timeoutMs);
        }),
      ])
      : await api;
    if (d.file && await BotUtil.fileExists(d.file)) {
      return readLocalBuffer(`file://${path.resolve(d.file)}`);
    }
    if (d.base64) {
      const raw = String(d.base64).replace(/^base64:\/\//, '');
      return raw ? Buffer.from(raw, 'base64') : null;
    }
  } catch (err) {
    globalThis.Bot?.makeLog?.('debug', `[get_image] ${fileRef} → ${err.message}`, 'EntryMedia');
  }
  return null;
}

/** QQ 图链 / 本地路径 → Buffer（词条落盘、LLM 视觉）；出站发送走 OneBotv11.makeFile */
export async function readImageBuffer(refs, sendApi, opts = {}) {
  const { file, url } = refStrings(refs);
  const persist = opts.persist === true;
  const fetchTimeout = opts.fetchTimeout ?? 12000;
  const getImageTimeout = opts.getImageTimeout ?? (persist ? 8000 : 60000);

  if (file.startsWith('base64://')) {
    return Buffer.from(file.slice(9), 'base64');
  }

  for (const ref of [file, url]) {
    const local = await readLocalBuffer(ref);
    if (local) return local;
  }

  if (persist) {
    for (const ref of [url, file]) {
      const buf = await fetchRefBuffer(ref, fetchTimeout);
      if (buf) return buf;
    }
  }

  if (sendApi) {
    for (const ref of [file, url]) {
      if (!ref) continue;
      const buf = await getImageViaApi(sendApi, ref, getImageTimeout);
      if (buf?.length) return buf;
    }
  }

  if (!persist) {
    for (const ref of [file, url]) {
      if (isHttpRef(ref) && !isQqCdn(ref)) {
        const buf = await fetchRefBuffer(ref, fetchTimeout);
        if (buf) return buf;
      }
    }
  }

  return null;
}

/** 词条媒体落盘 → 相对路径 group/type/file（JSON 仅存本地，不存 URL） */
export async function persistEntryMedia(segment, { baseDir, groupId, sendApi }) {
  const data = typeof segment === 'object' && segment !== null ? segment : { file: segment };
  const mediaType = data.type || 'image';
  const { file: fileRef, url: urlRef } = refStrings(data);

  for (const ref of [fileRef, urlRef]) {
    if (!ref || isHttpRef(ref) || ref.startsWith('base64://')) continue;
    if (isEntryMediaRelPath(ref)) {
      const existing = path.join(baseDir, ref);
      if (await BotUtil.fileExists(existing)) return ref;
    }
    if (await BotUtil.fileExists(ref)) {
      const rel = `${groupId}/${mediaType}/${path.basename(ref)}`;
      const dest = path.join(baseDir, rel);
      await BotUtil.mkdir(path.dirname(dest));
      await fs.copyFile(ref, dest);
      return rel;
    }
  }

  const buffer = await readImageBuffer(data, sendApi, { persist: true });
  if (!buffer?.length) return null;

  const file = await Bot.fileType({ ...data, file: buffer });
  if (!Buffer.isBuffer(file.buffer)) return null;

  file.name = `${groupId}/${mediaType}/${file.name}`;
  file.path = path.join(baseDir, file.name);
  await BotUtil.mkdir(path.dirname(file.path));
  await BotUtil.writeFile(file.path, file.buffer);
  return file.name;
}
