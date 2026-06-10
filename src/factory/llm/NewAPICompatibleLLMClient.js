import OpenAICompatibleLLMClient from './OpenAICompatibleLLMClient.js';
import { buildOpenAICompatEndpoint } from '../../utils/llm/openai-chat-utils.js';

/** New API 兼容工厂（OpenAI Chat Completions） */
export default class NewAPICompatibleLLMClient extends OpenAICompatibleLLMClient {
  normalizeEndpoint(config) {
    return buildOpenAICompatEndpoint(config, { defaultPath: '/v1/chat/completions', label: 'newapi_compat' });
  }
}
