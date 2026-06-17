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

function toRefs(ref) {
  return typeof ref === 'object' && ref !== null ? ref : { file: ref };
}

function refStrings(refs) {
  const { file: f = '', url: u = '' } = toRefs(refs);
  return { file: String(f).trim(), url: String(u).trim() };
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

async function fetchHttpBuffer(ref, timeoutMs) {
  if (!isHttpRef(ref)) return null;
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
    globalThis.Bot?.makeLog?.('debug', `[get_image] ${fileRef} → ${err.message}`, 'OutboundMedia');
  }
  return null;
}

/**
 * 读图片 Buffer
 * - persist：添加词条落盘；QQ 直链可即时 fetch（会过期，仅用于下载落盘）
 * - 默认：出站发送；QQ CDN 不裸发，走 get_image
 */
export async function readImageBuffer(refs, sendApi, opts = {}) {
  const { file, url } = refStrings(refs);
  const persist = opts.persist === true;
  const getImageTimeout = opts.getImageTimeout ?? (persist ? 8000 : 60000);
  const fetchTimeout = opts.fetchTimeout ?? 12000;

  if (file.startsWith('base64://')) {
    return Buffer.from(file.slice(9), 'base64');
  }

  const local = (await readLocalBuffer(file)) || (await readLocalBuffer(url));
  if (local) return local;

  if (persist) {
    for (const ref of [url, file]) {
      const buf = await fetchHttpBuffer(ref, fetchTimeout);
      if (buf?.length) return buf;
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
    const external = [file, url].find((r) => isHttpRef(r) && !isQqCdn(r));
    if (external) {
      return fetchHttpBuffer(external, fetchTimeout);
    }
  }

  return null;
}

/**
 * 词条媒体落盘 → 相对路径 group/type/file（JSON 仅存本地，不存 URL）
 * QQ 直链仅在添加时通过 readImageBuffer(persist) 即时下载
 */
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

/** 出站 segment.file */
export async function resolveOutboundFile(file, opts = {}) {
  const size = opts.size ?? 10485760;
  const { sendApi } = opts;

  if (Buffer.isBuffer(file)) {
    return BotUtil.Buffer(file, { size, file: opts.file });
  }

  const str = String(file ?? '').trim();
  if (!str) throw new Error('空文件引用');
  if (str.startsWith('base64://')) return str;

  const buf = await readImageBuffer(isHttpRef(str) ? { url: str } : { file: str }, sendApi);
  if (buf?.length) {
    return BotUtil.Buffer(buf, { size, file: opts.file });
  }

  if (isHttpRef(str)) {
    if (isQqCdn(str)) {
      throw new Error('QQ 临时图链无法解析，请用 get_image 或本地文件');
    }
    return str;
  }

  throw new Error(`无法解析文件: ${str.slice(0, 120)}`);
}

/** 落盘到绝对路径 */
export async function materializeMediaRefToPath(refs, absPath, sendApi) {
  const buf = await readImageBuffer(refs, sendApi, { persist: true });
  if (!buf?.length) return false;
  await BotUtil.writeFile(absPath, buf);
  return true;
}
