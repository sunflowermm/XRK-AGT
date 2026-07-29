import fs from 'node:fs/promises';
import path from 'node:path';
import RuntimeUtil from '#utils/runtime-util.js';
import { inlineBinaryFromRef, isPathLike } from '#utils/media-ref.js';
import { segMediaRef } from '#utils/onebot-message-seg.js';

const HTTP_RE = /^https?:\/\//i;
const QQ_CDN_RE = /multimedia\.nt\.qq\.com/i;
const FILE_MEDIA = new Set(['file', 'video', 'record', 'audio']);

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
  const media = segMediaRef(data);
  return {
    file: media.file || String(data.file ?? '').trim(),
    url: media.url || String(data.url ?? '').trim(),
    fileId: media.fileId,
  };
}

async function readLocalBuffer(ref) {
  const inline = inlineBinaryFromRef(ref);
  if (inline) return inline;
  const p = String(ref ?? '').replace(/^file:\/\//, '').trim();
  if (!p || isHttpRef(p) || !isPathLike(p)) return null;
  if (!(await RuntimeUtil.fileExists(p))) return null;
  try {
    const buf = await fs.readFile(p);
    return buf?.length ? buf : null;
  } catch {
    return null;
  }
}

async function fetchRefBuffer(ref, timeoutMs) {
  const url = String(ref ?? '').replace(/&amp;/gi, '&').trim();
  if (!url || !isHttpRef(url)) return null;
  const fetched = await RuntimeUtil.Buffer(url, { http: false, timeout: timeoutMs });
  return Buffer.isBuffer(fetched) && fetched.length ? fetched : null;
}

async function getViaApi(sendApi, action, params, timeoutMs) {
  if (!sendApi) return null;
  try {
    const api = sendApi(action, params).then((r) => r?.data ?? {});
    const d = timeoutMs > 0
      ? await Promise.race([
        api,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('请求超时')), timeoutMs);
        }),
      ])
      : await api;
    if (d.file && isPathLike(d.file) && await RuntimeUtil.fileExists(d.file)) {
      return readLocalBuffer(`file://${path.resolve(d.file)}`);
    }
    if (d.path && isPathLike(d.path) && await RuntimeUtil.fileExists(d.path)) {
      return readLocalBuffer(`file://${path.resolve(d.path)}`);
    }
    if (d.base64) {
      const raw = String(d.base64).replace(/^base64:\/\//, '');
      return raw ? Buffer.from(raw, 'base64') : null;
    }
  } catch (err) {
    globalThis.AgentRuntime?.makeLog?.('debug', `[${action}] ${JSON.stringify(params)} → ${err.message}`, 'EntryMedia');
  }
  return null;
}

/**
 * 通用媒体 Buffer：image→get_image；file/video/record→get_file；兼 HTTP/本地/base64
 * @param {object|string} refs
 * @param {Function} [sendApi]
 * @param {{ type?: string, persist?: boolean, fetchTimeout?: number, getImageTimeout?: number }} [opts]
 */
export async function readMediaBuffer(refs, sendApi, opts = {}) {
  const mediaType = String(opts.type || (typeof refs === 'object' && refs?.type) || 'image').toLowerCase();
  const { file, url, fileId } = refStrings(refs);
  const persist = opts.persist === true;
  const fetchTimeout = opts.fetchTimeout ?? 12000;
  const apiTimeout = opts.getImageTimeout ?? (persist ? 8000 : 60000);

  for (const ref of [file, url]) {
    if (ref?.startsWith('base64://')) {
      return Buffer.from(ref.slice(9), 'base64');
    }
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
    const isImageLike = mediaType === 'image' || mediaType === 'mface';
    const actions = isImageLike
      ? [['get_image', { file: file || url }]]
      : FILE_MEDIA.has(mediaType) || fileId
        ? [
          ['get_file', { file: file || fileId }],
          ['get_file', { file_id: fileId || file }],
          ['get_record', { file: file || fileId }],
        ]
        : [['get_image', { file: file || url }], ['get_file', { file: file || fileId }]];

    for (const [action, params] of actions) {
      const ref = params.file || params.file_id;
      if (!ref) continue;
      if (/^https?:\/\//i.test(ref) && action !== 'get_image') continue;
      const buf = await getViaApi(sendApi, action, params, apiTimeout);
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

/** QQ 图链 / 本地路径 → Buffer（词条落盘、LLM 视觉）；出站发送走 OneBotv11.makeFile */
export async function readImageBuffer(refs, sendApi, opts = {}) {
  return readMediaBuffer(refs, sendApi, { ...opts, type: 'image' });
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
      if (await RuntimeUtil.fileExists(existing)) return ref;
    }
    if (isPathLike(ref) && await RuntimeUtil.fileExists(ref)) {
      const rel = `${groupId}/${mediaType}/${path.basename(ref)}`;
      const dest = path.join(baseDir, rel);
      await RuntimeUtil.mkdir(path.dirname(dest));
      await fs.copyFile(ref, dest);
      return rel;
    }
  }

  const buffer = await readMediaBuffer(data, sendApi, { persist: true, type: mediaType });
  if (!buffer?.length) return null;

  const file = await AgentRuntime.fileType({ ...data, file: buffer });
  if (!Buffer.isBuffer(file.buffer)) return null;

  file.name = `${groupId}/${mediaType}/${file.name}`;
  file.path = path.join(baseDir, file.name);
  await RuntimeUtil.mkdir(path.dirname(file.path));
  await RuntimeUtil.writeFile(file.path, file.buffer);
  return file.name;
}
