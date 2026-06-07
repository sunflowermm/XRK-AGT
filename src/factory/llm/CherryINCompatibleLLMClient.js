import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';

/** CherryIN 兼容工厂（OpenAI Chat Completions） */
export default class CherryINCompatibleLLMClient extends OpenAICompatibleLLMClient {
  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    const path = (config.path || '/v1/chat/completions').replace(/^\/?/, '/');
    if (!base) throw new Error('cherryin_compat: 未配置 baseUrl');
    return `${base}${path}`;
  }
}
