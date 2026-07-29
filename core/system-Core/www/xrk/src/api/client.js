import { useAuthStore } from '@/stores/auth';
import { unwrapSuccess, abortTimeout } from '@/utils/http';

export function getServerUrl() {
  return window.location.origin;
}

export function authHeaders(extra = {}) {
  const auth = useAuthStore();
  const headers = { ...extra };
  if (auth.apiKey) {
    headers['X-API-Key'] = auth.apiKey;
  }
  return headers;
}

/**
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number, raw?: boolean }} [opts]
 */
export async function apiFetch(path, opts = {}) {
  const { timeoutMs = 30000, raw = false, headers, ...rest } = opts;
  const auth = useAuthStore();
  document.body.classList.add('is-busy');
  try {
    const res = await fetch(`${getServerUrl()}${path}`, {
      ...rest,
      headers: authHeaders(headers),
      signal: abortTimeout(timeoutMs),
    });
    if (res.status === 401) {
      auth.noteUnauthorized();
    } else if (res.ok) {
      auth.noteAuthorized();
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!res.ok) throw new Error(res.status === 401 ? '未授权' : `HTTP ${res.status}`);
      return raw ? res : await res.text();
    }
    const json = await res.json();
    if (raw) return json;
    if (!res.ok && json?.success === false) {
      throw new Error(json.message || (res.status === 401 ? '未授权' : `HTTP ${res.status}`));
    }
    if (json && typeof json === 'object' && 'success' in json) {
      return unwrapSuccess(json);
    }
    if (!res.ok) throw new Error(json?.message || (res.status === 401 ? '未授权' : `HTTP ${res.status}`));
    return json;
  } finally {
    document.body.classList.remove('is-busy');
  }
}

export async function apiJson(path, body, method = 'POST') {
  return apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
}
