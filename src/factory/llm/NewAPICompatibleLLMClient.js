import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';

/** New API 兼容工厂（OpenAI Chat Completions） */
export default class NewAPICompatibleLLMClient extends OpenAICompatibleLLMClient {
  normalizeEndpoint(config) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '');
    const path = (config.path || '/v1/chat/completions').replace(/^\/?/, '/');
    if (!base) throw new Error('newapi_compat: 未配置 baseUrl');
    return `${base}${path}`;
  }
}
