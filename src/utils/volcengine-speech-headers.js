/**
 * 火山引擎语音（ASR/TTS）WebSocket 鉴权头。
 * 新控制台：仅 X-Api-Key；旧控制台：X-Api-App-Key + X-Api-Access-Key。
 * @see https://www.volcengine.com/docs/6561/1354869
 */

/** @param {object} config @param {{ connectId?: string }} [opts] */
export function buildVolcengineSpeechHeaders(config = {}, opts = {}) {
  const headers = {};
  const resourceId = String(config.resourceId ?? '').trim();
  if (resourceId) headers['X-Api-Resource-Id'] = resourceId;

  const connectId = opts.connectId != null ? String(opts.connectId).trim() : '';
  if (connectId) headers['X-Api-Connect-Id'] = connectId;

  const apiKey = String(config.apiKey ?? config.xApiKey ?? '').trim();
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
    return headers;
  }

  const appKey = String(config.appKey ?? '').trim();
  const accessKey = String(config.accessKey ?? '').trim();
  if (appKey) headers['X-Api-App-Key'] = appKey;
  if (accessKey) headers['X-Api-Access-Key'] = accessKey;
  return headers;
}
