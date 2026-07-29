/**
 * 生成给当前请求方用的基址（下载/预览 URL）。
 * 优先 Host（及 X-Forwarded-Proto），避免配置里是 127.0.0.1 时公网客户端拿到不可达链接。
 */
export function resolveClientBaseUrl(req, runtime) {
  const host = req?.get?.('host') || req?.headers?.host;
  if (host) {
    const xf = req.get?.('x-forwarded-proto') || req.headers?.['x-forwarded-proto'];
    const proto = String(xf || req.protocol || 'http')
      .split(',')[0]
      .trim()
      .replace(/:$/, '') || 'http';
    return `${proto}://${host}`.replace(/\/+$/, '');
  }
  const raw = runtime?.url || runtime?.getServerUrl?.() || 'http://127.0.0.1';
  return String(raw).replace(/\/+$/, '');
}
