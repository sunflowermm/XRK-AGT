import cfg from '#infrastructure/config/config.js';
import { fetchWithPolicy } from '../net/fetcher.js';

function getNoticeConfig() {
  const n = cfg?.notice;
  return n && typeof n === 'object' ? n : {};
}

function norm(s) {
  return String(s ?? '').trim();
}

function asText(title, content) {
  const t = norm(title);
  const c = norm(content);
  if (t && c) return `${t}\n\n${c}`;
  return t || c;
}

async function sendServerChan(sendKey, title, content) {
  const key = norm(sendKey);
  if (!key) return { ok: false, skipped: true, channel: 'sct', reason: 'empty_key' };
  const url = `https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`;
  const body = new URLSearchParams({
    title: norm(title) || 'XRK-AGT 通知',
    desp: norm(content) || ''
  });
  const res = await fetchWithPolicy(url, { method: 'POST', body, timeoutMs: 8000, retries: 1 });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, channel: 'sct', status: res.status, response: text };
}

async function sendFeishu(webhook, title, content) {
  const hook = norm(webhook);
  if (!hook) return { ok: false, skipped: true, channel: 'feishu', reason: 'empty_webhook' };
  const payload = {
    msg_type: 'text',
    content: { text: asText(title, content) || 'XRK-AGT 通知' }
  };
  const res = await fetchWithPolicy(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 8000,
    retries: 1
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, channel: 'feishu', status: res.status, response: text };
}

async function sendIYUU(iyuu, title, content) {
  const tokenOrUrl = norm(iyuu);
  if (!tokenOrUrl) return { ok: false, skipped: true, channel: 'iyuu', reason: 'empty_token' };

  // 兼容两种形式：直接给 webhook URL；或给 token（按 iyuu.cn 常见 send 形态拼接）
  const isUrl = /^https?:\/\//i.test(tokenOrUrl);
  const url = isUrl
    ? tokenOrUrl
    : `https://iyuu.cn/${encodeURIComponent(tokenOrUrl)}.send`;

  const body = new URLSearchParams({
    text: norm(title) || 'XRK-AGT 通知',
    desp: norm(content) || ''
  });

  const res = await fetchWithPolicy(url, { method: 'POST', body, timeoutMs: 8000, retries: 1 });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, channel: 'iyuu', status: res.status, response: text };
}

export class NoticeService {
  async send({ title, content, channels = ['iyuu', 'sct', 'feishu'] }) {
    const conf = getNoticeConfig();
    const want = Array.isArray(channels) && channels.length ? channels : ['iyuu', 'sct', 'feishu'];
    const results = [];

    for (const ch of want) {
      try {
        if (ch === 'iyuu') results.push(await sendIYUU(conf.iyuu, title, content));
        else if (ch === 'sct') results.push(await sendServerChan(conf.sct, title, content));
        else if (ch === 'feishu') results.push(await sendFeishu(conf.feishu_webhook, title, content));
      } catch (e) {
        results.push({ ok: false, channel: ch, error: e?.message || String(e) });
      }
    }

    return results;
  }
}

export const noticeService = new NoticeService();

