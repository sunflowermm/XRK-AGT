import fs from 'node:fs/promises';
import path from 'node:path';
import BotUtil from '#utils/botutil.js';

const HTTP_RE = /^https?:\/\//i;
const QQ_CDN_RE = /multimedia\.nt\.qq\.com/i;

export function isHttpRef(ref) {
  return HTTP_RE.test(String(ref ?? '').trim());
}

function isQqCdn(ref) {
  return isHttpRef(ref) && QQ_CDN_RE.test(String(ref));
}

function toRefs(ref) {
  return typeof ref === 'object' && ref !== null ? ref : { file: ref };
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

async function getImageViaApi(sendApi, fileRef) {
  if (!sendApi || !fileRef) return null;
  try {
    const d = (await sendApi('get_image', { file: fileRef }))?.data ?? {};
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
 * 读图片 Buffer：本地 → get_image(file) → get_image(url) → 非 QQ 外链 fetch
 */
export async function readImageBuffer(refs, sendApi) {
  const { file: f = '', url: u = '' } = toRefs(refs);
  const file = String(f).trim();
  const url = String(u).trim();

  if (file.startsWith('base64://')) {
    return Buffer.from(file.slice(9), 'base64');
  }

  const local = (await readLocalBuffer(file)) || (await readLocalBuffer(url));
  if (local) return local;

  if (!sendApi) return null;

  for (const ref of [file, url]) {
    const buf = await getImageViaApi(sendApi, ref);
    if (buf?.length) return buf;
  }

  const external = [file, url].find((r) => isHttpRef(r) && !isQqCdn(r));
  if (!external) return null;

  const fetched = await BotUtil.Buffer(external, { http: false });
  return Buffer.isBuffer(fetched) && fetched.length ? fetched : null;
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
  const buf = await readImageBuffer(refs, sendApi);
  if (!buf?.length) return false;
  await BotUtil.writeFile(absPath, buf);
  return true;
}
