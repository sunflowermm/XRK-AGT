import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * 为 node-fetch 请求构建带代理能力的配置
 * @param {Object} config - LLM 配置对象，支持：
 *   - proxy: {
 *       enabled: boolean,
 *       url: string  // 例如：http://127.0.0.1:7890
 *     }
 *   - 或简写：proxy: "http://127.0.0.1:7890"
 * @param {Object} baseOptions - 原始 fetch 选项
 * @returns {Object} 合并后的 fetch 选项
 */
export function buildFetchOptionsWithProxy(config = {}, baseOptions = {}) {
  const options = { ...baseOptions };

  const proxyConfig = config.proxy;
  if (!proxyConfig) {
    return options;
  }

  // 开关控制：对象形式时必须显式 enabled 为 true；字符串简写则默认开启
  const isObjectConfig = typeof proxyConfig === 'object' && proxyConfig !== null;
  const enabled = isObjectConfig ? proxyConfig.enabled === true : true;
  if (!enabled) {
    return options;
  }

  const url = isObjectConfig ? proxyConfig.url : proxyConfig;
  if (!url || typeof url !== 'string') {
    return options;
  }

  try {
    options.agent = new HttpsProxyAgent(url);
  } catch (err) {
    // 代理配置异常时不中断业务，只做日志提示
    globalThis.Bot?.makeLog?.(
      'warn',
      `[LLM Proxy] 创建代理失败: ${String(err?.message || err)}`
    );
  }

  return options;
}

